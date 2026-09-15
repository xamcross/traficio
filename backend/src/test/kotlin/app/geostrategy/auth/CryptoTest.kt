package app.geostrategy.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class CryptoTest {
    @Test
    fun `password hash verifies and rejects`() {
        val hasher = PasswordHasher()
        val hash = hasher.hash("correct-horse")
        assertTrue(hash.startsWith("\$argon2id\$"))
        assertTrue(hasher.verify(hash, "correct-horse"))
        assertFalse(hasher.verify(hash, "wrong-horse"))
    }

    @Test
    fun `random tokens are unique and url-safe`() {
        val a = randomToken()
        val b = randomToken()
        assertNotEquals(a, b)
        assertTrue(a.matches(Regex("^[A-Za-z0-9_-]{43}$")))
    }

    @Test
    fun `sha256Hex is deterministic`() {
        assertEquals(sha256Hex("abc"), sha256Hex("abc"))
        assertEquals(64, sha256Hex("abc").length)
    }

    @Test
    fun `hmacSha256Hex over bytes matches the rfc vector and the String overload delegates to it`() {
        val bytes = "The quick brown fox jumps over the lazy dog".toByteArray(Charsets.UTF_8)
        val expected = "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
        assertEquals(expected, hmacSha256Hex("key", bytes))
        assertEquals(hmacSha256Hex("key", bytes), hmacSha256Hex("key", String(bytes, Charsets.UTF_8)))
    }

    @Test
    fun `md5Hex matches the known test vector for 'abc'`() {
        assertEquals("900150983cd24fb0d6963f7d28e17f72", md5Hex("abc"))
    }
}
