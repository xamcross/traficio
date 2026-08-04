package app.geostrategy.auth

import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.testDeps
import app.geostrategy.users.User
import app.geostrategy.users.UserRepository
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class FakeGoogleIdentityClient(private val email: String = "ada@example.com") : GoogleIdentityClient {
    override suspend fun exchange(code: String, redirectUri: String): GoogleIdentity {
        check(code == "good-code") { "unexpected code" }
        return GoogleIdentity(subject = "google-sub-1", email = email, emailVerified = true)
    }
}

class GoogleAuthTest {
    @Test
    fun `start redirects to google and sets state cookie`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb(), google = FakeGoogleIdentityClient())) }
        val http = createClient { followRedirects = false; install(HttpCookies) }
        val res = http.get("/v1/auth/google/start")
        assertEquals(HttpStatusCode.Found, res.status)
        val location = res.headers[HttpHeaders.Location]!!
        assertTrue(location.startsWith("https://accounts.google.com/o/oauth2/v2/auth"))
        assertTrue(location.contains("state="))
    }

    @Test
    fun `callback creates a verified user, session, and redirects to the app`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, google = FakeGoogleIdentityClient())) }
        val http = createClient { followRedirects = false; install(HttpCookies) }

        val start = http.get("/v1/auth/google/start")
        val state = Url(start.headers[HttpHeaders.Location]!!).parameters["state"]!!

        val cb = http.get("/v1/auth/google/callback?code=good-code&state=$state")
        assertEquals(HttpStatusCode.Found, cb.status)
        assertTrue(cb.headers[HttpHeaders.Location]!!.endsWith("/auth/complete"))

        val user = runBlocking { UserRepository(db).findByEmail("ada@example.com") }
        assertNotNull(user)
        assertTrue(user.emailVerified)
        assertEquals("google-sub-1", user.googleId)

        // session cookie works
        assertEquals(HttpStatusCode.OK, http.get("/v1/me").status)
    }

    @Test
    fun `callback links google to an existing email account`() = testApplication {
        val db = TestMongo.freshDb()
        runBlocking {
            UserRepository(db).insert(
                User(email = "ada@example.com", passwordHash = "x", createdAt = Instant.now(), updatedAt = Instant.now()),
            )
        }
        application { appModule(testDeps(db, google = FakeGoogleIdentityClient())) }
        val http = createClient { followRedirects = false; install(HttpCookies) }
        val state = Url(http.get("/v1/auth/google/start").headers[HttpHeaders.Location]!!).parameters["state"]!!
        http.get("/v1/auth/google/callback?code=good-code&state=$state")

        val user = runBlocking { UserRepository(db).findByEmail("ada@example.com") }!!
        assertEquals("google-sub-1", user.googleId)
    }

    @Test
    fun `callback with mismatched state is rejected`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb(), google = FakeGoogleIdentityClient())) }
        val http = createClient { followRedirects = false; install(HttpCookies) }
        http.get("/v1/auth/google/start")
        val res = http.get("/v1/auth/google/callback?code=good-code&state=WRONG")
        assertEquals(HttpStatusCode.BadRequest, res.status)
    }

    @Test
    fun `start returns 404 when google is not configured`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb(), google = null)) }
        val res = client.get("/v1/auth/google/start")
        assertEquals(HttpStatusCode.NotFound, res.status)
    }
}
