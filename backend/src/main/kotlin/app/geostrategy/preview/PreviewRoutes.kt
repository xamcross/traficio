package app.geostrategy.preview

import app.geostrategy.AppDeps
import app.geostrategy.assessment.hostOf
import app.geostrategy.assessment.normalizeUrl
import app.geostrategy.crawl.CrawlDigest
import app.geostrategy.http.ApiError
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.header
import io.ktor.server.request.receive
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import kotlinx.serialization.Serializable

@Serializable
data class PreviewRequest(val url: String)

@Serializable
data class PreviewCheckDto(val id: String, val severity: String, val description: String)

/**
 * The anonymous preview result. It carries no score, because a real score comes from the
 * model and this endpoint never calls the model. `moreFindingsInFullCheck` stays null: the
 * full check reads the model's own judgement, so we cannot state that count in advance, and
 * we leave the field out rather than invent a number.
 */
@Serializable
data class PreviewResponseDto(
    val domain: String,
    val pagesChecked: Int,
    val checks: List<PreviewCheckDto>,
    val moreFindingsInFullCheck: Int? = null,
)

/**
 * Reads the caller's address from the proxy header that Cloudflare and Fly both set in
 * front of this app, and falls back to the raw socket address when the header is absent.
 */
fun ApplicationCall.previewClientAddress(): String {
    val forwarded = request.header(HttpHeaders.XForwardedFor)?.substringBefore(',')?.trim()
    return forwarded?.takeIf { it.isNotEmpty() } ?: request.local.remoteAddress
}

/**
 * Builds the deterministic checks from the crawl alone. Every value here comes from
 * [CrawlDigest]; no check calls the model.
 */
fun buildPreviewChecks(digest: CrawlDigest): List<PreviewCheckDto> {
    val pages = digest.pages
    val pageCount = pages.size
    val checks = mutableListOf<PreviewCheckDto>()

    checks += if (digest.looksJsOnly) {
        PreviewCheckDto(
            "ai_readability",
            "high",
            "Your pages need JavaScript to show their content. AI assistants read the raw page, so they see nothing there.",
        )
    } else {
        PreviewCheckDto("ai_readability", "good", "AI assistants can read your page content directly.")
    }

    checks += if (digest.facts.https) {
        PreviewCheckDto("https", "good", "Your site uses a secure HTTPS connection.")
    } else {
        PreviewCheckDto(
            "https",
            "high",
            "Your site has no secure HTTPS connection. Visitors and search engines may flag it as unsafe.",
        )
    }

    checks += if (digest.facts.sitemapPresent) {
        PreviewCheckDto("sitemap", "good", "Your site has a sitemap.xml file. It helps crawlers find your pages.")
    } else {
        PreviewCheckDto(
            "sitemap",
            "medium",
            "Your site has no sitemap.xml file. A sitemap helps search engines and AI tools find your pages.",
        )
    }

    val missingTitle = pages.count { it.title.isNullOrBlank() }
    checks += if (missingTitle == 0) {
        PreviewCheckDto("page_titles", "good", "Every checked page has a title tag.")
    } else {
        PreviewCheckDto(
            "page_titles",
            "high",
            "$missingTitle of $pageCount checked pages have no title tag. A title tells search engines and AI tools what the page is about.",
        )
    }

    val missingDescription = pages.count { it.metaDescription.isNullOrBlank() }
    checks += if (missingDescription == 0) {
        PreviewCheckDto("meta_descriptions", "good", "Every checked page has a meta description.")
    } else {
        PreviewCheckDto(
            "meta_descriptions",
            "high",
            "$missingDescription of $pageCount checked pages have no meta description. This text often shows under your link in search results.",
        )
    }

    val thinPages = pages.count { it.wordCount < 300 }
    checks += if (thinPages == 0) {
        PreviewCheckDto("thin_content", "good", "Every checked page has enough text for AI tools to read.")
    } else {
        PreviewCheckDto(
            "thin_content",
            "medium",
            "$thinPages of $pageCount checked pages have fewer than 300 words. A short page gives AI tools little to read.",
        )
    }

    val totalImages = pages.sumOf { it.imgCount }
    val totalWithAlt = pages.sumOf { it.imgWithAltCount }
    checks += when {
        totalImages == 0 -> PreviewCheckDto("image_alt_text", "good", "Your checked pages have no images to describe.")
        totalWithAlt * 2 >= totalImages ->
            PreviewCheckDto("image_alt_text", "good", "Most of your images have alt text for AI tools and screen readers.")
        else -> PreviewCheckDto(
            "image_alt_text",
            "low",
            "$totalWithAlt of $totalImages images have alt text. Alt text helps AI tools and screen readers describe an image.",
        )
    }

    return checks
}

/**
 * The anonymous, zero-model-cost preview. It validates the URL, runs the SSRF guard, then
 * crawls a small page budget and reports deterministic checks. It never calls the model,
 * and it stores nothing: no site, no assessment, no user.
 */
fun Route.previewRoutes(deps: AppDeps) {
    post("/v1/preview") {
        val address = call.previewClientAddress()
        val retryAfterSeconds = deps.previewLimiter.recordAttempt(address)
        if (retryAfterSeconds != null) {
            call.response.header(HttpHeaders.RetryAfter, retryAfterSeconds)
            call.respond(
                HttpStatusCode.TooManyRequests,
                ApiError("rate_limited", "You've used your 3 free previews for this hour. Please try again later."),
            )
            return@post
        }

        val normalized = normalizeUrl(call.receive<PreviewRequest>().url)
        val domain = hostOf(normalized)
        deps.ssrf.check(domain)

        val digest = deps.previewCrawler.crawl(normalized)
        call.respond(
            PreviewResponseDto(
                domain = domain,
                pagesChecked = digest.pages.size,
                checks = buildPreviewChecks(digest),
            ),
        )
    }
}
