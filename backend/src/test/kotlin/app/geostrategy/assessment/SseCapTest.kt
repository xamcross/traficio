package app.geostrategy.assessment

import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.registerVerifyLogin
import app.geostrategy.testDeps
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SseCapTest {
    @Test
    fun `sse closes after the configured cap even without a terminal status`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails, env = mapOf("SSE_MAX_MILLIS" to "300"))
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        val id = Json.parseToJsonElement(http.post("/v1/sites/$siteId/assessments").bodyAsText())
            .jsonObject["id"]!!.jsonPrimitive.content

        val res = http.get("/v1/assessments/$id/events")  // assessment stays "queued"; must return after ~300ms
        assertEquals(HttpStatusCode.OK, res.status)
        assertTrue(res.bodyAsText().contains("queued"))
    }
}
