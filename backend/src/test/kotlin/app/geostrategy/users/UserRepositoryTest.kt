package app.geostrategy.users

import app.geostrategy.TestMongo
import app.geostrategy.http.AppException
import kotlinx.coroutines.runBlocking
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
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
}
