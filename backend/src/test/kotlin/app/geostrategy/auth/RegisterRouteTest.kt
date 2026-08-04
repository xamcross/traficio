package app.geostrategy.auth

import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.testDeps
import app.geostrategy.users.UserRepository
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class RegisterRouteTest {
    @Test
    fun `register lowercases email, stores hash, emails verification token`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        application { appModule(testDeps(db, email = emails)) }

        val res = client.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"Ada@Example.com","password":"correct-horse"}""")
        }
        assertEquals(HttpStatusCode.Created, res.status)

        val user = runBlocking { UserRepository(db).findByEmail("ada@example.com") }
        assertNotNull(user)
        assertFalse(user.emailVerified)
        assertTrue(user.passwordHash!!.startsWith("\$argon2id\$"))
        assertEquals(1, emails.sent.size)
        assertTrue(emails.sent[0].html.contains("token="))
    }

    @Test
    fun `weak password and bad email are rejected`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }
        val weak = client.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"a@b.co","password":"short"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, weak.status)
        assertTrue(weak.bodyAsText().contains("weak_password"))

        val bad = client.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"not-an-email","password":"long-enough-pw"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, bad.status)
        assertTrue(bad.bodyAsText().contains("invalid_email"))
    }

    @Test
    fun `duplicate email returns 409`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db)) }
        suspend fun register() = client.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"dup@example.com","password":"correct-horse"}""")
        }
        assertEquals(HttpStatusCode.Created, register().status)
        assertEquals(HttpStatusCode.Conflict, register().status)
    }
}
