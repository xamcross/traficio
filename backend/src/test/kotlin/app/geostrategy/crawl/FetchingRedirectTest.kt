package app.geostrategy.crawl

import app.geostrategy.assessment.SsrfGuard
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
import java.net.InetAddress
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class FetchingRedirectTest {
    private val allowAll = SsrfGuard { listOf(InetAddress.getByName("93.184.216.34")) }

    @Test
    fun `redirect to a public host is followed`() = runBlocking {
        val engine = MockEngine { request ->
            if (request.url.encodedPath == "/final") {
                respond("final", HttpStatusCode.OK)
            } else {
                respond("", HttpStatusCode.Found, headersOf(HttpHeaders.Location, "/final"))
            }
        }
        val fetcher = HttpFetcher(HttpClient(engine) { followRedirects = false }, guard = allowAll)

        val result = fetcher.fetch("https://good.example/")

        assertEquals("final", result?.body)
    }

    @Test
    fun `redirect to a guarded host is blocked`() = runBlocking {
        val engine = MockEngine { request ->
            if (request.url.host == "internal.example") {
                respond("secret", HttpStatusCode.OK)
            } else {
                respond("", HttpStatusCode.Found, headersOf(HttpHeaders.Location, "https://internal.example/secret"))
            }
        }
        val guard = SsrfGuard { host ->
            if (host == "internal.example") listOf(InetAddress.getByName("127.0.0.1"))
            else listOf(InetAddress.getByName("93.184.216.34"))
        }
        val fetcher = HttpFetcher(HttpClient(engine) { followRedirects = false }, guard = guard)

        val result = fetcher.fetch("https://good.example/")

        assertNull(result)
    }

    @Test
    fun `a redirect loop returns null once the hop cap is exceeded`() = runBlocking {
        var requestCount = 0
        val engine = MockEngine {
            requestCount++
            respond("", HttpStatusCode.Found, headersOf(HttpHeaders.Location, "https://loop.example/"))
        }
        val fetcher = HttpFetcher(HttpClient(engine) { followRedirects = false }, guard = allowAll, maxRedirects = 3)

        val result = fetcher.fetch("https://loop.example/")

        assertNull(result)
        assertEquals(4, requestCount)  // the initial request plus 3 redirect hops, all still redirecting
    }
}
