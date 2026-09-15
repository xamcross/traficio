package app.geostrategy.billing

import app.geostrategy.auth.hmacSha256Hex
import app.geostrategy.auth.md5Hex
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
    return FreemiusEvent(
        type = type,
        email = user?.str("email")?.lowercase(),
        licenseId = license?.str("id"),
        planId = license?.str("plan_id"),
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
private fun JsonObject.str(key: String): String? = try { this[key]?.jsonPrimitive?.content } catch (e: Exception) { null }
