package app.geostrategy.assessment

import app.geostrategy.MapFetcher
import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.crawl.Crawler
import app.geostrategy.plans.PlanRepository
import app.geostrategy.registerVerifyLogin
import app.geostrategy.testDeps
import app.geostrategy.users.User
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Updates.set
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
import org.bson.types.ObjectId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ReassessmentTest {
    private val pageNoMeta = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
    private val pageWithMeta = """<html><head><title>T</title><meta name="description" content="Now present."></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""

    private suspend fun makePro(db: com.mongodb.kotlin.client.coroutine.MongoDatabase, email: String) {
        db.getCollection<User>("users").updateOne(eq("email", email), set("tier", "pro"))
    }

    @Test
    fun `free user cannot re-assess, pro user can, history is pro-only`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content

        assertEquals(HttpStatusCode.Accepted, http.post("/v1/sites/$siteId/assessments").status)
        val again = http.post("/v1/sites/$siteId/assessments")
        assertEquals(HttpStatusCode.Forbidden, again.status)
        assertTrue(again.bodyAsText().contains("upgrade_required"))
        assertEquals(HttpStatusCode.Forbidden, http.get("/v1/sites/$siteId/assessments").status)

        runBlocking { makePro(db, "ada@example.com") }
        assertEquals(HttpStatusCode.Accepted, http.post("/v1/sites/$siteId/assessments").status)
        val history = http.get("/v1/sites/$siteId/assessments")
        assertEquals(HttpStatusCode.OK, history.status)
        assertTrue(history.bodyAsText().contains("queued"))
    }

    @Test
    fun `re-assessment auto-verifies fixed tasks in the previous plan`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        runBlocking { makePro(db, "ada@example.com") }
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        val siteOid = ObjectId(siteId)

        // run 1: page without meta description
        http.post("/v1/sites/$siteId/assessments")
        val run1 = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to pageNoMeta))), CannedClaudeClient(),
        )
        runBlocking { run1.handle(deps.jobs.claim()!!) }
        val firstPlan = runBlocking { deps.plans.latestFor(siteOid)!! }
        assertTrue(firstPlan.tasks.any { it.findingId == "missing-meta-description:/" && it.status == "todo" })

        // run 2: meta description fixed
        http.post("/v1/sites/$siteId/assessments")
        val run2 = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to pageWithMeta))), CannedClaudeClient(),
        )
        runBlocking { run2.handle(deps.jobs.claim()!!) }

        val verifiedPlan = runBlocking { PlanRepository(db).findById(firstPlan.id)!! }
        val fixedTask = verifiedPlan.tasks.first { it.findingId == "missing-meta-description:/" }
        assertEquals("verified", fixedTask.status)
        // a task whose finding still exists stays todo
        val stillOpen = verifiedPlan.tasks.first { it.findingId == "missing-llms-txt" }
        assertEquals("todo", stillOpen.status)
    }

    @Test
    fun `pro user hits the quota when the pro monthly limit is reached`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails, env = mapOf("PRO_ASSESSMENTS_PER_MONTH" to "1"))
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        runBlocking { makePro(db, "ada@example.com") }
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        assertEquals(HttpStatusCode.Accepted, http.post("/v1/sites/$siteId/assessments").status)
        val second = http.post("/v1/sites/$siteId/assessments")
        assertEquals(HttpStatusCode.Forbidden, second.status)
        assertTrue(second.bodyAsText().contains("quota_exceeded"))
    }

    @Test
    fun `ready assessment sends the plan-is-ready email`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        http.post("/v1/sites/$siteId/assessments")
        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to pageNoMeta))), CannedClaudeClient(),
            emailSender = deps.emailSender, users = app.geostrategy.users.UserRepository(db),
        )
        runBlocking { pipeline.handle(deps.jobs.claim()!!) }
        assertTrue(emails.sent.any { it.subject.contains("ready", ignoreCase = true) })
    }
}
