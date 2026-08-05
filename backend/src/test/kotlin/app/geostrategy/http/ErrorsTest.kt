package app.geostrategy.http

import app.geostrategy.AppDeps
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.testDeps
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.application.Application
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ErrorsTest {
    private fun Application.withThrowingRoutes(deps: AppDeps) {
        appModule(deps)
        routing {
            get("/boom-known") { throw AppException(HttpStatusCode.Conflict, "email_taken", "That email is already registered.") }
            get("/boom-unknown") { error("db exploded: secret detail") }
        }
    }

    @Test
    fun `AppException maps to its status and envelope`() = testApplication {
        application { withThrowingRoutes(testDeps(TestMongo.freshDb())) }
        val res = client.get("/boom-known")
        assertEquals(HttpStatusCode.Conflict, res.status)
        assertEquals("""{"code":"email_taken","message":"That email is already registered."}""", res.bodyAsText())
    }

    @Test
    fun `unexpected exceptions map to 500 without leaking details`() = testApplication {
        application { withThrowingRoutes(testDeps(TestMongo.freshDb())) }
        val res = client.get("/boom-unknown")
        assertEquals(HttpStatusCode.InternalServerError, res.status)
        assertTrue(res.bodyAsText().contains("internal_error"))
        assertTrue(!res.bodyAsText().contains("secret detail"))
    }

    @Test
    fun `malformed json body maps to 400 invalid_request`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }
        val res = client.post("/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"not":"valid"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertTrue(res.bodyAsText().contains("invalid_request"))
    }
}
