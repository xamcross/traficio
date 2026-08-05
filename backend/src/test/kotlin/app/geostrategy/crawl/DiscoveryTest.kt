package app.geostrategy.crawl

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DiscoveryTest {
    @Test
    fun `robots parse respects star group and allows when absent`() {
        val robots = Robots.parse(
            """
            User-agent: OtherBot
            Disallow: /everything
            User-agent: *
            Disallow: /admin
            Disallow: /private/
            """.trimIndent(),
        )
        assertFalse(robots.allows("/admin"))
        assertFalse(robots.allows("/private/page"))
        assertTrue(robots.allows("/blog"))
        assertTrue(Robots.parse(null).allows("/anything"))
    }

    @Test
    fun `discovery merges nav links and sitemap, same host only, capped, homepage first`() {
        val html = """
            <html><body>
              <nav><a href="/about">About</a><a href="https://example.com/pricing?x=1">Pricing</a></nav>
              <a href="https://elsewhere.example/other">External</a>
              <a href="mailto:hi@example.com">Mail</a>
            </body></html>
        """
        val sitemap = """
            <urlset><url><loc>https://example.com/blog/post-1</loc></url>
            <url><loc>https://example.com/about</loc></url></urlset>
        """
        val urls = discoverUrls("https://example.com", html, sitemap, cap = 4)
        assertEquals("https://example.com", urls.first())
        assertTrue("https://example.com/about" in urls)
        assertTrue("https://example.com/pricing" in urls)
        assertTrue("https://example.com/blog/post-1" in urls)
        assertEquals(4, urls.size)
        assertFalse(urls.any { "elsewhere" in it })
    }

    @Test
    fun `discovery survives missing sitemap and relative junk`() {
        val urls = discoverUrls("https://example.com", "<a href='#'>x</a><a href='/only'>y</a>", null)
        assertEquals(listOf("https://example.com", "https://example.com/only"), urls)
    }
}
