package app.geostrategy.claude

import app.geostrategy.crawl.CrawlDigest
import app.geostrategy.crawl.PageDigest
import app.geostrategy.crawl.SiteFacts
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
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
    fun `plan links tasks to findings, skips good findings, and uses platform steps`() = runBlocking {
        val client = CannedClaudeClient()
        val analysis = client.analyze(digest).value
        val plan = client.plan(analysis, "wordpress").value
        val problems = analysis.findings.filter { it.severity != GOOD_SEVERITY }
        assertEquals(problems.size, plan.tasks.size)
        assertTrue(plan.tasks.all { it.findingId != null && problems.any { f -> f.id == it.findingId } })
        assertTrue(plan.tasks.all { it.steps.isNotEmpty() && it.whyItMatters.isNotBlank() && it.doneCheck.isNotBlank() })
        assertTrue(plan.tasks.any { task -> task.steps.first().contains("WordPress") })
    }

    @Test
    fun `analyze returns a summary, one note per area, and at most two good findings`() = runBlocking {
        val a = CannedClaudeClient().analyze(digest).value
        val summary = assertNotNull(a.summary)
        assertTrue(summary.isNotBlank())
        val notes = assertNotNull(a.scoreNotes)
        assertTrue(notes.seo.isNotBlank() && notes.aeo.isNotBlank() && notes.geo.isNotBlank())
        val good = a.findings.filter { it.severity == GOOD_SEVERITY }
        assertEquals(2, good.size)
        assertTrue(good.all { it.evidence.endsWith("Nothing to do here.") })
        // good findings come after every problem
        val firstGood = a.findings.indexOfFirst { it.severity == GOOD_SEVERITY }
        assertTrue(a.findings.drop(firstGood).all { it.severity == GOOD_SEVERITY })
    }

    @Test
    fun `analysis schema requires summary and scoreNotes and allows severity good`() {
        val schema = Json.parseToJsonElement(object {}.javaClass.getResource("/schemas/analysis.json")!!.readText()).jsonObject
        val required = schema["required"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertTrue("summary" in required && "scoreNotes" in required, required.toString())
        val severity = schema["properties"]!!.jsonObject["findings"]!!.jsonObject["items"]!!.jsonObject["properties"]!!.jsonObject["severity"]!!.jsonObject
        val allowed = severity["enum"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertEquals(listOf("high", "medium", "low", "good"), allowed)
        // the canned output only uses values the schema allows
        val canned = runBlocking { CannedClaudeClient().analyze(digest).value }
        assertTrue(canned.findings.all { it.severity in allowed })
        val notesProps = schema["properties"]!!.jsonObject["scoreNotes"]!!.jsonObject["required"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertEquals(listOf("seo", "aeo", "geo"), notesProps)
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
