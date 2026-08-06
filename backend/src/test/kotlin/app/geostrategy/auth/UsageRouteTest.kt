package app.geostrategy.auth

import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.assessment.Assessment
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
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.bson.types.ObjectId
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class UsageRouteTest {
    @Test
    fun `fresh free user with no sites reports zero usage against free-tier limits`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")

        val res = http.get("/v1/me/usage")
        assertEquals(HttpStatusCode.OK, res.status)
        assertEquals(
            """{"assessmentsUsed":0,"assessmentsLimit":${deps.config.tierLimits.freeAssessmentsPerMonth},"sitesUsed":0,"sitesLimit":${deps.config.tierLimits.freeMaxSites}}""",
            res.bodyAsText(),
        )
    }

    @Test
    fun `usage reflects one site and one non-failed assessment`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")

        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content

        val user = runBlocking { deps.users.findByEmail("ada@example.com")!! }
        val now = Instant.now()
        runBlocking {
            deps.assessments.insert(
                Assessment(siteId = ObjectId(siteId), userId = user.id, status = "ready", createdAt = now, updatedAt = now),
            )
        }

        val res = http.get("/v1/me/usage")
        assertEquals(HttpStatusCode.OK, res.status)
        assertEquals(
            """{"assessmentsUsed":1,"assessmentsLimit":${deps.config.tierLimits.freeAssessmentsPerMonth},"sitesUsed":1,"sitesLimit":${deps.config.tierLimits.freeMaxSites}}""",
            res.bodyAsText(),
        )
    }

    @Test
    fun `usage requires login`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }
        val res = client.get("/v1/me/usage")
        assertEquals(HttpStatusCode.Unauthorized, res.status)
        assertTrue(res.bodyAsText().contains("unauthenticated"))
    }
}
