package app.geostrategy.email

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ResendEmailSenderTest {
    private fun clientWith(engine: MockEngine) = HttpClient(engine) {
        install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
    }

    @Test
    fun `posts the expected payload with bearer auth`() = runBlocking {
        var authHeader: String? = null
        var url: String? = null
        var body: String? = null
        val engine = MockEngine { request ->
            authHeader = request.headers[HttpHeaders.Authorization]
            url = request.url.toString()
            body = String(request.body.toByteArray())
            respond("""{"id":"email_1"}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }
        ResendEmailSender("re_test_key", "GeoStrategy <noreply@geostrategy.app>", clientWith(engine))
            .send("ada@example.com", "Hello", "<p>Hi</p>")

        assertEquals("Bearer re_test_key", authHeader)
        assertEquals("https://api.resend.com/emails", url)
        val parsed = Json.parseToJsonElement(body!!).jsonObject
        assertEquals("ada@example.com", parsed["to"]!!.jsonArray[0].jsonPrimitive.content)
        assertEquals("Hello", parsed["subject"]!!.jsonPrimitive.content)
        assertEquals("GeoStrategy <noreply@geostrategy.app>", parsed["from"]!!.jsonPrimitive.content)
        assertEquals("<p>Hi</p>", parsed["html"]!!.jsonPrimitive.content)
    }

    @Test
    fun `non-2xx response throws`() {
        val engine = MockEngine { respond("nope", HttpStatusCode.Unauthorized) }
        assertFailsWith<IllegalStateException> {
            runBlocking {
                ResendEmailSender("bad", "x <x@x.dev>", clientWith(engine)).send("a@b.c", "s", "h")
            }
        }
    }
}
