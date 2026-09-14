package app.geostrategy.http

import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.testDeps
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class BodyLimitTest {
    @Test
    fun `a register body over the default limit is rejected with 413`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }

        val oversized = """{"email":"a@example.com","password":"${"x".repeat(DEFAULT_BODY_LIMIT_BYTES.toInt())}"}"""
        val res = client.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody(oversized)
        }
        assertEquals(HttpStatusCode.PayloadTooLarge, res.status)
        assertTrue(res.bodyAsText().contains("invalid_request"))
    }
}
