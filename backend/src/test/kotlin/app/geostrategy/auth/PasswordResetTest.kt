package app.geostrategy.auth

import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.extractToken
import app.geostrategy.testDeps
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PasswordResetTest {
    @Test
    fun `reset flow changes password and revokes sessions`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        application { appModule(testDeps(db, email = emails)) }
        val http = createClient { install(HttpCookies) }

        http.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"old-password-1"}""")
        }
        http.post("/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"old-password-1"}""")
        }
        assertEquals(HttpStatusCode.OK, http.get("/v1/me").status)

        val req = http.post("/v1/auth/password-reset/request") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com"}""")
        }
        assertEquals(HttpStatusCode.Accepted, req.status)
        val token = extractToken(emails.sent.last().html)

        val confirm = http.post("/v1/auth/password-reset/confirm") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"$token","newPassword":"new-password-2"}""")
        }
        assertEquals(HttpStatusCode.OK, confirm.status)

        // old session is dead
        assertEquals(HttpStatusCode.Unauthorized, http.get("/v1/me").status)
        // old password no longer works, new one does
        val oldLogin = http.post("/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"old-password-1"}""")
        }
        assertEquals(HttpStatusCode.Unauthorized, oldLogin.status)
        val newLogin = http.post("/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"new-password-2"}""")
        }
        assertEquals(HttpStatusCode.OK, newLogin.status)
    }

    @Test
    fun `request for unknown email still returns 202 and sends nothing`() = testApplication {
        val emails = RecordingEmailSender()
        application { appModule(testDeps(TestMongo.freshDb(), email = emails)) }
        val res = client.post("/v1/auth/password-reset/request") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ghost@example.com"}""")
        }
        assertEquals(HttpStatusCode.Accepted, res.status)
        assertEquals(0, emails.sent.size)
    }

    @Test
    fun `confirm with bad token is rejected`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }
        val res = client.post("/v1/auth/password-reset/confirm") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"bogus","newPassword":"long-enough-pw"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertTrue(res.bodyAsText().contains("invalid_token"))
    }
}
