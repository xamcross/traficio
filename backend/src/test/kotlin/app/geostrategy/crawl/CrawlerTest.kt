package app.geostrategy.crawl

import app.geostrategy.MapFetcher
import app.geostrategy.http.AppException
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CrawlerTest {
    private class SlowFetcher(private val inner: MapFetcher, private val slowUrls: Set<String>, private val delayMs: Long) : Fetcher {
        override suspend fun fetch(url: String): FetchResult? {
            if (url in slowUrls) delay(delayMs)
            return inner.fetch(url)
        }
    }
    private val home = """
        <html><head><title>Ada's Bakery</title><meta name="description" content="Bread."></head>
        <body><a href="/menu">Menu</a><a href="/admin">Admin</a><p>${"bread ".repeat(50)}</p></body></html>
    """
    private val menu = """<html><head><title>Menu</title></head><body><p>${"rye ".repeat(50)}</p></body></html>"""

    @Test
    fun `crawls homepage plus discovered pages and collects site facts`() = runBlocking {
        val fetcher = MapFetcher(mapOf(
            "https://example.com" to home,
            "https://example.com/menu" to menu,
            "https://example.com/admin" to "<html><body>secret</body></html>",
            "https://example.com/robots.txt" to "User-agent: *\nDisallow: /admin",
            "https://example.com/sitemap.xml" to "<urlset><url><loc>https://example.com/menu</loc></url></urlset>",
        ))
        val digest = Crawler(fetcher).crawl("https://example.com")
        assertEquals(listOf("https://example.com", "https://example.com/menu"), digest.pages.map { it.url })
        assertTrue(digest.facts.https)
        assertTrue(digest.facts.robotsTxtPresent)
        assertTrue(digest.facts.sitemapPresent)
        assertFalse(digest.facts.llmsTxtPresent)
        assertFalse(digest.looksJsOnly)
        assertEquals("custom", digest.platform)
    }

    @Test
    fun `unreachable homepage throws site_unreachable`() = runBlocking {
        val e = assertFailsWith<AppException> { Crawler(MapFetcher(emptyMap())).crawl("https://gone.example") }
        assertEquals("site_unreachable", e.code)
    }

    @Test
    fun `majority js-shell pages set looksJsOnly`() = runBlocking {
        val shell = """<html><body><div id="root"></div><script src="a.js"></script></body></html>"""
        val digest = Crawler(MapFetcher(mapOf("https://spa.example" to shell))).crawl("https://spa.example")
        assertTrue(digest.looksJsOnly)
    }

    @Test
    fun `budget returns partial pages when a discovered page hangs`() = runBlocking {
        val inner = MapFetcher(mapOf(
            "https://example.com" to home,
            "https://example.com/menu" to menu,
        ))
        val fetcher = SlowFetcher(inner, slowUrls = setOf("https://example.com/menu"), delayMs = 60_000)
        val digest = Crawler(fetcher, budgetMillis = 400).crawl("https://example.com")
        assertEquals(listOf("https://example.com"), digest.pages.map { it.url })
    }

    @Test
    fun `timeout before the homepage answers is site_unreachable`() = runBlocking {
        val fetcher = SlowFetcher(MapFetcher(mapOf("https://example.com" to home)), setOf("https://example.com"), 60_000)
        val e = assertFailsWith<AppException> { Crawler(fetcher, budgetMillis = 200).crawl("https://example.com") }
        assertEquals("site_unreachable", e.code)
    }

    @Test
    fun `robots disallowing the homepage fails honestly`() = runBlocking {
        val fetcher = MapFetcher(mapOf(
            "https://example.com" to home,
            "https://example.com/robots.txt" to "User-agent: *\nDisallow: /",
        ))
        val e = assertFailsWith<AppException> { Crawler(fetcher).crawl("https://example.com") }
        assertEquals("robots_blocked", e.code)
    }
}
