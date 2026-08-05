package app.geostrategy.crawl

import org.jsoup.Jsoup
import java.net.URI

fun discoverUrls(baseUrl: String, homepageHtml: String, sitemapXml: String?, cap: Int = 15): List<String> {
    val base = URI(baseUrl)
    val result = linkedSetOf(baseUrl)

    val doc = Jsoup.parse(homepageHtml, baseUrl)
    for (a in doc.select("a[href]")) {
        normalizeCandidate(a.absUrl("href"), base)?.let { result.add(it) }
        if (result.size >= cap) return result.toList()
    }

    if (sitemapXml != null) {
        for (match in Regex("<loc>\\s*(.*?)\\s*</loc>").findAll(sitemapXml)) {
            normalizeCandidate(match.groupValues[1], base)?.let { result.add(it) }
            if (result.size >= cap) break
        }
    }
    return result.take(cap).toList()
}

private fun normalizeCandidate(raw: String, base: URI): String? {
    if (raw.isBlank()) return null
    val uri = try { URI(raw) } catch (e: Exception) { return null }
    val scheme = uri.scheme?.lowercase() ?: return null
    if (scheme != "http" && scheme != "https") return null
    val host = uri.host?.lowercase() ?: return null
    if (host != base.host.lowercase()) return null
    val path = uri.rawPath?.takeIf { it.isNotEmpty() && it != "/" }?.trimEnd('/') ?: ""
    return "$scheme://$host$path"
}
