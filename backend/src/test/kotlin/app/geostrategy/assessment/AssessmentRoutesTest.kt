package app.geostrategy.assessment

import app.geostrategy.MapFetcher
import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.crawl.Crawler
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
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Deterministically simulates a concurrent racer: on the FIRST call to [insert] (the route's
 * own insert, issued right after its pre-insert quota check has already passed), a second
 * assessment for the same user/site is inserted directly, bypassing the route entirely. This
 * reproduces the exact window the route's post-insert recheck is meant to close, without
 * relying on real request concurrency (which can't deterministically force both requests past
 * the pre-check before either insert lands).
 */
private class RacingAssessmentRepository(db: MongoDatabase) : AssessmentRepository(db) {
    private val raw = db.getCollection<Assessment>("assessments")
    private var racerInserted = false

    override suspend fun insert(a: Assessment): Assessment {
        if (!racerInserted) {
            racerInserted = true
            val now = Instant.now()
            raw.insertOne(Assessment(siteId = a.siteId, userId = a.userId, createdAt = now, updatedAt = now))
        }
        return super.insert(a)
    }
}

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
    fun `verified user submits, gets 202, job is queued, second submit needs pro`() = testApplication {
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
        assertTrue(second.bodyAsText().contains("upgrade_required"))
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

    @Test
    fun `quota recheck removes a raced insert`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails, assessments = RacingAssessmentRepository(db))
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = createSite(http)

        // The route's pre-insert quota check passes (the account has zero assessments this
        // month at that point). The instant it calls insert(), the racer sneaks in and commits
        // its own assessment first, so the post-insert recheck finds the account over its
        // monthly limit of 1 and rolls this request's own insert back, before it's ever
        // enqueued.
        val res = http.post("/v1/sites/$siteId/assessments")
        assertEquals(HttpStatusCode.Forbidden, res.status)
        assertTrue(res.bodyAsText().contains("quota_exceeded"))

        val user = runBlocking { deps.users.findByEmail("ada@example.com")!! }
        // only the racer's assessment survives
        assertEquals(1L, runBlocking { deps.assessments.countNonFailedForUserSince(user.id, Instant.EPOCH) })
        // the rolled-back assessment was never enqueued
        assertNull(runBlocking { deps.jobs.claim() })
    }

    @Test
    fun `assessment dto carries summary, score notes, overall and page count after the pipeline`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        val assessmentId = Json.parseToJsonElement(http.post("/v1/sites/$siteId/assessments").bodyAsText())
            .jsonObject["id"]!!.jsonPrimitive.content

        val queued = Json.parseToJsonElement(http.get("/v1/assessments/$assessmentId").bodyAsText()).jsonObject
        assertEquals(JsonNull, queued["summary"])
        assertEquals(JsonNull, queued["pageCount"])

        val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to html))), CannedClaudeClient(),
        )
        runBlocking { pipeline.handle(deps.jobs.claim()!!) }

        val ready = Json.parseToJsonElement(http.get("/v1/assessments/$assessmentId").bodyAsText()).jsonObject
        assertEquals("ready", ready["status"]!!.jsonPrimitive.content)
        assertTrue(ready["summary"]!!.jsonPrimitive.content.isNotBlank())
        assertTrue(ready["scoreNotes"]!!.jsonObject["geo"]!!.jsonPrimitive.content.isNotBlank())
        assertEquals(1, ready["pageCount"]!!.jsonPrimitive.content.toInt())
        val scores = ready["scores"]!!.jsonObject
        val expectedOverall = Math.round((scores["seo"]!!.jsonPrimitive.content.toInt() + scores["aeo"]!!.jsonPrimitive.content.toInt() + scores["geo"]!!.jsonPrimitive.content.toInt()) / 3.0).toInt()
        assertEquals(expectedOverall, scores["overall"]!!.jsonPrimitive.content.toInt())
    }
}
