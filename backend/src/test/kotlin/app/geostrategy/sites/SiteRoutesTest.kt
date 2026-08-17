package app.geostrategy.sites

import app.geostrategy.MapFetcher
import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.assessment.Assessment
import app.geostrategy.assessment.AssessmentPipeline
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.crawl.Crawler
import app.geostrategy.makePro
import app.geostrategy.registerAndLogin
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
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.bson.types.ObjectId
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

    @Test
    fun `allowedSiteIds breaks same-timestamp ties by id, independent of input order`() {
        val userId = ObjectId()
        val t = Instant.parse("2026-01-01T00:00:00Z")
        fun site(id: ObjectId) = Site(id = id, userId = userId, domain = "$id.example.com", url = "https://$id.example.com", createdAt = t, updatedAt = t)
        val a = site(ObjectId("000000000000000000000001"))
        val b = site(ObjectId("000000000000000000000002"))
        val c = site(ObjectId("000000000000000000000003"))

        val forward = allowedSiteIds(listOf(a, b, c), max = 2)
        val reversed = allowedSiteIds(listOf(c, b, a), max = 2)

        assertEquals(setOf(a.id, b.id), forward)
        assertEquals(forward, reversed)
    }

    @Test
    fun `site list carries the latest assessment and the latest ready assessment id`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val created = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject
        assertEquals(JsonNull, created["latestAssessment"])
        assertEquals(JsonNull, created["latestReadyAssessmentId"])
        val siteId = created["id"]!!.jsonPrimitive.content

        suspend fun firstSite() = Json.parseToJsonElement(http.get("/v1/sites").bodyAsText()).jsonObject["sites"]!!.jsonArray.first().jsonObject
        assertEquals(JsonNull, firstSite()["latestAssessment"])

        val firstId = Json.parseToJsonElement(http.post("/v1/sites/$siteId/assessments").bodyAsText()).jsonObject["id"]!!.jsonPrimitive.content
        val queued = firstSite()
        assertEquals(firstId, queued["latestAssessment"]!!.jsonObject["id"]!!.jsonPrimitive.content)
        assertEquals("queued", queued["latestAssessment"]!!.jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, queued["latestReadyAssessmentId"])

        val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to html))), CannedClaudeClient(),
        )
        runBlocking { pipeline.handle(deps.jobs.claim()!!) }
        val ready = firstSite()
        assertEquals("ready", ready["latestAssessment"]!!.jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals(firstId, ready["latestReadyAssessmentId"]!!.jsonPrimitive.content)
        assertTrue(ready["latestAssessment"]!!.jsonObject["completedAt"]!!.jsonPrimitive.content.isNotBlank())
        assertTrue(ready["latestScores"]!!.jsonObject.containsKey("overall"))

        // a second (pro) submission becomes the latest; the ready id stays on the first
        runBlocking { makePro(db, "ada@example.com") }
        val secondId = Json.parseToJsonElement(http.post("/v1/sites/$siteId/assessments").bodyAsText()).jsonObject["id"]!!.jsonPrimitive.content
        val again = firstSite()
        assertEquals(secondId, again["latestAssessment"]!!.jsonObject["id"]!!.jsonPrimitive.content)
        assertEquals(firstId, again["latestReadyAssessmentId"]!!.jsonPrimitive.content)
    }

    @Test
    fun `site list reflects a failed latest check, with and without an earlier ready check`() = testApplication {
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
        suspend fun firstSite() = Json.parseToJsonElement(http.get("/v1/sites").bodyAsText()).jsonObject["sites"]!!.jsonArray.first().jsonObject
        val t0 = Instant.now().minusSeconds(3600).truncatedTo(java.time.temporal.ChronoUnit.MILLIS)

        // failed, nothing ready before it
        val failed1 = runBlocking {
            deps.assessments.insert(Assessment(siteId = ObjectId(siteId), userId = user.id, status = "failed", errorCode = "robots_blocked", errorMessage = "Robots says no.", createdAt = t0, updatedAt = t0, completedAt = t0.plusSeconds(10)))
        }
        val s1 = firstSite()
        assertEquals(failed1.id.toHexString(), s1["latestAssessment"]!!.jsonObject["id"]!!.jsonPrimitive.content)
        assertEquals("failed", s1["latestAssessment"]!!.jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, s1["latestReadyAssessmentId"])

        // a ready check after it, then another failed one: latest is failed, latest ready points at the ready one
        val ready = runBlocking {
            deps.assessments.insert(Assessment(siteId = ObjectId(siteId), userId = user.id, status = "ready", createdAt = t0.plusSeconds(100), updatedAt = t0.plusSeconds(100), completedAt = t0.plusSeconds(160)))
        }
        val failed2 = runBlocking {
            deps.assessments.insert(Assessment(siteId = ObjectId(siteId), userId = user.id, status = "failed", errorCode = "site_unreachable", errorMessage = "No answer.", createdAt = t0.plusSeconds(200), updatedAt = t0.plusSeconds(200), completedAt = t0.plusSeconds(210)))
        }
        val s2 = firstSite()
        assertEquals(failed2.id.toHexString(), s2["latestAssessment"]!!.jsonObject["id"]!!.jsonPrimitive.content)
        assertEquals("failed", s2["latestAssessment"]!!.jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals(ready.id.toHexString(), s2["latestReadyAssessmentId"]!!.jsonPrimitive.content)
    }
}
