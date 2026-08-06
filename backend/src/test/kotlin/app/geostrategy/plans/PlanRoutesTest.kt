package app.geostrategy.plans

import app.geostrategy.MapFetcher
import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.assessment.AssessmentPipeline
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.crawl.Crawler
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
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PlanRoutesTest {
    private val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""

    @Test
    fun `full journey - submit, pipeline runs, read plan, check off a task`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")

        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") {
                contentType(ContentType.Application.Json)
                setBody("""{"url":"example.com"}""")
            }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        val assessmentId = Json.parseToJsonElement(
            http.post("/v1/sites/$siteId/assessments").bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content

        // run the pipeline inline against the queued job
        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to html))), CannedClaudeClient(),
        )
        runBlocking { pipeline.handle(deps.jobs.claim()!!) }

        val planBody = http.get("/v1/assessments/$assessmentId/plan").bodyAsText()
        val plan = Json.parseToJsonElement(planBody).jsonObject
        val planId = plan["id"]!!.jsonPrimitive.content
        val firstTask = plan["tasks"]!!.jsonArray.first().jsonObject["taskId"]!!.jsonPrimitive.content
        assertEquals(0, plan["progress"]!!.jsonObject["done"]!!.jsonPrimitive.content.toInt())

        val patched = http.patch("/v1/plans/$planId/tasks/$firstTask") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"done"}""")
        }
        assertEquals(HttpStatusCode.OK, patched.status)
        val progress = Json.parseToJsonElement(patched.bodyAsText()).jsonObject["progress"]!!.jsonObject
        assertEquals(1, progress["done"]!!.jsonPrimitive.content.toInt())

        // latest plan by site works too
        assertTrue(http.get("/v1/sites/$siteId/plan").bodyAsText().contains(planId))
    }

    @Test
    fun `verified is not settable by users`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") {
                contentType(ContentType.Application.Json)
                setBody("""{"url":"example.com"}""")
            }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        http.post("/v1/sites/$siteId/assessments")
        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to html))), CannedClaudeClient(),
        )
        runBlocking { pipeline.handle(deps.jobs.claim()!!) }
        val plan = runBlocking { deps.plans.latestFor(org.bson.types.ObjectId(siteId))!! }

        val res = http.patch("/v1/plans/${plan.id.toHexString()}/tasks/${plan.tasks.first().taskId}") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"verified"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertTrue(res.bodyAsText().contains("invalid_status"))
    }

    @Test
    fun `unknown task id names the task in the 404`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") {
                contentType(ContentType.Application.Json)
                setBody("""{"url":"example.com"}""")
            }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        http.post("/v1/sites/$siteId/assessments")
        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to html))), CannedClaudeClient(),
        )
        runBlocking { pipeline.handle(deps.jobs.claim()!!) }
        val plan = runBlocking { deps.plans.latestFor(org.bson.types.ObjectId(siteId))!! }

        val res = http.patch("/v1/plans/${plan.id.toHexString()}/tasks/nope") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"done"}""")
        }
        assertEquals(HttpStatusCode.NotFound, res.status)
        assertTrue(res.bodyAsText().contains("task"))
    }
}
