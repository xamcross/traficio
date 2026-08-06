package app.geostrategy.billing

import app.geostrategy.auth.hmacSha256Hex
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

class FreemiusWebhookVerifier(private val secret: String) {
    fun verify(rawBody: String, signature: String?): Boolean {
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
        expiresAt = parseFreemiusExpiration(license?.str("expiration")),
    )
}

/**
 * Parses a Freemius `expiration` value. Tries an ISO-8601 instant first, then falls back to
 * the MySQL-style timestamp Freemius actually sends, interpreted as UTC. A value that is
 * present and non-blank but matches neither format is a misconfiguration worth surfacing:
 * silently treating it as "never expires" would let a cancelled user keep pro forever.
 */
private fun parseFreemiusExpiration(raw: String?): Instant? {
    if (raw.isNullOrBlank()) return null
    try {
        return Instant.parse(raw)
    } catch (e: DateTimeParseException) {
        // fall through to the MySQL-style attempt below
    }
    try {
        return LocalDateTime.parse(raw, MYSQL_TIMESTAMP).toInstant(ZoneOffset.UTC)
    } catch (e: DateTimeParseException) {
        freemiusLog.warn("Unparseable Freemius license expiration value: '{}'", raw)
        return null
    }
}

private fun JsonObject.obj(key: String): JsonObject? = try { this[key]?.jsonObject } catch (e: Exception) { null }
private fun JsonObject.str(key: String): String? = try { this[key]?.jsonPrimitive?.content } catch (e: Exception) { null }
