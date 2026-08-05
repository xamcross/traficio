package app.geostrategy.claude

import app.geostrategy.crawl.CrawlDigest
import java.net.URI

/**
 * Deterministic stand-in for the real Claude client. The app uses it when
 * ANTHROPIC_API_KEY is not set. Tests always use it.
 */
class CannedClaudeClient : ClaudeClient {
    private val zero = ClaudeUsage(0, 0)
    private val severityOrder = mapOf("high" to 0, "medium" to 1, "low" to 2)

    override suspend fun analyze(digest: CrawlDigest): ClaudeResponse<AnalysisResult> {
        val findings = mutableListOf<Finding>()
        fun path(url: String) = URI(url).rawPath?.takeIf { it.isNotEmpty() } ?: "/"

        for (p in digest.pages) {
            if (p.metaDescription == null) findings.add(Finding("missing-meta-description:${path(p.url)}", "seo", "high", "The page ${path(p.url)} has no meta description. Search engines show this text under your link.", listOf(p.url)))
            if (p.title == null) findings.add(Finding("missing-title:${path(p.url)}", "seo", "high", "The page ${path(p.url)} has no title tag.", listOf(p.url)))
            if (p.h1Count == 0) findings.add(Finding("missing-h1:${path(p.url)}", "seo", "medium", "The page ${path(p.url)} has no main heading (H1).", listOf(p.url)))
        }
        if (!digest.facts.sitemapPresent) findings.add(Finding("missing-sitemap", "seo", "medium", "Your site has no sitemap.xml. A sitemap helps search engines find your pages.", listOf(digest.startUrl)))
        if (!digest.facts.llmsTxtPresent) findings.add(Finding("missing-llms-txt", "geo", "low", "Your site has no llms.txt. This file tells AI assistants what your site is about.", listOf(digest.startUrl)))
        if (digest.pages.none { it.jsonLdTypes.isNotEmpty() }) findings.add(Finding("missing-structured-data", "aeo", "high", "No page has structured data (schema.org). Answer engines use it to understand your business.", listOf(digest.startUrl)))
        val totalImgs = digest.pages.sumOf { it.imgCount }
        if (totalImgs > 0 && digest.pages.sumOf { it.imgWithAltCount } * 2 < totalImgs) {
            findings.add(Finding("missing-alt-text", "seo", "low", "More than half of your images have no alt text.", digest.pages.filter { it.imgCount > it.imgWithAltCount }.map { it.url }))
        }

        fun clamp(v: Int) = v.coerceIn(5, 100)
        val scores = Scores(
            seo = clamp(95 - 12 * findings.count { it.category == "seo" }),
            aeo = clamp(90 - 15 * findings.count { it.category == "aeo" }),
            geo = clamp(90 - 20 * findings.count { it.category == "geo" }),
        )
        return ClaudeResponse(AnalysisResult(scores, findings), zero)
    }

    override suspend fun plan(analysis: AnalysisResult, platform: String): ClaudeResponse<PlanResult> {
        val firstStep = when (platform) {
            "wordpress" -> "Log in to your WordPress admin (usually yoursite.com/wp-admin)."
            "wix" -> "Log in to Wix and open your site's dashboard."
            "squarespace" -> "Log in to Squarespace and open your site."
            "shopify" -> "Log in to your Shopify admin."
            "webflow" -> "Log in to Webflow and open your project."
            else -> "Open the folder or tool you use to edit your website."
        }
        val tasks = analysis.findings.sortedBy { severityOrder[it.severity] ?: 3 }.take(20).map { f ->
            PlanTaskGen(
                title = "Fix: ${f.id.substringBefore(':').replace('-', ' ')}",
                category = f.category,
                impact = f.severity,
                effortMinutes = if (f.severity == "high") 30 else 15,
                whyItMatters = f.evidence,
                steps = listOf(firstStep, "Make this change: ${f.evidence}", "Save and publish your site."),
                doneCheck = "Run a new assessment. This item should disappear from the list.",
                findingId = f.id,
            )
        }
        return ClaudeResponse(PlanResult(tasks), zero)
    }
}
