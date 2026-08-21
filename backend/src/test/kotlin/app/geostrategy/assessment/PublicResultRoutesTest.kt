package app.geostrategy.assessment

import app.geostrategy.AppDeps
import app.geostrategy.MapFetcher
import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.crawl.Crawler
import app.geostrategy.registerVerifyLogin
import app.geostrategy.testDeps
import io.ktor.client.HttpClient
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Tests for the owner-controlled public share of an assessment result: the two owner-only
 * share/unshare routes and the unauthenticated public read route.
 */
class PublicResultRoutesTest {

    private suspend fun createSite(http: HttpClient): String {
        val res = http.post("/v1/sites") {
            contentType(ContentType.Application.Json)
            setBody("""{"url":"example.com"}""")
        }
        return Json.parseToJsonElement(res.bodyAsText()).jsonObject["id"]!!.jsonPrimitive.content
    }

    /** Submits an assessment for the site and runs it to "ready" with the canned Claude client. */
    private suspend fun readyAssessmentId(http: HttpClient, deps: AppDeps, siteId: String): String {
        val id = Json.parseToJsonElement(http.post("/v1/sites/$siteId/assessments").bodyAsText())
            .jsonObject["id"]!!.jsonPrimitive.content
        val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to html))), CannedClaudeClient(),
        )
        pipeline.handle(deps.jobs.claim()!!)
        return id
    }

    private suspend fun shareSlug(http: HttpClient, id: String): String =
        Json.parseToJsonElement(http.post("/v1/assessments/$id/share").bodyAsText())
            .jsonObject["slug"]!!.jsonPrimitive.content

    @Test
    fun `share returns a slug and a second call returns the same slug`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = createSite(http)
        val id = readyAssessmentId(http, deps, siteId)

        val first = http.post("/v1/assessments/$id/share")
        assertEquals(HttpStatusCode.OK, first.status)
        val slug1 = Json.parseToJsonElement(first.bodyAsText()).jsonObject["slug"]!!.jsonPrimitive.content
        assertTrue(slug1.isNotBlank())
        // a slug with at least 128 bits of entropy, URL-safe and lowercase, is at least 32
        // lowercase hex characters
        assertTrue(slug1.length >= 32)
        assertTrue(slug1.all { it.isDigit() || it in 'a'..'f' })

        val second = http.post("/v1/assessments/$id/share")
        assertEquals(HttpStatusCode.OK, second.status)
        val slug2 = Json.parseToJsonElement(second.bodyAsText()).jsonObject["slug"]!!.jsonPrimitive.content
        assertEquals(slug1, slug2)
    }

    @Test
    fun `share on a non-ready assessment returns 409`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = createSite(http)
        val id = Json.parseToJsonElement(http.post("/v1/sites/$siteId/assessments").bodyAsText())
            .jsonObject["id"]!!.jsonPrimitive.content

        val res = http.post("/v1/assessments/$id/share")
        assertEquals(HttpStatusCode.Conflict, res.status)
        assertTrue(res.bodyAsText().contains("not_ready"))
    }

    @Test
    fun `share on another user's assessment returns 404`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val ada = createClient { install(HttpCookies) }
        registerVerifyLogin(ada, emails, "ada@example.com")
        val siteId = createSite(ada)
        val id = readyAssessmentId(ada, deps, siteId)

        val bob = createClient { install(HttpCookies) }
        registerVerifyLogin(bob, emails, "bob@example.com")
        val res = bob.post("/v1/assessments/$id/share")
        assertEquals(HttpStatusCode.NotFound, res.status)
    }

    @Test
    fun `public endpoint serves a shared result with no cookie and hides private fields`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = createSite(http)
        val id = readyAssessmentId(http, deps, siteId)
        val slug = shareSlug(http, id)

        // a plain client with no cookie jar: it never carries a session cookie
        val anon = createClient {}
        val res = anon.get("/v1/public/results/$slug")
        assertEquals(HttpStatusCode.OK, res.status)
        val body = res.bodyAsText()
        val json = Json.parseToJsonElement(body).jsonObject
        assertEquals("example.com", json["domain"]!!.jsonPrimitive.content)
        assertTrue(json.containsKey("scores"))
        assertTrue(json.containsKey("scoreNotes"))
        assertTrue(json.containsKey("findings"))
        assertTrue(json.containsKey("summary"))
        assertTrue(json.containsKey("createdAt"))

        // none of the private assessment fields, cost fields, token counts, or paid-plan
        // fields appear anywhere in the serialised JSON
        for (needle in listOf(
            "userId", "siteId", "costUsd", "inputTokens", "outputTokens", "crawlDigest",
            "email", "whyItMatters", "doneCheck", "effortMinutes", "steps", "affectedPages",
        )) {
            assertFalse(body.contains(needle), "public JSON leaked \"$needle\": $body")
        }
    }

    @Test
    fun `public endpoint 404s for an unshared assessment and for an unknown slug`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = createSite(http)
        readyAssessmentId(http, deps, siteId) // never shared

        val anon = createClient {}
        assertEquals(HttpStatusCode.NotFound, anon.get("/v1/public/results/does-not-exist").status)
    }

    @Test
    fun `unshare makes the public endpoint 404 again and is idempotent`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = createSite(http)
        val id = readyAssessmentId(http, deps, siteId)
        val slug = shareSlug(http, id)

        val anon = createClient {}
        assertEquals(HttpStatusCode.OK, anon.get("/v1/public/results/$slug").status)

        val del = http.delete("/v1/assessments/$id/share")
        assertEquals(HttpStatusCode.NoContent, del.status)
        assertEquals(HttpStatusCode.NotFound, anon.get("/v1/public/results/$slug").status)

        // a second unshare of the same, already-private assessment still succeeds
        assertEquals(HttpStatusCode.NoContent, http.delete("/v1/assessments/$id/share").status)
    }
}
