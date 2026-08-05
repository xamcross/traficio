package app.geostrategy.billing

import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.registerVerifyLogin
import app.geostrategy.testDeps
import app.geostrategy.users.User
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Updates.set
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
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DowngradeTest {
    private suspend fun makePro(db: com.mongodb.kotlin.client.coroutine.MongoDatabase, email: String) {
        db.getCollection<User>("users").updateOne(eq("email", email), set("tier", "pro"))
    }
    private suspend fun makeFree(db: com.mongodb.kotlin.client.coroutine.MongoDatabase, email: String) {
        db.getCollection<User>("users").updateOne(eq("email", email), set("tier", "free"))
    }

    @Test
    fun `after downgrade extra sites are read-only and not assessable`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        runBlocking { makePro(db, "ada@example.com") }

        suspend fun addSite(url: String): String = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"$url"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        val first = addSite("one.example.com")
        val second = addSite("two.example.com")

        runBlocking { makeFree(db, "ada@example.com") }

        val sites = Json.parseToJsonElement(http.get("/v1/sites").bodyAsText()).jsonObject["sites"]!!.jsonArray
        val byId = sites.associate { it.jsonObject["id"]!!.jsonPrimitive.content to it.jsonObject["readOnly"]!!.jsonPrimitive.content.toBoolean() }
        assertEquals(false, byId[first])
        assertEquals(true, byId[second])

        val blocked = http.post("/v1/sites/$second/assessments")
        assertEquals(HttpStatusCode.Forbidden, blocked.status)
        assertTrue(blocked.bodyAsText().contains("site_read_only"))

        // the oldest site stays assessable (fresh site, no prior assessments -> no pro gate)
        assertEquals(HttpStatusCode.Accepted, http.post("/v1/sites/$first/assessments").status)
    }
}
