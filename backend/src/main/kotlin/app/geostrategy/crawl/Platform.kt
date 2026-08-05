package app.geostrategy.crawl

fun detectPlatform(html: String): String {
    val h = html.lowercase()
    return when {
        "wp-content" in h || "wp-includes" in h || "content=\"wordpress" in h -> "wordpress"
        "parastorage.com" in h || "wix.com website builder" in h || "wixstatic.com" in h -> "wix"
        "squarespace" in h -> "squarespace"
        "cdn.shopify.com" in h || "shopify.theme" in h -> "shopify"
        "data-wf-domain" in h || "assets.website-files.com" in h -> "webflow"
        else -> "custom"
    }
}
