package app.geostrategy.crawl

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.jsoup.Jsoup
import java.net.URI

data class PageDigest(
    val url: String,
    val title: String?,
    val metaDescription: String?,
    val h1Count: Int,
    val h2Count: Int,
    val canonical: String?,
    val hasOgTags: Boolean,
    val jsonLdTypes: List<String>,
    val robotsMeta: String?,
    val imgCount: Int,
    val imgWithAltCount: Int,
    /** An image with `alt=""` on purpose: a decorative image, correctly marked, not missing alt text. */
    val imgDecorativeCount: Int = 0,
    val wordCount: Int,
    val internalLinkCount: Int,
    val externalLinkCount: Int,
    val looksJsOnly: Boolean,
)

fun extractPageSignals(url: String, html: String): PageDigest {
    val doc = Jsoup.parse(html, url)
    val host = try { URI(url).host?.lowercase() } catch (e: Exception) { null }
    val text = doc.body()?.text() ?: ""
    val wordCount = text.split(Regex("\\s+")).count { it.isNotBlank() }
    val links = doc.select("a[href]").mapNotNull {
        try { URI(it.absUrl("href")).host?.lowercase() } catch (e: Exception) { null }
    }
    val jsonLdTypes = doc.select("script[type=application/ld+json]").mapNotNull { el ->
        try {
            Json.parseToJsonElement(el.data()).jsonObject["@type"]?.jsonPrimitive?.content
        } catch (e: Exception) { null }
    }
    return PageDigest(
        url = url,
        title = doc.selectFirst("head > title")?.text()?.takeIf { it.isNotBlank() },
        metaDescription = doc.selectFirst("meta[name=description]")?.attr("content")?.takeIf { it.isNotBlank() },
        h1Count = doc.select("h1").size,
        h2Count = doc.select("h2").size,
        canonical = doc.selectFirst("link[rel=canonical]")?.attr("href")?.takeIf { it.isNotBlank() },
        hasOgTags = doc.select("meta[property^=og:]").isNotEmpty(),
        jsonLdTypes = jsonLdTypes,
        robotsMeta = doc.selectFirst("meta[name=robots]")?.attr("content")?.takeIf { it.isNotBlank() },
        imgCount = doc.select("img").size,
        imgWithAltCount = doc.select("img[alt]").count { it.attr("alt").isNotBlank() },
        imgDecorativeCount = doc.select("img[alt]").count { it.attr("alt").isBlank() },
        wordCount = wordCount,
        internalLinkCount = links.count { it == host },
        externalLinkCount = links.count { it != null && it != host },
        looksJsOnly = wordCount < 30 && doc.select("script").isNotEmpty(),
    )
}
