package app.geostrategy.crawl

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class FetchingTest {
    @Test
    fun `fetch propagates cancellation instead of returning null`() = runBlocking {
        val engine = MockEngine { delay(60_000); respond("late") }
        val fetcher = HttpFetcher(HttpClient(engine))
        var completedWithNull = false
        val job = launch { completedWithNull = fetcher.fetch("https://slow.example") == null }
        delay(100)
        job.cancelAndJoin()
        assertFalse(completedWithNull)
    }

    @Test
    fun `fetch identifies the crawler to the site it reads as TraficioBot`() = runBlocking {
        var seen: String? = null
        val engine = MockEngine { request ->
            seen = request.headers[HttpHeaders.UserAgent]
            respond("<html></html>")
        }
        HttpFetcher(HttpClient(engine)).fetch("https://example.com")
        assertEquals("TraficioBot/1.0 (+https://traficio.com)", seen)
    }
}
