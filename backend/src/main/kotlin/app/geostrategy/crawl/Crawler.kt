package app.geostrategy.crawl

import app.geostrategy.http.AppException
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.withTimeoutOrNull
import java.net.URI

data class SiteFacts(
    val https: Boolean,
    val robotsTxtPresent: Boolean,
    val sitemapPresent: Boolean,
    val llmsTxtPresent: Boolean,
)

data class CrawlDigest(
    val startUrl: String,
    val platform: String,
    val facts: SiteFacts,
    val pages: List<PageDigest>,
    val looksJsOnly: Boolean,
)

class Crawler(
    private val fetcher: Fetcher,
    private val budgetMillis: Long = 90_000,
    private val pageCap: Int = 15,
) {
    suspend fun crawl(startUrl: String): CrawlDigest {
        val uri = URI(startUrl)
        val origin = "${uri.scheme}://${uri.host}" + if (uri.port != -1) ":${uri.port}" else ""

        val home = fetcher.fetch(startUrl)
            ?: throw AppException(HttpStatusCode.BadGateway, "site_unreachable", "We couldn't reach your site. Make sure it is online, then try again.")
        if (home.status >= 400) {
            throw AppException(HttpStatusCode.BadGateway, "site_unreachable", "Your site answered with an error (HTTP ${home.status}). Try again later.")
        }

        val robotsTxt = fetcher.fetch("$origin/robots.txt")?.takeIf { it.status == 200 }?.body
        val sitemapXml = fetcher.fetch("$origin/sitemap.xml")?.takeIf { it.status == 200 }?.body
        val llmsPresent = fetcher.fetch("$origin/llms.txt")?.status == 200
        val robots = Robots.parse(robotsTxt)

        val urls = discoverUrls(startUrl, home.body, sitemapXml, pageCap)
            .filter { robots.allows(URI(it).rawPath?.takeIf(String::isNotEmpty) ?: "/") }

        val pages = mutableListOf<PageDigest>()
        withTimeoutOrNull(budgetMillis) {
            for (url in urls) {
                val res = if (url == startUrl) home else fetcher.fetch(url) ?: continue
                if (res.status != 200) continue
                pages.add(extractPageSignals(url, res.body))
            }
        }
        if (pages.isEmpty()) pages.add(extractPageSignals(startUrl, home.body))

        return CrawlDigest(
            startUrl = startUrl,
            platform = detectPlatform(home.body),
            facts = SiteFacts(
                https = startUrl.startsWith("https://"),
                robotsTxtPresent = robotsTxt != null,
                sitemapPresent = sitemapXml != null,
                llmsTxtPresent = llmsPresent,
            ),
            pages = pages,
            looksJsOnly = pages.count { it.looksJsOnly } * 2 > pages.size,
        )
    }
}
