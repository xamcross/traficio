package app.geostrategy.auth

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private val secureRandom = SecureRandom()

fun randomToken(): String {
    val bytes = ByteArray(32)
    secureRandom.nextBytes(bytes)
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}

fun sha256Hex(value: String): String =
    MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

// MD5 is weak for a signature, but the Freemius sandbox token formula requires it
// (https://freemius.com/help/documentation/checkout/integration/testing/). It is not
// used for a security decision here: the sandbox only ever opens for the emails in
// FREEMIUS_SANDBOX_EMAILS, checked before this function ever runs.
fun md5Hex(value: String): String =
    MessageDigest.getInstance("MD5")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

fun hmacSha256Hex(secret: String, body: ByteArray): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
    return mac.doFinal(body).joinToString("") { "%02x".format(it) }
}

fun hmacSha256Hex(secret: String, body: String): String =
    hmacSha256Hex(secret, body.toByteArray(Charsets.UTF_8))
