package app.geostrategy.crawl

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
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
}
