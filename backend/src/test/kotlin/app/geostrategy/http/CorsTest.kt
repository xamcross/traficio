package app.geostrategy.http

import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.testDeps
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.http.HttpHeaders
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CorsTest {
    @Test
    fun `app origin is allowed with credentials, others are not`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }
        // testDeps uses AppConfig defaults -> appUrl = http://localhost:4200
        val allowed = client.get("/healthz") { header(HttpHeaders.Origin, "http://localhost:4200") }
        assertEquals("http://localhost:4200", allowed.headers[HttpHeaders.AccessControlAllowOrigin])
        assertEquals("true", allowed.headers[HttpHeaders.AccessControlAllowCredentials])

        val denied = client.get("/healthz") { header(HttpHeaders.Origin, "https://evil.example") }
        assertNull(denied.headers[HttpHeaders.AccessControlAllowOrigin])

        val wrongScheme = client.get("/healthz") { header(HttpHeaders.Origin, "https://localhost:4200") }
        assertNull(wrongScheme.headers[HttpHeaders.AccessControlAllowOrigin])
    }

    @Test
    fun `an extra origin is allowed while the site moves between origins`() = testApplication {
        val env = mapOf(
            "APP_URL" to "https://traficio.com",
            "EXTRA_CORS_ORIGINS" to "https://app.traficio.com",
        )
        application { appModule(testDeps(TestMongo.freshDb(), env = env)) }

        val newOrigin = client.get("/healthz") { header(HttpHeaders.Origin, "https://traficio.com") }
        assertEquals("https://traficio.com", newOrigin.headers[HttpHeaders.AccessControlAllowOrigin])

        val oldOrigin = client.get("/healthz") { header(HttpHeaders.Origin, "https://app.traficio.com") }
        assertEquals("https://app.traficio.com", oldOrigin.headers[HttpHeaders.AccessControlAllowOrigin])

        val other = client.get("/healthz") { header(HttpHeaders.Origin, "https://evil.example") }
        assertNull(other.headers[HttpHeaders.AccessControlAllowOrigin])
    }

    @Test
    fun `an empty extra list leaves only the app origin allowed`() = testApplication {
        val env = mapOf("APP_URL" to "https://traficio.com", "EXTRA_CORS_ORIGINS" to "")
        application { appModule(testDeps(TestMongo.freshDb(), env = env)) }

        val appOrigin = client.get("/healthz") { header(HttpHeaders.Origin, "https://traficio.com") }
        assertEquals("https://traficio.com", appOrigin.headers[HttpHeaders.AccessControlAllowOrigin])

        val oldOrigin = client.get("/healthz") { header(HttpHeaders.Origin, "https://app.traficio.com") }
        assertNull(oldOrigin.headers[HttpHeaders.AccessControlAllowOrigin])
    }
}
