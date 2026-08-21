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
import kotlinx.coroutines.sync.Semaphore
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
    fun `a single javascript-only page produces the ai_readability check at medium severity`() = testApplication {
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
        // One js-only page out of a small sample is a weak signal (a hero-image landing
        // page can trip it), so it stays at medium rather than high.
        assertEquals("medium", checks.getValue("ai_readability")["severity"]!!.jsonPrimitive.content)
    }

    @Test
    fun `two or more javascript-only pages raise ai_readability to high severity`() = testApplication {
        val db = TestMongo.freshDb()
        val shell = """<html><head><title>App</title></head><body><div id="root"></div><script src="bundle.js"></script></body></html>"""
        val home = """
            <html><head><title>App</title></head>
            <body><div id="root"></div><script src="bundle.js"></script><a href="/pricing">Pricing</a></body>
            </html>
        """.trimIndent()
        val pages = mapOf(
            "https://example.com" to home,
            "https://example.com/pricing" to shell,
        )
        val deps = testDeps(db, previewCrawler = Crawler(MapFetcher(pages), pageCap = 5))
        application { appModule(deps) }

        val res = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.XForwardedFor, "203.0.113.41")
            setBody("""{"url":"example.com"}""")
        }
        assertEquals(HttpStatusCode.OK, res.status)
        assertEquals(2, Json.parseToJsonElement(res.bodyAsText()).jsonObject["pagesChecked"]!!.jsonPrimitive.content.toInt())
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
        // A missing meta description does not stop a search engine or an AI from reading the
        // page, so it stays at medium rather than high.
        assertEquals("medium", checks.getValue("meta_descriptions")["severity"]!!.jsonPrimitive.content)
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

    @Test
    fun `CF-Connecting-IP outranks Fly-Client-IP for the rate limit key`() = testApplication {
        val db = TestMongo.freshDb()
        val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
        val deps = testDeps(db, previewCrawler = Crawler(MapFetcher(mapOf("https://example.com" to html)), pageCap = 5))
        application { appModule(deps) }

        suspend fun attempt(cfIp: String, flyIp: String) = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header("CF-Connecting-IP", cfIp)
            header("Fly-Client-IP", flyIp)
            setBody("""{"url":"example.com"}""")
        }

        // Three visitors share one Cloudflare edge, so they share one Fly-Client-IP. If the
        // route trusted Fly-Client-IP first, the second visitor's first request would
        // already look like a repeat, and the third visitor would be blocked outright.
        repeat(3) { assertEquals(HttpStatusCode.OK, attempt("203.0.113.20", "198.51.100.9").status) }
        assertEquals(HttpStatusCode.TooManyRequests, attempt("203.0.113.20", "198.51.100.9").status)

        // A different visitor's own CF-Connecting-IP, behind that very same edge, still has
        // a full quota.
        assertEquals(HttpStatusCode.OK, attempt("203.0.113.21", "198.51.100.9").status)
    }

    @Test
    fun `two IPv6 addresses in the same slash-64 share one rate limit bucket`() = testApplication {
        val db = TestMongo.freshDb()
        val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
        val deps = testDeps(db, previewCrawler = Crawler(MapFetcher(mapOf("https://example.com" to html)), pageCap = 5))
        application { appModule(deps) }

        suspend fun attempt(ip: String) = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header("CF-Connecting-IP", ip)
            setBody("""{"url":"example.com"}""")
        }

        // A caller who bypasses Cloudflare can pick any address in their own /64, so two
        // different addresses in 2001:db8:abcd:1234::/64 must count as the same caller.
        assertEquals(HttpStatusCode.OK, attempt("2001:db8:abcd:1234::1").status)
        assertEquals(HttpStatusCode.OK, attempt("2001:db8:abcd:1234::2").status)
        assertEquals(HttpStatusCode.OK, attempt("2001:db8:abcd:1234::3").status)
        assertEquals(HttpStatusCode.TooManyRequests, attempt("2001:db8:abcd:1234::4").status)

        // A different /64 is a different bucket, with its own full quota.
        assertEquals(HttpStatusCode.OK, attempt("2001:db8:abcd:9999::1").status)
    }

    @Test
    fun `a url over 2048 characters is rejected with 400`() = testApplication {
        val db = TestMongo.freshDb()
        val deps = testDeps(db)
        application { appModule(deps) }

        val longUrl = "https://example.com/" + "a".repeat(2100)
        val res = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.XForwardedFor, "203.0.113.30")
            setBody("""{"url":"$longUrl"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertTrue(res.bodyAsText().contains("invalid_url"))
    }

    @Test
    fun `a request body over the size cap is rejected with 400`() = testApplication {
        val db = TestMongo.freshDb()
        val deps = testDeps(db)
        application { appModule(deps) }

        // Well past the few-kilobyte cap, and well past 2048 characters too, so this proves
        // the body cap itself rejects the request rather than the url-length check.
        val hugeUrl = "a".repeat(10_000)
        val res = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.XForwardedFor, "203.0.113.31")
            setBody("""{"url":"$hugeUrl"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertTrue(res.bodyAsText().contains("invalid_request"))
    }

    @Test
    fun `a full preview semaphore answers 503 with retry-after, and recovers once a permit frees up`() = testApplication {
        val db = TestMongo.freshDb()
        val semaphore = Semaphore(3)
        repeat(3) { assertTrue(semaphore.tryAcquire()) }
        val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
        val deps = testDeps(
            db,
            previewCrawler = Crawler(MapFetcher(mapOf("https://example.com" to html)), pageCap = 5),
            previewSemaphore = semaphore,
        )
        application { appModule(deps) }

        val busy = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.XForwardedFor, "203.0.113.32")
            setBody("""{"url":"example.com"}""")
        }
        assertEquals(HttpStatusCode.ServiceUnavailable, busy.status)
        val retryAfter = busy.headers[HttpHeaders.RetryAfter]
        assertNotNull(retryAfter)
        assertTrue(retryAfter!!.toInt() > 0)
        assertTrue(busy.bodyAsText().contains("preview_busy"))

        semaphore.release()
        val recovered = client.post("/v1/preview") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.XForwardedFor, "203.0.113.33")
            setBody("""{"url":"example.com"}""")
        }
        assertEquals(HttpStatusCode.OK, recovered.status)
    }
}
