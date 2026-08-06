package app.geostrategy.users

import app.geostrategy.TestMongo
import app.geostrategy.http.AppException
import kotlinx.coroutines.runBlocking
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class UserRepositoryTest {
    private fun newUser(email: String) =
        User(email = email, passwordHash = "x", createdAt = Instant.now(), updatedAt = Instant.now())

    @Test
    fun `insert then find by email and id`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val saved = repo.insert(newUser("ada@example.com"))
        assertEquals("ada@example.com", repo.findByEmail("ada@example.com")?.email)
        assertNotNull(repo.findById(saved.id))
        assertNull(repo.findByEmail("nobody@example.com"))
    }

    @Test
    fun `duplicate email raises email_taken`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        repo.insert(newUser("dup@example.com"))
        val e = assertFailsWith<AppException> { repo.insert(newUser("dup@example.com")) }
        assertEquals("email_taken", e.code)
    }

    @Test
    fun `updates flip flags and fields`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val u = repo.insert(newUser("flip@example.com"))
        repo.setEmailVerified(u.id)
        repo.setPasswordHash(u.id, "newhash")
        repo.linkGoogle(u.id, "google-sub-1")
        val loaded = repo.findById(u.id)!!
        assertTrue(loaded.emailVerified)
        assertEquals("newhash", loaded.passwordHash)
        assertEquals("google-sub-1", loaded.googleId)
    }

    @Test
    fun `downgradeProIfMatches only writes when the observed billing state still matches`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val u = repo.insert(newUser("renew@example.com"))
        val originalExpiresAt = Instant.now().plusSeconds(3600)
        repo.setBilling(u.id, "pro", FreemiusInfo(licenseId = "L1", expiresAt = originalExpiresAt))

        // A renewal webhook lands concurrently between the revalidator's read and its write.
        val renewedExpiresAt = originalExpiresAt.plusSeconds(3600)
        repo.setBilling(u.id, "pro", FreemiusInfo(licenseId = "L2", expiresAt = renewedExpiresAt))

        // A downgrade based on the stale, pre-renewal snapshot must not apply.
        val stale = repo.downgradeProIfMatches(u.id, expectedLicenseId = "L1", expectedExpiresAt = originalExpiresAt)
        assertFalse(stale)
        assertEquals("pro", repo.findById(u.id)!!.tier)
        assertEquals("L2", repo.findById(u.id)!!.freemius!!.licenseId)

        // A downgrade based on the current, matching snapshot must apply.
        val matching = repo.downgradeProIfMatches(u.id, expectedLicenseId = "L2", expectedExpiresAt = renewedExpiresAt)
        assertTrue(matching)
        assertEquals("free", repo.findById(u.id)!!.tier)
    }
}
