package app.geostrategy.crawl

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PageSignalsTest {
    private val richHtml = """
        <html><head>
          <title>Ada's Bakery</title>
          <meta name="description" content="Fresh bread daily in Warsaw.">
          <link rel="canonical" href="https://example.com/">
          <meta property="og:title" content="Ada's Bakery">
          <meta name="robots" content="noindex, follow">
          <script type="application/ld+json">{"@type":"LocalBusiness","name":"Ada's"}</script>
        </head><body>
          <h1>Welcome</h1><h2>Our bread</h2><h2>Visit us</h2>
          <img src="a.jpg" alt="sourdough loaf"><img src="b.jpg">
          <a href="/menu">Menu</a><a href="https://instagram.com/ada">IG</a>
          <p>${"fresh bread ".repeat(40)}</p>
        </body></html>
    """

    @Test
    fun `extracts the full signal set`() {
        val d = extractPageSignals("https://example.com", richHtml)
        assertEquals("https://example.com", d.url)
        assertEquals("Ada's Bakery", d.title)
        assertEquals("Fresh bread daily in Warsaw.", d.metaDescription)
        assertEquals(1, d.h1Count)
        assertEquals(2, d.h2Count)
        assertEquals("https://example.com/", d.canonical)
        assertTrue(d.hasOgTags)
        assertEquals(listOf("LocalBusiness"), d.jsonLdTypes)
        assertEquals("noindex, follow", d.robotsMeta)
        assertEquals(2, d.imgCount)
        assertEquals(1, d.imgWithAltCount)
        assertTrue(d.wordCount > 50)
        assertEquals(1, d.internalLinkCount)
        assertEquals(1, d.externalLinkCount)
        assertFalse(d.looksJsOnly)
    }

    @Test
    fun `sparse js-shell page is flagged and empty fields are null`() {
        val d = extractPageSignals("https://example.com", """<html><head></head><body><div id="root"></div><script src="app.js"></script></body></html>""")
        assertNull(d.title)
        assertNull(d.metaDescription)
        assertNull(d.robotsMeta)
        assertTrue(d.looksJsOnly)
    }

    @Test
    fun `platform fingerprints`() {
        assertEquals("wordpress", detectPlatform("""<link href="/wp-content/themes/x/style.css">"""))
        assertEquals("wordpress", detectPlatform("""<meta name="generator" content="WordPress 6.5">"""))
        assertEquals("wix", detectPlatform("""<script src="https://static.parastorage.com/x.js"></script><meta name="generator" content="Wix.com Website Builder">"""))
        assertEquals("squarespace", detectPlatform("""<!-- This is Squarespace. -->"""))
        assertEquals("shopify", detectPlatform("""<link href="https://cdn.shopify.com/x.css">"""))
        assertEquals("webflow", detectPlatform("""<html data-wf-domain="x" class="w-mod-js">"""))
        assertEquals("custom", detectPlatform("<html><body>plain</body></html>"))
    }

    @Test
    fun `malformed URL with spaces does not throw`() {
        val d = extractPageSignals("https://exa mple.com/bad url", richHtml)
        assertEquals("Ada's Bakery", d.title)
    }
}
