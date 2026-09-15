package app.geostrategy.billing

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
import java.io.IOException
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HttpFreemiusClientTest {
    private fun clientFor(engine: MockEngine) =
        HttpFreemiusClient(HttpClient(engine), productId = "39459", apiToken = "tok_abc")

    private fun MockRequestHandleScope.jsonResponse(body: String, status: HttpStatusCode = HttpStatusCode.OK) =
        respond(content = body, status = status, headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))

    @Test
    fun `an active license with a future expiration reports active with that expiration`() = runBlocking {
        val engine = MockEngine { request ->
            assertEquals("Bearer tok_abc", request.headers[HttpHeaders.Authorization])
            assertTrue(request.url.toString() == "https://api.freemius.com/v1/products/39459/licenses/lic-1.json")
            jsonResponse("""{"id":"lic-1","is_cancelled":false,"expiration":"2099-01-01 00:00:00"}""")
        }
        val state = clientFor(engine).checkLicense("lic-1")
        assertEquals(true, state?.active)
        assertEquals(Instant.parse("2099-01-01T00:00:00Z"), state?.expiresAt)
    }

    @Test
    fun `a cancelled license reports not active`() = runBlocking {
        val engine = MockEngine { jsonResponse("""{"id":"lic-1","is_cancelled":true,"expiration":"2099-01-01 00:00:00"}""") }
        val state = clientFor(engine).checkLicense("lic-1")
        assertEquals(false, state?.active)
    }

    @Test
    fun `a lifetime license with no expiration and not cancelled reports active with a null expiration`() = runBlocking {
        val engine = MockEngine { jsonResponse("""{"id":"lic-1","is_cancelled":false,"expiration":null}""") }
        val state = clientFor(engine).checkLicense("lic-1")
        assertEquals(true, state?.active)
        assertNull(state?.expiresAt)
    }

    @Test
    fun `a 500 answer is unknown`() = runBlocking {
        val engine = MockEngine { jsonResponse("boom", HttpStatusCode.InternalServerError) }
        assertNull(clientFor(engine).checkLicense("lic-1"))
    }

    @Test
    fun `a network failure is unknown`() = runBlocking {
        val engine = MockEngine { throw IOException("connection reset") }
        assertNull(clientFor(engine).checkLicense("lic-1"))
    }
}
