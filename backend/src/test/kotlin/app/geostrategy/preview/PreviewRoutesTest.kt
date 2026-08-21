package app.geostrategy.preview

import app.geostrategy.MapFetcher
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.assessment.SsrfGuard
import app.geostrategy.claude.AnalysisResult
import app.geostrategy.claude.ClaudeClient
import app.geostrategy.claude.ClaudeResponse
import app.geostrategy.claude.PlanResult
import app.geostrategy.crawl.CrawlDigest
import app.geostrategy.crawl.Crawler
import app.geostrategy.testDeps
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.bson.Document
import java.net.InetAddress
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** A Claude client that fails the test the instant either method runs. */
private class FailingClaudeClient : ClaudeClient {
    override suspend fun analyze(digest: CrawlDigest): ClaudeResponse<AnalysisResult> =
        fail("the preview endpoint must not call ClaudeClient.analyze")

    override suspend fun plan(analysis: AnalysisResult, platform: String): ClaudeResponse<PlanResult> =
        fail("the preview endpoint must not call ClaudeClient.plan")
}

private fun checksById(body: String): Map<String, JsonObject> =
    Json.parseToJsonElement(body).jsonObject["checks"]!!.jsonArray
        .associate { it.jsonObject["id"]!!.jsonPrimitive.content to it.jsonObject }

class PreviewRoutesTest {
    @Test
    fun `preview of a normal site returns checks and a domain, with no session cookie`() = testApplication {
        val db = TestMongo.freshDb()
        val html = """
            <html>
            <head><title>Acme Coffee Co</title><meta name="description" content="Great coffee, roasted daily."></head>
            <body><h1>Welcome</h1><p>${"word ".repeat(310)}</p><img src="a.jpg" alt="a cup of coffee"></body>
            </html>
        """.trimIndent()
        val pages = mapOf(
            "https://example.com" to html,
            "https://example.com/sitemap.xml" to "<urlset><url><loc>https://example.com/</loc></url></urlset>",
        )
        val deps = testDeps(db, previewCrawler = Crawler(MapFetcher(pages), pageCap = 5))
        application { appModule(deps) }

        val res = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.XForwardedFor, "203.0.113.10")
            setBody("""{"url":"example.com"}""")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        assertNull(res.headers[HttpHeaders.SetCookie])

        val body = res.bodyAsText()
        val json = Json.parseToJsonElement(body).jsonObject
        assertEquals("example.com", json["domain"]!!.jsonPrimitive.content)
        assertEquals(1, json["pagesChecked"]!!.jsonPrimitive.content.toInt())

        val checks = checksById(body)
        for (id in listOf(
            "ai_readability", "https", "sitemap", "page_titles",
            "meta_descriptions", "thin_content", "image_alt_text",
        )) {
            assertEquals("good", checks.getValue(id)["severity"]!!.jsonPrimitive.content, "check $id")
        }
    }

    @Test
    fun `a javascript-only site produces the ai_readability check at high severity`() = testApplication {
        val db = TestMongo.freshDb()
        val html = """<html><head><title>App</title></head><body><div id="root"></div><script src="bundle.js"></script></body></html>"""
        val deps = testDeps(db, previewCrawler = Crawler(MapFetcher(mapOf("https://example.com" to html)), pageCap = 5))
        application { appModule(deps) }

        val res = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.XForwardedFor, "203.0.113.11")
            setBody("""{"url":"example.com"}""")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val checks = checksById(res.bodyAsText())
        assertEquals("high", checks.getValue("ai_readability")["severity"]!!.jsonPrimitive.content)
    }

    @Test
    fun `checks flag every deterministic problem with the expected severity`() = testApplication {
        val db = TestMongo.freshDb()
        val html = """<html><head></head><body><p>short</p><img src="a.jpg"><img src="b.jpg"></body></html>"""
        val deps = testDeps(db, previewCrawler = Crawler(MapFetcher(mapOf("https://example.com" to html)), pageCap = 5))
        application { appModule(deps) }

        val res = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.XForwardedFor, "203.0.113.17")
            setBody("""{"url":"example.com"}""")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        val checks = checksById(res.bodyAsText())
        assertEquals("high", checks.getValue("page_titles")["severity"]!!.jsonPrimitive.content)
        assertEquals("high", checks.getValue("meta_descriptions")["severity"]!!.jsonPrimitive.content)
        assertEquals("medium", checks.getValue("thin_content")["severity"]!!.jsonPrimitive.content)
        assertEquals("medium", checks.getValue("sitemap")["severity"]!!.jsonPrimitive.content)
        assertEquals("low", checks.getValue("image_alt_text")["severity"]!!.jsonPrimitive.content)
        assertEquals("good", checks.getValue("https")["severity"]!!.jsonPrimitive.content)
        assertEquals("good", checks.getValue("ai_readability")["severity"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a preview persists nothing`() = testApplication {
        val db = TestMongo.freshDb()
        val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
        val deps = testDeps(db, previewCrawler = Crawler(MapFetcher(mapOf("https://example.com" to html)), pageCap = 5))
        application { appModule(deps) }

        val res = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.XForwardedFor, "203.0.113.12")
            setBody("""{"url":"example.com"}""")
        }
        assertEquals(HttpStatusCode.OK, res.status)

        assertEquals(0L, db.getCollection<Document>("sites").countDocuments())
        assertEquals(0L, db.getCollection<Document>("assessments").countDocuments())
    }

    @Test
    fun `a blocked address is rejected by the ssrf guard`() = testApplication {
        val db = TestMongo.freshDb()
        val deps = testDeps(db, ssrf = SsrfGuard { listOf(InetAddress.getByName("127.0.0.1")) })
        application { appModule(deps) }

        val res = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.XForwardedFor, "203.0.113.13")
            setBody("""{"url":"internal.example"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertTrue(res.bodyAsText().contains("invalid_url"))
    }

    @Test
    fun `the fourth preview from one address within the hour returns 429 with retry-after`() = testApplication {
        val db = TestMongo.freshDb()
        val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
        val deps = testDeps(db, previewCrawler = Crawler(MapFetcher(mapOf("https://example.com" to html)), pageCap = 5))
        application { appModule(deps) }

        suspend fun attempt() = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.XForwardedFor, "203.0.113.14")
            setBody("""{"url":"example.com"}""")
        }

        repeat(3) { assertEquals(HttpStatusCode.OK, attempt().status) }
        val fourth = attempt()
        assertEquals(HttpStatusCode.TooManyRequests, fourth.status)
        val retryAfter = fourth.headers[HttpHeaders.RetryAfter]
        assertNotNull(retryAfter)
        assertTrue(retryAfter!!.toInt() > 0)
        assertTrue(fourth.bodyAsText().contains("rate_limited"))
    }

    @Test
    fun `a malformed url returns 400 with a helpful message`() = testApplication {
        val db = TestMongo.freshDb()
        val deps = testDeps(db)
        application { appModule(deps) }

        val res = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.XForwardedFor, "203.0.113.15")
            setBody("""{"url":"not a url at all"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertTrue(res.bodyAsText().contains("invalid_url"))
    }

    @Test
    fun `the preview endpoint never calls the model`() = testApplication {
        val db = TestMongo.freshDb()
        val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
        val deps = testDeps(
            db,
            claude = FailingClaudeClient(),
            previewCrawler = Crawler(MapFetcher(mapOf("https://example.com" to html)), pageCap = 5),
        )
        application { appModule(deps) }

        val res = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.XForwardedFor, "203.0.113.16")
            setBody("""{"url":"example.com"}""")
        }
        assertEquals(HttpStatusCode.OK, res.status)
    }
}
