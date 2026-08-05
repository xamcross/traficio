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
    }
}
