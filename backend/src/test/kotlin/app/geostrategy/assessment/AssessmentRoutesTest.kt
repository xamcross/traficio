package app.geostrategy.assessment

import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.registerAndLogin
import app.geostrategy.registerVerifyLogin
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
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class AssessmentRoutesTest {
    private suspend fun createSite(http: io.ktor.client.HttpClient): String {
        val res = http.post("/v1/sites") {
            contentType(ContentType.Application.Json)
            setBody("""{"url":"example.com"}""")
        }
        return Json.parseToJsonElement(res.bodyAsText()).jsonObject["id"]!!.jsonPrimitive.content
    }

    @Test
    fun `submission needs a verified email`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val siteId = createSite(http)
        val res = http.post("/v1/sites/$siteId/assessments")
        assertEquals(HttpStatusCode.Forbidden, res.status)
        assertTrue(res.bodyAsText().contains("email_not_verified"))
    }

    @Test
    fun `verified user submits, gets 202, job is queued, second submit hits quota`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = createSite(http)

        val res = http.post("/v1/sites/$siteId/assessments")
        assertEquals(HttpStatusCode.Accepted, res.status)
        assertEquals("queued", Json.parseToJsonElement(res.bodyAsText()).jsonObject["status"]!!.jsonPrimitive.content)
        assertNotNull(runBlocking { deps.jobs.claim() })

        val second = http.post("/v1/sites/$siteId/assessments")
        assertEquals(HttpStatusCode.Forbidden, second.status)
        assertTrue(second.bodyAsText().contains("quota_exceeded"))
    }

    @Test
    fun `sse stream reports a terminal status`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = createSite(http)
        val id = Json.parseToJsonElement(
            http.post("/v1/sites/$siteId/assessments").bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content

        runBlocking { deps.assessments.markFailed(org.bson.types.ObjectId(id), "js_only_site", "We can't read this site.") }
        val events = http.get("/v1/assessments/$id/events")
        assertTrue(events.bodyAsText().contains("\"status\":\"failed\""))
    }

    @Test
    fun `resend verification issues a fresh working token`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        application { appModule(testDeps(db, email = emails)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        assertEquals(HttpStatusCode.Accepted, http.post("/v1/auth/resend-verification").status)
        assertEquals(2, emails.sent.size)
        val token = app.geostrategy.extractToken(emails.sent.last().html)
        val verify = http.post("/v1/auth/verify-email") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"$token"}""")
        }
        assertEquals(HttpStatusCode.OK, verify.status)
    }

    @Test
    fun `assessment access is owner-only`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val ada = createClient { install(HttpCookies) }
        registerVerifyLogin(ada, emails, "ada@example.com")
        val siteId = createSite(ada)
        val id = Json.parseToJsonElement(ada.post("/v1/sites/$siteId/assessments").bodyAsText()).jsonObject["id"]!!.jsonPrimitive.content

        val bob = createClient { install(HttpCookies) }
        registerVerifyLogin(bob, emails, "bob@example.com")
        assertEquals(HttpStatusCode.NotFound, bob.get("/v1/assessments/$id").status)
    }
}
