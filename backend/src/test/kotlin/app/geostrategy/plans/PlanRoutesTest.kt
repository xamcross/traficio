package app.geostrategy.plans

import app.geostrategy.MapFetcher
import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.assessment.AssessmentPipeline
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.crawl.Crawler
import app.geostrategy.makePro
import app.geostrategy.registerVerifyLogin
import app.geostrategy.testDeps
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import io.ktor.client.HttpClient
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PlanRoutesTest {
    private val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""

    /** Registers a verified user, creates a site, submits one assessment, and runs the pipeline. */
    private class Ready(val db: MongoDatabase, val emails: RecordingEmailSender, val http: HttpClient, val siteId: String, val assessmentId: String)

    private suspend fun ApplicationTestBuilder.readyAssessment(email: String = "ada@example.com"): Ready {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, email)
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        val assessmentId = Json.parseToJsonElement(http.post("/v1/sites/$siteId/assessments").bodyAsText())
            .jsonObject["id"]!!.jsonPrimitive.content
        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to html))), CannedClaudeClient(),
        )
        runBlocking { pipeline.handle(deps.jobs.claim()!!) }
        return Ready(db, emails, http, siteId, assessmentId)
    }

    @Test
    fun `free user gets a locked plan without steps and cannot patch a task`() = testApplication {
        val r = readyAssessment()
        val plan = Json.parseToJsonElement(r.http.get("/v1/assessments/${r.assessmentId}/plan").bodyAsText()).jsonObject
        assertEquals(true, plan["locked"]!!.jsonPrimitive.content.toBoolean())
        val first = plan["tasks"]!!.jsonArray.first().jsonObject
        assertTrue(first["title"]!!.jsonPrimitive.content.isNotBlank())
        assertEquals(3, first["stepCount"]!!.jsonPrimitive.content.toInt())
        assertEquals(JsonNull, first["steps"])
        assertEquals(JsonNull, first["whyItMatters"])
        assertEquals(JsonNull, first["doneCheck"])
        assertEquals("todo", first["status"]!!.jsonPrimitive.content)
        assertEquals(0, plan["progress"]!!.jsonObject["done"]!!.jsonPrimitive.content.toInt())

        // by-site variant is redacted the same way
        val bySite = Json.parseToJsonElement(r.http.get("/v1/sites/${r.siteId}/plan").bodyAsText()).jsonObject
        assertEquals(true, bySite["locked"]!!.jsonPrimitive.content.toBoolean())
        assertEquals(JsonNull, bySite["tasks"]!!.jsonArray.first().jsonObject["steps"])

        val planId = plan["id"]!!.jsonPrimitive.content
        val taskId = first["taskId"]!!.jsonPrimitive.content
        val patched = r.http.patch("/v1/plans/$planId/tasks/$taskId") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"done"}""")
        }
        assertEquals(HttpStatusCode.Forbidden, patched.status)
        assertTrue(patched.bodyAsText().contains("upgrade_required"))
        assertTrue(patched.bodyAsText().contains("The step-by-step plan is part of Pro. Upgrade to unlock it."))
    }

    @Test
    fun `pro user gets the full plan and can check off a task`() = testApplication {
        val r = readyAssessment()
        runBlocking { makePro(r.db, "ada@example.com") }

        val plan = Json.parseToJsonElement(r.http.get("/v1/assessments/${r.assessmentId}/plan").bodyAsText()).jsonObject
        assertFalse(plan["locked"]!!.jsonPrimitive.content.toBoolean())
        val first = plan["tasks"]!!.jsonArray.first().jsonObject
        assertEquals(3, first["steps"]!!.jsonArray.size)
        assertEquals(3, first["stepCount"]!!.jsonPrimitive.content.toInt())
        assertTrue(first["whyItMatters"]!!.jsonPrimitive.content.isNotBlank())
        assertTrue(first["doneCheck"]!!.jsonPrimitive.content.isNotBlank())

        val planId = plan["id"]!!.jsonPrimitive.content
        val taskId = first["taskId"]!!.jsonPrimitive.content
        val patched = r.http.patch("/v1/plans/$planId/tasks/$taskId") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"done"}""")
        }
        assertEquals(HttpStatusCode.OK, patched.status)
        val body = Json.parseToJsonElement(patched.bodyAsText()).jsonObject
        assertEquals(1, body["progress"]!!.jsonObject["done"]!!.jsonPrimitive.content.toInt())
        assertFalse(body["locked"]!!.jsonPrimitive.content.toBoolean())

        // latest plan by site works too
        assertTrue(r.http.get("/v1/sites/${r.siteId}/plan").bodyAsText().contains(planId))
    }

    @Test
    fun `a downgraded user keeps stored statuses inside the locked plan`() = testApplication {
        val r = readyAssessment()
        runBlocking { makePro(r.db, "ada@example.com") }
        val plan = Json.parseToJsonElement(r.http.get("/v1/assessments/${r.assessmentId}/plan").bodyAsText()).jsonObject
        val planId = plan["id"]!!.jsonPrimitive.content
        val taskId = plan["tasks"]!!.jsonArray.first().jsonObject["taskId"]!!.jsonPrimitive.content
        r.http.patch("/v1/plans/$planId/tasks/$taskId") { contentType(ContentType.Application.Json); setBody("""{"status":"done"}""") }

        // downgrade
        runBlocking {
            r.db.getCollection<app.geostrategy.users.User>("users")
                .updateOne(com.mongodb.client.model.Filters.eq("email", "ada@example.com"), com.mongodb.client.model.Updates.set("tier", "free"))
        }
        val locked = Json.parseToJsonElement(r.http.get("/v1/assessments/${r.assessmentId}/plan").bodyAsText()).jsonObject
        assertTrue(locked["locked"]!!.jsonPrimitive.content.toBoolean())
        assertEquals("done", locked["tasks"]!!.jsonArray.first().jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals(1, locked["progress"]!!.jsonObject["done"]!!.jsonPrimitive.content.toInt())
    }

    @Test
    fun `verified is not settable by users`() = testApplication {
        val r = readyAssessment()
        runBlocking { makePro(r.db, "ada@example.com") }
        val plan = runBlocking { PlanRepository(r.db).latestFor(org.bson.types.ObjectId(r.siteId))!! }
        val res = r.http.patch("/v1/plans/${plan.id.toHexString()}/tasks/${plan.tasks.first().taskId}") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"verified"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertTrue(res.bodyAsText().contains("invalid_status"))
    }

    @Test
    fun `unknown task id names the task in the 404`() = testApplication {
        val r = readyAssessment()
        runBlocking { makePro(r.db, "ada@example.com") }
        val plan = runBlocking { PlanRepository(r.db).latestFor(org.bson.types.ObjectId(r.siteId))!! }
        val res = r.http.patch("/v1/plans/${plan.id.toHexString()}/tasks/nope") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"done"}""")
        }
        assertEquals(HttpStatusCode.NotFound, res.status)
        assertTrue(res.bodyAsText().contains("task"))
    }

    @Test
    fun `another user's plan is 404 for free and pro alike`() = testApplication {
        val r = readyAssessment()
        val plan = runBlocking { PlanRepository(r.db).latestFor(org.bson.types.ObjectId(r.siteId))!! }
        // a second user on the same app; the app's recording sender delivers bob's token
        val http2 = createClient { install(HttpCookies) }
        registerVerifyLogin(http2, r.emails, "bob@example.com")
        assertEquals(HttpStatusCode.NotFound, http2.get("/v1/assessments/${r.assessmentId}/plan").status)
        val patched = http2.patch("/v1/plans/${plan.id.toHexString()}/tasks/${plan.tasks.first().taskId}") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"done"}""")
        }
        assertEquals(HttpStatusCode.NotFound, patched.status)
        runBlocking { makePro(r.db, "bob@example.com") }
        assertEquals(HttpStatusCode.NotFound, http2.get("/v1/assessments/${r.assessmentId}/plan").status)
    }
}
