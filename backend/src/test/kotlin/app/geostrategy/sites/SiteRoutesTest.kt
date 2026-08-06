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
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import kotlinx.coroutines.runBlocking
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Deterministically simulates a concurrent racer: on the FIRST call to [insert] (the route's
 * own insert, issued right after its pre-insert cap check has already passed), a second site
 * for the same user is inserted directly, bypassing the route entirely. This reproduces the
 * exact window the route's post-insert recheck is meant to close, without relying on real
 * request concurrency (which can't deterministically force both requests past the pre-check
 * before either insert lands).
 */
private class RacingSiteRepository(db: MongoDatabase) : SiteRepository(db) {
    private val raw = db.getCollection<Site>("sites")
    private var racerInserted = false

    override suspend fun insert(site: Site): Site {
        if (!racerInserted) {
            racerInserted = true
            val now = Instant.now()
            raw.insertOne(Site(userId = site.userId, domain = "raced.example.com", url = "https://raced.example.com", createdAt = now, updatedAt = now))
        }
        return super.insert(site)
    }
}

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

    @Test
    fun `cap recheck removes a raced insert`() = testApplication {
        val db = TestMongo.freshDb()
        val deps = testDeps(db, sites = RacingSiteRepository(db))
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        // The route's pre-insert cap check passes (the account has zero sites at that point).
        // The instant it calls insert(), the racer sneaks in and commits its own site first,
        // so the post-insert recheck finds the account over its cap of 1 and rolls this
        // request's own insert back.
        val res = http.post("/v1/sites") {
            contentType(ContentType.Application.Json)
            setBody("""{"url":"one.example.com"}""")
        }
        assertEquals(HttpStatusCode.Forbidden, res.status)
        assertTrue(res.bodyAsText().contains("site_limit_reached"))

        val user = runBlocking { deps.users.findByEmail("ada@example.com")!! }
        // only the racer's site survives
        assertEquals(1L, runBlocking { deps.sites.countFor(user.id) })
    }
}
