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
}
