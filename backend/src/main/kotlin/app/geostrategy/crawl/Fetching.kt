package app.geostrategy.crawl

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.HttpHeaders
import io.ktor.utils.io.readRemaining
import kotlinx.io.readString

data class FetchResult(val url: String, val status: Int, val contentType: String?, val body: String)

interface Fetcher {
    suspend fun fetch(url: String): FetchResult?
}

class HttpFetcher(private val http: HttpClient, private val maxBytes: Int = 2_000_000) : Fetcher {
    override suspend fun fetch(url: String): FetchResult? = try {
        val res = http.get(url) {
            header(HttpHeaders.UserAgent, "GeoStrategyBot/1.0 (+https://geostrategy.app)")
        }
        val body = res.bodyAsChannel().readRemaining(maxBytes.toLong()).readString()
        FetchResult(url, res.status.value, res.headers[HttpHeaders.ContentType], body)
    } catch (e: Exception) {
        null
    }
}
