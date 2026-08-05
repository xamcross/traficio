package app.geostrategy.billing

import app.geostrategy.auth.hmacSha256Hex
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.security.MessageDigest
import java.time.Instant

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

fun parseFreemiusEvent(rawBody: String): FreemiusEvent? {
    val root = try { Json.parseToJsonElement(rawBody).jsonObject } catch (e: Exception) { return null }
    val type = root.str("type") ?: return null
    val objects = root.obj("objects")
    val user = objects?.obj("user") ?: root.obj("user")
    val license = objects?.obj("license") ?: root.obj("license")
    val expiresAt = license?.str("expiration")?.let {
        try { Instant.parse(it) } catch (e: Exception) { null }
    }
    return FreemiusEvent(
        type = type,
        email = user?.str("email")?.lowercase(),
        licenseId = license?.str("id"),
        planId = license?.str("plan_id"),
        expiresAt = expiresAt,
    )
}

private fun JsonObject.obj(key: String): JsonObject? = try { this[key]?.jsonObject } catch (e: Exception) { null }
private fun JsonObject.str(key: String): String? = try { this[key]?.jsonPrimitive?.content } catch (e: Exception) { null }
