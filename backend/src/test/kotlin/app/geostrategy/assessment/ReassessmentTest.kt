package app.geostrategy.assessment

import app.geostrategy.MapFetcher
import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.crawl.Crawler
import app.geostrategy.makePro
import app.geostrategy.plans.PlanRepository
import app.geostrategy.registerVerifyLogin
import app.geostrategy.testDeps
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.bson.types.ObjectId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ReassessmentTest {
    private val pageNoMeta = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
    private val pageWithMeta = """<html><head><title>T</title><meta name="description" content="Now present."></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
    private val homeLinkingToMenuNoMeta =
        """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p><a href="/menu">Menu</a></body></html>"""
    private val menuPageNoMeta =
        """<html><head><title>Menu</title></head><body><h1>Menu</h1><p>${"w ".repeat(60)}</p></body></html>"""
    private val homeLinkingToMenuWithMeta =
        """<html><head><title>T</title><meta name="description" content="Now present."></head><body><h1>H</h1><p>${"w ".repeat(60)}</p><a href="/menu">Menu</a></body></html>"""

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
        assertNotNull(fixedTask.completedAt)
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

    @Test
    fun `auto-verify skips the assessment's own plan on a resumed retry`() = testApplication {
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
        http.post("/v1/sites/$siteId/assessments")

        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to pageNoMeta))), CannedClaudeClient(),
        )
        runBlocking {
            val job = deps.jobs.claim()!!
            pipeline.handle(job)   // completes fully; plan inserted
            pipeline.handle(job)   // duplicate delivery / resumed retry: must be a no-op
            val plan = deps.plans.latestFor(ObjectId(siteId))!!
            assertTrue(plan.tasks.none { it.status == "verified" })
        }
    }

    @Test
    fun `auto-verify only fires for findings whose pages were actually re-crawled`() = testApplication {
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

        // run 1: crawls both the homepage and /menu, neither has a meta description
        http.post("/v1/sites/$siteId/assessments")
        val run1 = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf(
                "https://example.com" to homeLinkingToMenuNoMeta,
                "https://example.com/menu" to menuPageNoMeta,
            ))),
            CannedClaudeClient(),
        )
        runBlocking { run1.handle(deps.jobs.claim()!!) }
        val firstPlan = runBlocking { deps.plans.latestFor(siteOid)!! }
        assertTrue(firstPlan.tasks.any { it.findingId == "missing-meta-description:/" && it.status == "todo" })
        assertTrue(firstPlan.tasks.any { it.findingId == "missing-meta-description:/menu" && it.status == "todo" })

        // run 2: only the homepage is crawled (now with a meta description); /menu is unreachable this time
        http.post("/v1/sites/$siteId/assessments")
        val run2 = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to homeLinkingToMenuWithMeta))),
            CannedClaudeClient(),
        )
        runBlocking { run2.handle(deps.jobs.claim()!!) }

        val verifiedPlan = runBlocking { PlanRepository(db).findById(firstPlan.id)!! }
        val homeTask = verifiedPlan.tasks.first { it.findingId == "missing-meta-description:/" }
        assertEquals("verified", homeTask.status)
        // the /menu finding vanished only because the page wasn't crawled this run, not because it was fixed
        val menuTask = verifiedPlan.tasks.first { it.findingId == "missing-meta-description:/menu" }
        assertEquals("todo", menuTask.status)
    }

    @Test
    fun `history items carry what changed since the previous ready check`() = testApplication {
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

        suspend fun run(html: String) {
            http.post("/v1/sites/$siteId/assessments")
            val pipeline = AssessmentPipeline(deps.assessments, deps.sites, deps.plans, Crawler(MapFetcher(mapOf("https://example.com" to html))), CannedClaudeClient())
            pipeline.handle(deps.jobs.claim()!!)
        }
        run(pageNoMeta)
        // the user marks the low-impact task done between the two checks; the second run
        // does not touch its finding, so it stays done while the meta-description task
        // gets auto-verified.
        val plan1 = runBlocking { deps.plans.latestFor(ObjectId(siteId))!! }
        val doneTask = plan1.tasks.last()
        assertEquals(HttpStatusCode.OK, http.patch("/v1/plans/${plan1.id.toHexString()}/tasks/${doneTask.taskId}") {
            contentType(ContentType.Application.Json); setBody("""{"status":"done"}""")
        }.status)
        run(pageWithMeta)

        val items = Json.parseToJsonElement(http.get("/v1/sites/$siteId/assessments").bodyAsText()).jsonObject["assessments"]!!.jsonArray
        assertEquals(2, items.size)
        val newest = items[0].jsonObject
        val oldest = items[1].jsonObject
        assertEquals(0, oldest["changes"]!!.jsonArray.size)
        val kinds = newest["changes"]!!.jsonArray.map { it.jsonObject["kind"]!!.jsonPrimitive.content }
        assertTrue("done" in kinds, kinds.toString())
        assertTrue("verified" in kinds, kinds.toString())
        assertTrue(newest["changes"]!!.jsonArray.any { it.jsonObject["title"]!!.jsonPrimitive.content == doneTask.title })
    }
}
