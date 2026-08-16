package app.geostrategy.claude

import app.geostrategy.crawl.CrawlDigest
import kotlinx.serialization.Serializable

@Serializable
data class Scores(val seo: Int, val aeo: Int, val geo: Int) {
    /**
     * Derived visibility score. Round half up of the mean of the three areas.
     * It is a body property, so the Mongo codec does not store it and `equals` ignores it.
     * kotlinx.serialization writes it to JSON and treats it as optional on decode.
     */
    val overall: Int = Math.round((seo + aeo + geo) / 3.0).toInt()
}

@Serializable
data class Finding(val id: String, val category: String, val severity: String, val evidence: String, val affectedPages: List<String>)

@Serializable
data class AnalysisResult(val scores: Scores, val findings: List<Finding>)

@Serializable
data class PlanTaskGen(
    val title: String,
    val category: String,
    val impact: String,
    val effortMinutes: Int,
    val whyItMatters: String,
    val steps: List<String>,
    val doneCheck: String,
    val findingId: String? = null,
)

@Serializable
data class PlanResult(val tasks: List<PlanTaskGen>)

data class ClaudeUsage(val inputTokens: Long, val outputTokens: Long) {
    operator fun plus(other: ClaudeUsage) = ClaudeUsage(inputTokens + other.inputTokens, outputTokens + other.outputTokens)
    fun costUsd(): Double = inputTokens * 5.0 / 1_000_000 + outputTokens * 25.0 / 1_000_000
}

data class ClaudeResponse<T>(val value: T, val usage: ClaudeUsage)

interface ClaudeClient {
    suspend fun analyze(digest: CrawlDigest): ClaudeResponse<AnalysisResult>
    suspend fun plan(analysis: AnalysisResult, platform: String): ClaudeResponse<PlanResult>
}

fun digestToPromptText(d: CrawlDigest): String = buildString {
    appendLine("Site: ${d.startUrl}")
    appendLine("Platform: ${d.platform}")
    appendLine("HTTPS: ${d.facts.https}; robots.txt: ${d.facts.robotsTxtPresent}; sitemap.xml: ${d.facts.sitemapPresent}; llms.txt: ${d.facts.llmsTxtPresent}")
    appendLine("Pages (${d.pages.size}):")
    for (p in d.pages) {
        appendLine("- ${p.url}")
        appendLine("  title=${p.title ?: "MISSING"}; metaDescription=${p.metaDescription ?: "MISSING"}; h1=${p.h1Count}; h2=${p.h2Count}; canonical=${p.canonical ?: "none"}; og=${p.hasOgTags}; jsonLd=${p.jsonLdTypes}; robotsMeta=${p.robotsMeta ?: "none"}; words=${p.wordCount}; imgs=${p.imgCount} (alt ${p.imgWithAltCount}); links int=${p.internalLinkCount} ext=${p.externalLinkCount}")
    }
}
