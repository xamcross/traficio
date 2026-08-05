package app.geostrategy.crawl

import app.geostrategy.assessment.SsrfGuard
import app.geostrategy.http.AppException
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.HttpHeaders
import io.ktor.utils.io.readRemaining
import kotlinx.coroutines.CancellationException
import kotlinx.io.readString
import java.net.URI

data class FetchResult(val url: String, val status: Int, val contentType: String?, val body: String)

interface Fetcher {
    suspend fun fetch(url: String): FetchResult?
}

private val REDIRECT_STATUSES = setOf(301, 302, 303, 307, 308)

class HttpFetcher(
    private val http: HttpClient,
    private val maxBytes: Int = 2_000_000,
    private val guard: SsrfGuard? = null,
    private val maxRedirects: Int = 5,
) : Fetcher {
    override suspend fun fetch(url: String): FetchResult? {
        return try {
            var currentUrl = url
            var result: FetchResult? = null
            for (hop in 0..maxRedirects) {
                val blocked = try {
                    guard?.check(URI(currentUrl).host)
                    false
                } catch (e: AppException) {
                    true
                }
                if (blocked) return null

                val res = http.get(currentUrl) {
                    header(HttpHeaders.UserAgent, "GeoStrategyBot/1.0 (+https://geostrategy.app)")
                }
                val location = res.headers[HttpHeaders.Location]
                if (res.status.value in REDIRECT_STATUSES && location != null) {
                    currentUrl = URI(currentUrl).resolve(location).toString()
                    continue
                }
                val body = res.bodyAsChannel().readRemaining(maxBytes.toLong()).readString()
                result = FetchResult(currentUrl, res.status.value, res.headers[HttpHeaders.ContentType], body)
                break
            }
            result
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
    }
}
