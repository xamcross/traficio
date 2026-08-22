package app.geostrategy.preview

import app.geostrategy.AppDeps
import app.geostrategy.assessment.hostOf
import app.geostrategy.assessment.normalizeUrl
import app.geostrategy.crawl.CrawlDigest
import app.geostrategy.http.ApiError
import app.geostrategy.http.AppException
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.contentLength
import io.ktor.server.request.header
import io.ktor.server.request.receiveChannel
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import io.ktor.utils.io.readRemaining
import kotlinx.io.readString
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory
import java.net.URI

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

/** This route accepts no body over a few kilobytes: a url never needs more than that. */
private const val MAX_PREVIEW_BODY_BYTES = 4096L
private val previewRequestJson = Json { ignoreUnknownKeys = true }
private val BODY_TOO_LARGE = { AppException(HttpStatusCode.BadRequest, "invalid_request", "That request is too large. Please check the data and try again.") }
private val UNREADABLE_BODY = { AppException(HttpStatusCode.BadRequest, "invalid_request", "We couldn't read that request. Please check the data and try again.") }

/** How long we ask a caller to wait when the preview semaphore is full. */
private const val PREVIEW_BUSY_RETRY_SECONDS = "5"

private val previewLog = LoggerFactory.getLogger("app.geostrategy.preview.PreviewRoutes")

/**
 * True when this request may reach the preview route.
 *
 * Fly's own proxy sets `Fly-Client-IP` to the address of the peer it sees. It overwrites
 * whatever the caller sent. Through Cloudflare, that peer is a Cloudflare edge server. So
 * the header holds a Cloudflare address. A caller who instead reaches the Fly hostname
 * directly is Fly's own peer. So the header holds the caller's own address, and
 * [CloudflareIpRanges.contains] returns false for it.
 *
 * A request with no `Fly-Client-IP` header is not behind Fly's proxy. That is local
 * development and the test suite. This function allows that case: there is no Cloudflare
 * boundary to check there.
 */
private fun ApplicationCall.arrivedThroughCloudflare(): Boolean {
    val flyClientIp = request.header("Fly-Client-IP") ?: return true
    return CloudflareIpRanges.contains(flyClientIp.trim())
}

/**
 * Reads the preview request body with a small size cap. This route sits behind no login, so
 * an unbounded body is a memory exhaustion primitive on a small machine. A visitor's url
 * never needs more than a few kilobytes of JSON, so we read at most that many bytes and
 * answer 400 for anything larger, before content negotiation would otherwise buffer it all.
 */
suspend fun ApplicationCall.receivePreviewRequest(): PreviewRequest {
    val declaredLength = request.contentLength()
    if (declaredLength != null && declaredLength > MAX_PREVIEW_BODY_BYTES) throw BODY_TOO_LARGE()

    val text = receiveChannel().readRemaining(MAX_PREVIEW_BODY_BYTES + 1).readString()
    if (text.toByteArray(Charsets.UTF_8).size > MAX_PREVIEW_BODY_BYTES) throw BODY_TOO_LARGE()

    return try {
        previewRequestJson.decodeFromString(PreviewRequest.serializer(), text)
    } catch (e: Exception) {
        throw UNREADABLE_BODY()
    }
}

/**
 * Reads the caller's address for the preview rate limit.
 *
 * Cloudflare sits in front of this app in production (`api.traficio.com` is a
 * Cloudflare-proxied CNAME onto the Fly app), and Cloudflare itself sets CF-Connecting-IP to
 * the visitor's real address; a caller cannot forge that header past Cloudflare, so it comes
 * first. Fly-Client-IP is Fly's own edge address. Behind Cloudflare that is Cloudflare's edge
 * server, shared by every visitor at that edge, so it must not outrank CF-Connecting-IP; it
 * is still the right choice for a caller who goes straight to the Fly hostname, bypassing
 * Cloudflare, so it stays as the second choice. The right-most X-Forwarded-For entry is the
 * next fallback: a caller controls the left-most entries, but each proxy appends its own
 * entry on the right, so the right-most one is the value this app's own proxy wrote. The raw
 * socket address is the final fallback, for a direct connection with no proxy headers at all.
 */
fun ApplicationCall.previewClientAddress(): String {
    val cfConnectingIp = request.header("CF-Connecting-IP")?.trim()
    if (!cfConnectingIp.isNullOrEmpty()) return cfConnectingIp

    val flyClientIp = request.header("Fly-Client-IP")?.trim()
    if (!flyClientIp.isNullOrEmpty()) return flyClientIp

    val forwarded = request.header(HttpHeaders.XForwardedFor)
        ?.split(',')
        ?.lastOrNull()
        ?.trim()
    return forwarded?.takeIf { it.isNotEmpty() } ?: request.local.remoteAddress
}

/** A path that is very unlikely to carry the site's real content: a contact, legal or about page. */
private val BOILERPLATE_PATH_HINTS = listOf("contact", "privacy", "terms", "legal", "about")

private fun isBoilerplatePage(url: String): Boolean {
    val path = try { URI(url).path?.lowercase() ?: "" } catch (e: Exception) { "" }
    return BOILERPLATE_PATH_HINTS.any { path.contains(it) }
}

/**
 * Builds the deterministic checks from the crawl alone. Every value here comes from
 * [CrawlDigest]; no check calls the model.
 */
fun buildPreviewChecks(digest: CrawlDigest): List<PreviewCheckDto> {
    val pages = digest.pages
    val pageCount = pages.size
    val checks = mutableListOf<PreviewCheckDto>()

    // A js-only page on one page out of a small sample is a weak signal: a one-page photo
    // site or a hero-image landing page can trip it without being a real problem. We only
    // raise the check to `high` once two or more pages show the signal.
    val jsOnlyPageCount = pages.count { it.looksJsOnly }
    val jsOnlyDescription = "We found almost no text on your pages before JavaScript runs. AI assistants read the raw page, so they may see very little."
    checks += when {
        jsOnlyPageCount == 0 -> PreviewCheckDto("ai_readability", "good", "AI assistants can read your page content directly.")
        jsOnlyPageCount >= 2 -> PreviewCheckDto("ai_readability", "high", jsOnlyDescription)
        else -> PreviewCheckDto("ai_readability", "medium", jsOnlyDescription)
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

    // A missing meta description does not stop a search engine or an AI from reading a page,
    // so this stays at medium rather than high.
    val missingDescription = pages.count { it.metaDescription.isNullOrBlank() }
    checks += if (missingDescription == 0) {
        PreviewCheckDto("meta_descriptions", "good", "Every checked page has a meta description.")
    } else {
        PreviewCheckDto(
            "meta_descriptions",
            "medium",
            "$missingDescription of $pageCount checked pages have no meta description. This text often shows under your link in search results.",
        )
    }

    // Contact, privacy and terms pages are boilerplate: they are short on purpose, and with a
    // five-page cap a couple of them can otherwise swing this check on their own.
    val contentPages = pages.filterNot { isBoilerplatePage(it.url) }
    val thinPages = contentPages.count { it.wordCount < 300 }
    checks += if (thinPages == 0) {
        PreviewCheckDto("thin_content", "good", "Every checked page has enough text for AI tools to read.")
    } else {
        PreviewCheckDto(
            "thin_content",
            "medium",
            "$thinPages of ${contentPages.size} checked pages (not counting contact, privacy or terms pages) have fewer than 300 words. A short page gives AI tools little to read.",
        )
    }

    // An image with alt="" on purpose is a decorative image, correctly marked, not a missing
    // one, so it is dropped from both sides of the count rather than counted as missing.
    val totalImages = pages.sumOf { it.imgCount }
    val decorativeImages = pages.sumOf { it.imgDecorativeCount }
    val totalWithAlt = pages.sumOf { it.imgWithAltCount }
    val countedImages = totalImages - decorativeImages
    checks += when {
        countedImages <= 0 -> PreviewCheckDto("image_alt_text", "good", "Your checked pages have no images that need alt text.")
        totalWithAlt * 100 >= countedImages * 80 ->
            PreviewCheckDto("image_alt_text", "good", "Most of your images have alt text for AI tools and screen readers.")
        else -> PreviewCheckDto(
            "image_alt_text",
            "low",
            "$totalWithAlt of $countedImages images have alt text. Alt text helps AI tools and screen readers describe an image.",
        )
    }

    return checks
}

/**
 * The anonymous, zero-model-cost preview.
 *
 * The route checks [arrivedThroughCloudflare] first, ahead of every other step. The Fly
 * hostname is public. A caller who reaches it directly can forge every other header,
 * including the one the rate limit reads. So that check must reject the request before the
 * limiter counts an attempt.
 *
 * The route then parses and validates the url, with no network call. It then records the
 * rate-limit attempt, then runs the SSRF check and the crawl. That order keeps a typo from
 * costing a visitor one of their three free previews. It still records the attempt before
 * any network call, so the rate limit stays closed against a burst. The route never calls
 * the model, and it stores nothing: no site, no assessment, no user.
 */
fun Route.previewRoutes(deps: AppDeps) {
    post("/v1/preview") {
        if (!call.arrivedThroughCloudflare()) {
            previewLog.info("Rejected a preview request: Fly-Client-IP {} is outside Cloudflare's ranges", call.request.header("Fly-Client-IP"))
            call.respond(HttpStatusCode.Forbidden, ApiError("forbidden", "This endpoint is not available on this host."))
            return@post
        }

        val body = call.receivePreviewRequest()
        val normalized = normalizeUrl(body.url)
        val domain = hostOf(normalized)

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

        deps.ssrf.check(domain)

        // The same machine also runs JobWorker for paying customers, so the free preview
        // crawl must not be able to run unbounded alongside it.
        if (!deps.previewSemaphore.tryAcquire()) {
            call.response.header(HttpHeaders.RetryAfter, PREVIEW_BUSY_RETRY_SECONDS)
            call.respond(
                HttpStatusCode.ServiceUnavailable,
                ApiError("preview_busy", "We're checking a lot of sites right now. Please try again in a few seconds."),
            )
            return@post
        }
        try {
            val digest = deps.previewCrawler.crawl(normalized)
            call.respond(
                PreviewResponseDto(
                    domain = domain,
                    pagesChecked = digest.pages.size,
                    checks = buildPreviewChecks(digest),
                ),
            )
        } finally {
            deps.previewSemaphore.release()
        }
    }
}
