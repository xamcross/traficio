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

class LoginFlowTest {
    @Test
    fun `full journey - register, verify, login, me, logout`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        application { appModule(testDeps(db, email = emails)) }
        val http = createClient { install(HttpCookies) }

        // register
        http.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"correct-horse"}""")
        }

        // verify email using the token from the sent email
        val token = extractToken(emails.sent[0].html)
        val verify = http.post("/v1/auth/verify-email") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"$token"}""")
        }
        assertEquals(HttpStatusCode.OK, verify.status)

        // login sets the session cookie
        val login = http.post("/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"correct-horse"}""")
        }
        assertEquals(HttpStatusCode.OK, login.status)

        // me works with the cookie and shows the verified flag
        val me = http.get("/v1/me")
        assertEquals(HttpStatusCode.OK, me.status)
        assertTrue(me.bodyAsText().contains("\"emailVerified\":true"))

        // logout kills the session
        assertEquals(HttpStatusCode.NoContent, http.post("/v1/auth/logout").status)
        assertEquals(HttpStatusCode.Unauthorized, http.get("/v1/me").status)
    }

    @Test
    fun `login with wrong password or unknown email is a uniform 401`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db)) }
        val http = createClient { install(HttpCookies) }
        http.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"correct-horse"}""")
        }
        val wrongPw = http.post("/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"wrong-horse"}""")
        }
        val unknown = http.post("/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ghost@example.com","password":"whatever-pw"}""")
        }
        assertEquals(HttpStatusCode.Unauthorized, wrongPw.status)
        assertEquals(HttpStatusCode.Unauthorized, unknown.status)
        assertEquals(wrongPw.bodyAsText(), unknown.bodyAsText())
    }

    @Test
    fun `verify-email with bogus token returns 400 invalid_token`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }
        val res = client.post("/v1/auth/verify-email") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"bogus"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertTrue(res.bodyAsText().contains("invalid_token"))
    }
}
