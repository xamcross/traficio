package app.geostrategy.preview

import app.geostrategy.crawl.CrawlDigest
import app.geostrategy.crawl.PageDigest
import app.geostrategy.crawl.SiteFacts
import kotlin.test.Test
import kotlin.test.assertEquals

/** Builds a page with sensible defaults, so each test only names the fields it cares about. */
private fun page(
    url: String,
    wordCount: Int = 400,
    imgCount: Int = 0,
    imgWithAltCount: Int = 0,
    imgDecorativeCount: Int = 0,
    metaDescription: String? = "A description.",
    title: String? = "A title",
    looksJsOnly: Boolean = false,
) = PageDigest(
    url = url, title = title, metaDescription = metaDescription, h1Count = 1, h2Count = 0,
    canonical = null, hasOgTags = false, jsonLdTypes = emptyList(), robotsMeta = null,
    imgCount = imgCount, imgWithAltCount = imgWithAltCount, imgDecorativeCount = imgDecorativeCount,
    wordCount = wordCount, internalLinkCount = 0, externalLinkCount = 0, looksJsOnly = looksJsOnly,
)

private fun digest(pages: List<PageDigest>) = CrawlDigest(
    startUrl = pages.first().url,
    platform = "custom",
    facts = SiteFacts(https = true, robotsTxtPresent = true, sitemapPresent = true, llmsTxtPresent = false),
    pages = pages,
    looksJsOnly = pages.count { it.looksJsOnly } * 2 > pages.size,
)

private fun severity(checks: List<PreviewCheckDto>, id: String) = checks.first { it.id == id }.severity

class PreviewChecksTest {
    @Test
    fun `thin_content excludes boilerplate pages from the count`() {
        val pages = listOf(
            page("https://example.com", wordCount = 400),
            page("https://example.com/contact", wordCount = 20),
            page("https://example.com/privacy-policy", wordCount = 15),
            page("https://example.com/terms", wordCount = 10),
        )
        val checks = buildPreviewChecks(digest(pages))
        // Every non-boilerplate page (just the homepage) has enough text, so the three
        // short boilerplate pages must not drag this check down.
        assertEquals("good", severity(checks, "thin_content"))
    }

    @Test
    fun `thin_content still flags a genuinely short content page`() {
        val pages = listOf(
            page("https://example.com", wordCount = 400),
            page("https://example.com/blog/short-post", wordCount = 20),
        )
        val checks = buildPreviewChecks(digest(pages))
        assertEquals("medium", severity(checks, "thin_content"))
    }

    @Test
    fun `meta_descriptions is medium, not high, when a page has none`() {
        val pages = listOf(page("https://example.com", metaDescription = null))
        val checks = buildPreviewChecks(digest(pages))
        assertEquals("medium", severity(checks, "meta_descriptions"))
    }

    @Test
    fun `image_alt_text excludes a correctly empty alt from both sides of the count`() {
        val pages = listOf(
            page(
                "https://example.com",
                imgCount = 3,
                imgWithAltCount = 1, // one real, described image
                imgDecorativeCount = 1, // one alt="" image, correctly marked decorative
                // the third image has no alt attribute at all: genuinely missing
            ),
        )
        val checks = buildPreviewChecks(digest(pages))
        val check = checks.first { it.id == "image_alt_text" }
        // 1 of 2 counted images (3 total minus the 1 decorative one), not "1 of 3".
        assertEquals("1 of 2 images have alt text. Alt text helps AI tools and screen readers describe an image.", check.description)
    }

    @Test
    fun `image_alt_text needs at least 80 percent to read good, not 50`() {
        val pages = listOf(page("https://example.com", imgCount = 4, imgWithAltCount = 2))
        val checks = buildPreviewChecks(digest(pages))
        // Exactly half have alt text. The old 50% threshold called this "good"; it must not.
        assertEquals("low", severity(checks, "image_alt_text"))
    }

    @Test
    fun `image_alt_text reads good at exactly 80 percent`() {
        val pages = listOf(page("https://example.com", imgCount = 5, imgWithAltCount = 4))
        val checks = buildPreviewChecks(digest(pages))
        assertEquals("good", severity(checks, "image_alt_text"))
    }

    @Test
    fun `image_alt_text reads good with only decorative images`() {
        val pages = listOf(page("https://example.com", imgCount = 2, imgWithAltCount = 0, imgDecorativeCount = 2))
        val checks = buildPreviewChecks(digest(pages))
        assertEquals("good", severity(checks, "image_alt_text"))
    }
}
