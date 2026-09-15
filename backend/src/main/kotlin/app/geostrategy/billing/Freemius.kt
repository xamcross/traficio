package app.geostrategy.billing

import app.geostrategy.auth.hmacSha256Hex
import app.geostrategy.auth.md5Hex
import io.ktor.client.HttpClient
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.slf4j.LoggerFactory
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

// Not secret: this is the same value as frontend/src/environments/environment.production.ts's
// freemiusProductId, which already ships in every browser bundle.
const val FREEMIUS_PRODUCT_ID = "39459"

/**
 * The Freemius sandbox checkout token. Formula from
 * https://freemius.com/help/documentation/checkout/integration/testing/: `ctx` is the
 * current Unix time (or any unique string), and `token` is `md5(ctx + product_id +
 * secret_key + public_key + 'checkout')`.
 */
fun freemiusSandboxToken(ctx: String, secretKey: String, publicKey: String): String =
    md5Hex(ctx + FREEMIUS_PRODUCT_ID + secretKey + publicKey + "checkout")

class FreemiusWebhookVerifier(private val secret: String) {
    fun verify(rawBody: ByteArray, signature: String?): Boolean {
        if (signature.isNullOrBlank()) return false
        val expected = hmacSha256Hex(secret, rawBody).toByteArray(Charsets.UTF_8)
        return MessageDigest.isEqual(expected, signature.lowercase().toByteArray(Charsets.UTF_8))
    }
}

data class FreemiusEvent(
    val type: String,
    val email: String?,
    val licenseId: String?,
    val planId: String?,
    // The subscription's own id, from the objects.subscription object of a subscription.created
    // payload. Freemius's payment objects reference it the same way (a real payment.refund
    // payload's "subscription_id" field, BillingWebhookTest.kt), so a subscription object's own
    // id field is "id", the same convention as every other Freemius entity in this file.
    val subscriptionId: String?,
    val expiresAt: Instant?,
    // The event's own id and time. Freemius sends these in the envelope's top-level "id" and
    // "created" fields (real payload, event 1417312989). BillingService uses the two values to
    // reject a replayed event and an out-of-order event.
    val eventId: String?,
    val eventTime: Instant?,
)

private val freemiusLog = LoggerFactory.getLogger("app.geostrategy.billing.Freemius")

// Real Freemius webhooks typically send MySQL-style timestamps ("2027-01-01 10:00:00", no
// zone), not ISO-8601 instants. Freemius timestamps are documented as UTC.
private val MYSQL_TIMESTAMP: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")

fun parseFreemiusEvent(rawBody: String): FreemiusEvent? {
    val root = try { Json.parseToJsonElement(rawBody).jsonObject } catch (e: Exception) { return null }
    val type = root.str("type") ?: return null
    val objects = root.obj("objects")
    val user = objects?.obj("user") ?: root.obj("user")
    val license = objects?.obj("license") ?: root.obj("license")
    val subscription = objects?.obj("subscription") ?: root.obj("subscription")
    return FreemiusEvent(
        type = type,
        email = user?.str("email")?.lowercase(),
        licenseId = license?.str("id"),
        planId = license?.str("plan_id"),
        subscriptionId = subscription?.str("id"),
        expiresAt = parseFreemiusTimestamp(license?.str("expiration")),
        eventId = root.str("id"),
        eventTime = parseFreemiusTimestamp(root.str("created")),
    )
}

/**
 * Parses a Freemius timestamp. Freemius uses this format for two fields: a license's
 * `expiration`, and an event's own `created` field. The function first tries an ISO-8601
 * instant. It then tries the MySQL-style timestamp that Freemius actually sends, and reads
 * that value as UTC.
 *
 * A present, non-blank value that matches neither format is a misconfiguration. The function
 * logs a warning and returns null. Do not treat that null as a safe default:
 * - A missing expiration is not "never expires". A cancelled user would then keep the pro tier.
 * - A missing event time is not "always in order". The event would then lose its replay check.
 */
private fun parseFreemiusTimestamp(raw: String?): Instant? {
    if (raw.isNullOrBlank()) return null
    try {
        return Instant.parse(raw)
    } catch (e: DateTimeParseException) {
        // fall through to the MySQL-style attempt below
    }
    try {
        return LocalDateTime.parse(raw, MYSQL_TIMESTAMP).toInstant(ZoneOffset.UTC)
    } catch (e: DateTimeParseException) {
        freemiusLog.warn("Unparseable Freemius timestamp value: '{}'", raw)
        return null
    }
}

private fun JsonObject.obj(key: String): JsonObject? = try { this[key]?.jsonObject } catch (e: Exception) { null }

// contentOrNull, not content: an explicit JSON null (a lifetime license's `expiration`, in a
// real licenses.retrieve response) must read as a missing value, not as the literal string
// "null", which parseFreemiusTimestamp would then log as an unparseable date.
private fun JsonObject.str(key: String): String? = try { this[key]?.jsonPrimitive?.contentOrNull } catch (e: Exception) { null }

/** A license's live state, from the Freemius API. `expiresAt` is null for a lifetime license. */
data class LicenseState(val active: Boolean, val expiresAt: Instant?)

/**
 * Asks the Freemius product-scope API for one license's live state. See
 * https://freemius.com/help/api/licenses/retrieve/: `GET
 * /v1/products/{product_id}/licenses/{license_id}.json`, Bearer token auth. The response has
 * `is_cancelled` (boolean) and `expiration` (nullable Freemius timestamp; null means a
 * lifetime license). Freemius has no single "is active" field, so this derives it: a license
 * is active when it is not cancelled and its expiration is null or still in the future.
 */
class HttpFreemiusClient(
    private val http: HttpClient,
    private val productId: String,
    private val apiToken: String,
    private val timeoutMillis: Long = 10_000,
) : FreemiusClient {
    private val log = LoggerFactory.getLogger(HttpFreemiusClient::class.java)

    // The timeout wraps the whole call, the body read included: a stalled response body must
    // not hang this user's check past timeoutMillis, the same way Crawler.kt bounds a whole
    // fetch (headers and body) rather than just the request that returns the headers.
    override suspend fun checkLicense(licenseId: String): LicenseState? = try {
        withTimeoutOrNull(timeoutMillis) {
            val response = http.get("https://api.freemius.com/v1/products/$productId/licenses/$licenseId.json") {
                header(HttpHeaders.Authorization, "Bearer $apiToken")
            }
            check(response.status.isSuccess()) { "HTTP ${response.status.value}" }
            val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject
            val isCancelled = body["is_cancelled"]?.jsonPrimitive?.booleanOrNull ?: false
            val expiresAt = parseFreemiusTimestamp(body.str("expiration"))
            LicenseState(active = !isCancelled && (expiresAt == null || expiresAt.isAfter(Instant.now())), expiresAt = expiresAt)
        } ?: run {
            log.warn("Freemius license lookup for {} timed out after {}ms", licenseId, timeoutMillis)
            null
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        log.warn("Freemius license lookup for {} failed: {}", licenseId, e.message)
        null
    }

    // See https://docs.freemius.com/api/subscriptions/cancel: `DELETE
    // /v1/products/{product_id}/subscriptions/{subscription_id}.json`, Bearer token auth.
    // Cancelling an already-cancelled subscription is also a 200, so any success status is a win.
    override suspend fun cancelSubscription(subscriptionId: String): Boolean = try {
        withTimeoutOrNull(timeoutMillis) {
            val response = http.delete("https://api.freemius.com/v1/products/$productId/subscriptions/$subscriptionId.json") {
                header(HttpHeaders.Authorization, "Bearer $apiToken")
            }
            if (!response.status.isSuccess()) log.warn("Freemius subscription cancel for {} failed: HTTP {}", subscriptionId, response.status.value)
            response.status.isSuccess()
        } ?: run {
            log.warn("Freemius subscription cancel for {} timed out after {}ms", subscriptionId, timeoutMillis)
            false
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        log.warn("Freemius subscription cancel for {} failed: {}", subscriptionId, e.message)
        false
    }

    // See https://freemius.com/blog/changelog/one-click-customer-portal-login-via-api/: `POST
    // /v1/products/{product_id}/portal/login.json`, Bearer token auth, body {"email": ...}.
    // The response has a "link" field: a magic login link into the customer portal, good for
    // 5 minutes. It logs the customer straight into the portal with no password of their own.
    override suspend fun portalLoginLink(email: String): String? = try {
        withTimeoutOrNull(timeoutMillis) {
            val response = http.post("https://api.freemius.com/v1/products/$productId/portal/login.json") {
                header(HttpHeaders.Authorization, "Bearer $apiToken")
                contentType(ContentType.Application.Json)
                setBody(buildJsonObject { put("email", email) }.toString())
            }
            check(response.status.isSuccess()) { "HTTP ${response.status.value}" }
            Json.parseToJsonElement(response.bodyAsText()).jsonObject.str("link")
        } ?: run {
            log.warn("Freemius portal login link for {} timed out after {}ms", email, timeoutMillis)
            null
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        log.warn("Freemius portal login link for {} failed: {}", email, e.message)
        null
    }
}
