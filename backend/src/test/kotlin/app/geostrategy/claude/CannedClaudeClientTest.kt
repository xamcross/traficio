package app.geostrategy.claude

import app.geostrategy.crawl.CrawlDigest
import app.geostrategy.crawl.PageDigest
import app.geostrategy.crawl.SiteFacts
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CannedClaudeClientTest {
    private fun page(url: String, meta: String?) = PageDigest(
        url = url, title = "T", metaDescription = meta, h1Count = 1, h2Count = 0,
        canonical = null, hasOgTags = false, jsonLdTypes = emptyList(), robotsMeta = null,
        imgCount = 0, imgWithAltCount = 0, wordCount = 200, internalLinkCount = 1,
        externalLinkCount = 0, looksJsOnly = false,
    )

    private val digest = CrawlDigest(
        startUrl = "https://example.com",
        platform = "wordpress",
        facts = SiteFacts(https = true, robotsTxtPresent = true, sitemapPresent = false, llmsTxtPresent = false),
        pages = listOf(page("https://example.com", null), page("https://example.com/menu", "Menu.")),
        looksJsOnly = false,
    )

    @Test
    fun `analyze derives stable findings and clamped scores`() = runBlocking {
        val client = CannedClaudeClient()
        val a = client.analyze(digest).value
        val ids = a.findings.map { it.id }
        assertTrue("missing-meta-description:/" in ids)
        assertTrue("missing-sitemap" in ids)
        assertTrue("missing-llms-txt" in ids)
        assertTrue("missing-structured-data" in ids)
        assertTrue(a.scores.seo in 5..100 && a.scores.aeo in 5..100 && a.scores.geo in 5..100)
        // deterministic
        assertEquals(a, client.analyze(digest).value)
    }

    @Test
    fun `plan links tasks to findings and uses platform steps`() = runBlocking {
        val client = CannedClaudeClient()
        val analysis = client.analyze(digest).value
        val plan = client.plan(analysis, "wordpress").value
        assertEquals(analysis.findings.size, plan.tasks.size)
        assertTrue(plan.tasks.all { it.findingId != null && analysis.findings.any { f -> f.id == it.findingId } })
        assertTrue(plan.tasks.all { it.steps.isNotEmpty() && it.whyItMatters.isNotBlank() && it.doneCheck.isNotBlank() })
        assertTrue(plan.tasks.any { task -> task.steps.first().contains("WordPress") })
    }

    @Test
    fun `usage cost math and schema resources are valid`() {
        val usage = ClaudeUsage(1_000_000, 100_000) + ClaudeUsage(0, 0)
        assertEquals(5.0 + 2.5, usage.costUsd())
        for (path in listOf("/schemas/analysis.json", "/schemas/plan.json")) {
            val schema = Json.parseToJsonElement(object {}.javaClass.getResource(path)!!.readText()).jsonObject
            assertEquals("object", schema["type"]!!.toString().trim('"'))
        }
    }
}
