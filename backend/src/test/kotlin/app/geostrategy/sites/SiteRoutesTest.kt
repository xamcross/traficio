package app.geostrategy.sites

import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.registerAndLogin
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
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SiteRoutesTest {
    @Test
    fun `create site normalizes url and lists it`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val res = http.post("/v1/sites") {
            contentType(ContentType.Application.Json)
            setBody("""{"url":"Example.COM/?ref=x"}""")
        }
        assertEquals(HttpStatusCode.Created, res.status)
        assertTrue(res.bodyAsText().contains("\"domain\":\"example.com\""))

        val list = http.get("/v1/sites")
        assertEquals(HttpStatusCode.OK, list.status)
        assertTrue(list.bodyAsText().contains("example.com"))
    }

    @Test
    fun `free tier is capped at one site and duplicates are 409`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        suspend fun add(url: String) = http.post("/v1/sites") {
            contentType(ContentType.Application.Json)
            setBody("""{"url":"$url"}""")
        }
        assertEquals(HttpStatusCode.Created, add("one.example.com").status)
        val dup = add("one.example.com")
        assertEquals(HttpStatusCode.Conflict, dup.status)
        assertTrue(dup.bodyAsText().contains("site_exists"))
        val second = add("two.example.com")
        assertEquals(HttpStatusCode.Forbidden, second.status)
        assertTrue(second.bodyAsText().contains("site_limit_reached"))
    }

    @Test
    fun `sites require login`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }
        assertEquals(HttpStatusCode.Unauthorized, client.get("/v1/sites").status)
    }
}
