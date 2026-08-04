package app.geostrategy.http

import app.geostrategy.appModule
import app.geostrategy.config.AppConfig
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ErrorsTest {
    private fun Application.withThrowingRoutes(config: AppConfig) {
        appModule(config)
        routing {
            get("/boom-known") { throw AppException(HttpStatusCode.Conflict, "email_taken", "That email is already registered.") }
            get("/boom-unknown") { error("db exploded: secret detail") }
        }
    }

    @Test
    fun `AppException maps to its status and envelope`() = testApplication {
        application { withThrowingRoutes(AppConfig.fromEnv(emptyMap())) }
        val res = client.get("/boom-known")
        assertEquals(HttpStatusCode.Conflict, res.status)
        assertEquals("""{"code":"email_taken","message":"That email is already registered."}""", res.bodyAsText())
    }

    @Test
    fun `unexpected exceptions map to 500 without leaking details`() = testApplication {
        application { withThrowingRoutes(AppConfig.fromEnv(emptyMap())) }
        val res = client.get("/boom-unknown")
        assertEquals(HttpStatusCode.InternalServerError, res.status)
        assertTrue(res.bodyAsText().contains("internal_error"))
        assertTrue(!res.bodyAsText().contains("secret detail"))
    }
}
