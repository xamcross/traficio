# Assessment Engine Implementation Plan (Plan 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The product core: a user with a verified email submits their site's URL; the backend crawls up to 15 pages, runs two Claude calls (analysis → plan), and produces a scored report plus a trackable, beginner-voice action plan — with live SSE progress, tier quotas, re-assessment auto-verification, and per-assessment cost telemetry.

**Architecture:** Everything extends the Plan 1 Ktor monolith (`backend/`). New modules: `sites`, `jobs` (Mongo lease-queue + coroutine worker), `crawl` (fetcher → robots/discovery → Jsoup signal extraction → orchestrator), `claude` (interface + real Anthropic-SDK client + canned fake), `assessment` (validation, routes, SSE, pipeline handler), `plans`. The pipeline is checkpointed (crawl digest persisted before analysis) and idempotent so job retries resume.

**Tech Stack:** Everything from Plan 1, plus `org.jsoup:jsoup:1.18.3` (HTML parsing) and `com.anthropic:anthropic-java:2.34.0` (official SDK; Kotlin-compatible).

## Global Constraints

- Everything in Plan 1's Global Constraints still binds (package root `app.geostrategy`, `/v1` routes, `{"code","message"}` envelope with human messages, `Instant` timestamps, TDD per task, commands from `backend/`).
- **Placeholder/mock policy (user directive):** unknown external values are env vars with working defaults; external services have fake implementations so dev and CI never require real credentials. Specifically: `ANTHROPIC_API_KEY` unset → `CannedClaudeClient` (deterministic, derived from the crawl digest) with a startup WARN; `CLAUDE_MODEL` defaults to `claude-opus-5`; tier limits default free=1 site/1 assessment-per-30-days, pro=5/10 via `FREE_MAX_SITES`, `FREE_ASSESSMENTS_PER_MONTH`, `PRO_MAX_SITES`, `PRO_ASSESSMENTS_PER_MONTH`.
- Tests NEVER call the real Anthropic API or the public internet: Claude via `CannedClaudeClient`, HTTP fetching via `MapFetcher` (in-memory page map).
- Assessment submission requires `emailVerified`; a failed assessment never consumes quota (quota counts non-failed assessments in a rolling 30 days).
- SSRF: submitted URLs are DNS-resolved and rejected if any address is loopback/private/link-local/unique-local.
- Cost telemetry: every assessment stores input/output tokens and `costUsd` at Claude Opus 5 rates ($5/M input, $25/M output).
- Job queue: lease-based (`findOneAndUpdate`), max 2 attempts, 300 s lease.
- Decision carried from Plan 1 review (do not revisit here): sessions keep the fixed 30-day TTL; Google sub-first lookup and remaining ledger minors are Plan 3 cleanup items.
- **Documentation style (user directive, 2026-08-05):** write all new prose documentation in ASD-STE100 style. Use short sentences. Use the active voice. Give one instruction per sentence. This applies to README sections and runbooks that tasks produce. It does not change code, JSON, or test fixtures.

## File Structure

```
backend/src/main/kotlin/app/geostrategy/
  sites/Site.kt                # Site model + SiteRepository
  sites/SiteRoutes.kt          # POST /v1/sites, GET /v1/sites
  jobs/Jobs.kt                 # Job model + JobQueue (lease semantics)
  jobs/JobWorker.kt            # coroutine polling loop
  crawl/Fetching.kt            # FetchResult, Fetcher, HttpFetcher
  crawl/Robots.kt              # minimal robots.txt (User-agent: *) parser
  crawl/Discovery.kt           # sitemap + nav link discovery
  crawl/PageSignals.kt         # Jsoup per-page digest extraction
  crawl/Platform.kt            # platform fingerprinting
  crawl/Crawler.kt             # SiteFacts, CrawlDigest, orchestrator
  claude/Model.kt              # Scores, Finding, AnalysisResult, PlanResult, ClaudeUsage, ClaudeClient
  claude/CannedClaudeClient.kt # deterministic fake
  claude/RealClaudeClient.kt   # Anthropic Java SDK + structured outputs
  assessment/UrlValidation.kt  # normalizeUrl, SsrfGuard, toObjectIdOr404
  assessment/Assessment.kt     # model + AssessmentRepository
  assessment/AssessmentRoutes.kt  # submit, get, SSE events, history
  assessment/AssessmentPipeline.kt# the job handler
  plans/Plans.kt               # PlanTask, PlanDoc, PlanRepository
  plans/PlanRoutes.kt          # get plan, check off task
backend/src/main/resources/
  prompts/analyze-system.txt, prompts/plan-system.txt
  schemas/analysis.json, schemas/plan.json
```

`AppConfig`, `AppDeps`, `Application.kt` (`main`/`appModule`), `persistence/Mongo.kt`, and test `TestSupport.kt` are modified incrementally; each task lists its exact edits.

---

### Task 1: URL normalization + SSRF guard

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/assessment/UrlValidation.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/assessment/UrlValidationTest.kt`

**Interfaces:**
- Consumes: `AppException` (Plan 1).
- Produces: `fun normalizeUrl(raw: String): String` (adds https:// when missing, lowercases host, strips query/fragment, keeps non-default port and non-root path; throws `AppException(400, "invalid_url", …)` on garbage/non-http schemes); `fun hostOf(normalizedUrl: String): String`; `class SsrfGuard(resolve: (String) -> List<InetAddress>)` with `fun check(host: String)` throwing 400 `invalid_url` for private/loopback/link-local/unique-local targets and 400 `site_unreachable` when resolution fails; `fun String.toObjectIdOr404(): ObjectId`.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/assessment/UrlValidationTest.kt`:
```kotlin
package app.geostrategy.assessment

import app.geostrategy.http.AppException
import java.net.InetAddress
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class UrlValidationTest {
    @Test
    fun `normalizeUrl adds scheme, lowercases host, strips query and fragment`() {
        assertEquals("https://example.com", normalizeUrl("Example.COM"))
        assertEquals("https://example.com", normalizeUrl("https://example.com/?utm=1#top"))
        assertEquals("http://example.com/shop", normalizeUrl("http://EXAMPLE.com/shop"))
        assertEquals("https://example.com:8443", normalizeUrl("example.com:8443"))
    }

    @Test
    fun `normalizeUrl rejects garbage and non-http schemes`() {
        assertEquals("invalid_url", assertFailsWith<AppException> { normalizeUrl("not a url at all") }.code)
        assertEquals("invalid_url", assertFailsWith<AppException> { normalizeUrl("ftp://example.com") }.code)
    }

    @Test
    fun `ssrf guard rejects private, loopback, link-local and unique-local addresses`() {
        for (ip in listOf("127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.9", "169.254.1.1", "::1", "fc00::1")) {
            val guard = SsrfGuard { listOf(InetAddress.getByName(ip)) }
            assertEquals("invalid_url", assertFailsWith<AppException> { guard.check("evil.example") }.code)
        }
    }

    @Test
    fun `ssrf guard passes public addresses and maps resolution failure`() {
        SsrfGuard { listOf(InetAddress.getByName("93.184.216.34")) }.check("example.com")
        val failing = SsrfGuard { throw java.net.UnknownHostException("nope") }
        assertEquals("site_unreachable", assertFailsWith<AppException> { failing.check("nope.example") }.code)
    }

    @Test
    fun `toObjectIdOr404 parses valid hex and rejects junk`() {
        assertEquals("507f1f77bcf86cd799439011", "507f1f77bcf86cd799439011".toObjectIdOr404().toHexString())
        assertEquals("not_found", assertFailsWith<AppException> { "zzz".toObjectIdOr404() }.code)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.assessment.UrlValidationTest"`
Expected: compilation FAILS — functions not defined.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/app/geostrategy/assessment/UrlValidation.kt`:
```kotlin
package app.geostrategy.assessment

import app.geostrategy.http.AppException
import io.ktor.http.HttpStatusCode
import org.bson.types.ObjectId
import java.net.InetAddress
import java.net.URI

private val INVALID = { AppException(HttpStatusCode.BadRequest, "invalid_url", "That doesn't look like a website address. Try something like example.com.") }

fun normalizeUrl(raw: String): String {
    var s = raw.trim()
    if (s.isEmpty() || s.any { it.isWhitespace() }) throw INVALID()
    if (!s.startsWith("http://", ignoreCase = true) && !s.startsWith("https://", ignoreCase = true)) {
        if ("://" in s) throw AppException(HttpStatusCode.BadRequest, "invalid_url", "Only http and https websites are supported.")
        s = "https://$s"
    }
    val uri = try { URI(s) } catch (e: Exception) { throw INVALID() }
    val scheme = uri.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") {
        throw AppException(HttpStatusCode.BadRequest, "invalid_url", "Only http and https websites are supported.")
    }
    val host = uri.host?.lowercase() ?: throw INVALID()
    val port = if (uri.port == -1 || uri.port == 80 && scheme == "http" || uri.port == 443 && scheme == "https") "" else ":${uri.port}"
    val path = uri.rawPath?.takeIf { it.isNotEmpty() && it != "/" }?.trimEnd('/') ?: ""
    return "$scheme://$host$port$path"
}

fun hostOf(normalizedUrl: String): String = URI(normalizedUrl).host

class SsrfGuard(
    private val resolve: (String) -> List<InetAddress> = { InetAddress.getAllByName(it).toList() },
) {
    fun check(host: String) {
        val addresses = try { resolve(host) } catch (e: Exception) {
            throw AppException(HttpStatusCode.BadRequest, "site_unreachable", "We couldn't find that website. Double-check the address and try again.")
        }
        if (addresses.isEmpty()) {
            throw AppException(HttpStatusCode.BadRequest, "site_unreachable", "We couldn't find that website. Double-check the address and try again.")
        }
        if (addresses.any { it.isLoopbackAddress || it.isSiteLocalAddress || it.isLinkLocalAddress || it.isAnyLocalAddress || isUniqueLocal(it) }) {
            throw AppException(HttpStatusCode.BadRequest, "invalid_url", "That address points to a private network, which we can't assess.")
        }
    }

    private fun isUniqueLocal(a: InetAddress): Boolean =
        a.address.size == 16 && (a.address[0].toInt() and 0xfe) == 0xfc
}

fun String.toObjectIdOr404(): ObjectId =
    if (ObjectId.isValid(this)) ObjectId(this)
    else throw AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that.")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./gradlew test --tests "app.geostrategy.assessment.UrlValidationTest"` then `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): URL normalization and SSRF guard for assessment targets"
```

---

### Task 2: Tier limits config, sites model + API

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/sites/Site.kt`, `backend/src/main/kotlin/app/geostrategy/sites/SiteRoutes.kt`
- Modify: `backend/src/main/kotlin/app/geostrategy/config/AppConfig.kt` (add `anthropicApiKey`, `claudeModel`, `tierLimits`)
- Modify: `backend/src/main/kotlin/app/geostrategy/persistence/Mongo.kt` (indexes for `sites`, `jobs`, `assessments`, `plans`)
- Modify: `backend/src/main/kotlin/app/geostrategy/AppDeps.kt` (+ `sites: SiteRepository`), `Application.kt` (`main()` constructs it; `routing` gains `siteRoutes(deps)`), test `TestSupport.kt` (`testDeps` builds it)
- Test: `backend/src/test/kotlin/app/geostrategy/sites/SiteRoutesTest.kt`

**Interfaces:**
- Consumes: Task 1 (`normalizeUrl`), Plan 1 auth (`requireUser`, `testDeps`, `RecordingEmailSender`).
- Produces:
  - `data class TierLimits(val freeMaxSites: Int, val freeAssessmentsPerMonth: Int, val proMaxSites: Int, val proAssessmentsPerMonth: Int)` with `fun maxSitesFor(tier: String)`, `fun assessmentsPerMonthFor(tier: String)`; `AppConfig` gains `anthropicApiKey: String?`, `claudeModel: String` (default `"claude-opus-5"`), `tierLimits: TierLimits`.
  - `@Serializable data class Scores(val seo: Int, val aeo: Int, val geo: Int)` (lives in `claude/Model.kt` from Task 8 on; **declare it here in `sites/Site.kt` and move it in Task 8** is forbidden — instead create `backend/src/main/kotlin/app/geostrategy/claude/Model.kt` NOW containing only `Scores`; Task 8 extends that file).
  - `data class Site(@BsonId val id: ObjectId = ObjectId(), val userId: ObjectId, val domain: String, val url: String, val platform: String? = null, val latestScores: Scores? = null, val createdAt: Instant, val updatedAt: Instant)`
  - `class SiteRepository(db)`: `insert` (409 `site_exists` on dup userId+domain), `findById`, `listFor(userId)`, `countFor(userId): Long`, `updateAfterAssessment(id, platform, scores)`
  - Routes: `POST /v1/sites` body `{"url"}` → 201 `SiteDto(id, domain, url, platform, latestScores)`; 403 `site_limit_reached` when at tier cap; `GET /v1/sites` → `{"sites":[SiteDto]}`.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/sites/SiteRoutesTest.kt`:
```kotlin
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
```

Add the shared journey helper to `backend/src/test/kotlin/app/geostrategy/TestSupport.kt`:
```kotlin
suspend fun registerAndLogin(
    http: io.ktor.client.HttpClient,
    email: String,
    password: String = "correct-horse",
) {
    http.post("/v1/auth/register") {
        io.ktor.http.contentType(io.ktor.http.ContentType.Application.Json)
        io.ktor.client.request.setBody("""{"email":"$email","password":"$password"}""")
    }
    http.post("/v1/auth/login") {
        io.ktor.http.contentType(io.ktor.http.ContentType.Application.Json)
        io.ktor.client.request.setBody("""{"email":"$email","password":"$password"}""")
    }
}
```
(Write it with imports at the top of the file, not fully qualified.)

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.sites.SiteRoutesTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/app/geostrategy/claude/Model.kt` (seed file — Task 8 extends it):
```kotlin
package app.geostrategy.claude

import kotlinx.serialization.Serializable

@Serializable
data class Scores(val seo: Int, val aeo: Int, val geo: Int)
```

Add to `AppConfig` (fields + `fromEnv` wiring + the new data class in the same file):
```kotlin
data class TierLimits(
    val freeMaxSites: Int,
    val freeAssessmentsPerMonth: Int,
    val proMaxSites: Int,
    val proAssessmentsPerMonth: Int,
) {
    fun maxSitesFor(tier: String) = if (tier == "pro") proMaxSites else freeMaxSites
    fun assessmentsPerMonthFor(tier: String) = if (tier == "pro") proAssessmentsPerMonth else freeAssessmentsPerMonth
}
```
New `AppConfig` constructor fields and `fromEnv` entries:
```kotlin
val anthropicApiKey: String?,   // fromEnv: env["ANTHROPIC_API_KEY"]
val claudeModel: String,        // fromEnv: env["CLAUDE_MODEL"] ?: "claude-opus-5"
val tierLimits: TierLimits,
// fromEnv:
tierLimits = TierLimits(
    freeMaxSites = env["FREE_MAX_SITES"]?.toInt() ?: 1,
    freeAssessmentsPerMonth = env["FREE_ASSESSMENTS_PER_MONTH"]?.toInt() ?: 1,
    proMaxSites = env["PRO_MAX_SITES"]?.toInt() ?: 5,
    proAssessmentsPerMonth = env["PRO_ASSESSMENTS_PER_MONTH"]?.toInt() ?: 10,
),
```

`backend/src/main/kotlin/app/geostrategy/sites/Site.kt`:
```kotlin
package app.geostrategy.sites

import app.geostrategy.claude.Scores
import app.geostrategy.http.AppException
import com.mongodb.MongoWriteException
import com.mongodb.client.model.Filters.and
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Updates.combine
import com.mongodb.client.model.Updates.set
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.toList
import org.bson.codecs.pojo.annotations.BsonId
import org.bson.types.ObjectId
import java.time.Instant

data class Site(
    @BsonId val id: ObjectId = ObjectId(),
    val userId: ObjectId,
    val domain: String,
    val url: String,
    val platform: String? = null,
    val latestScores: Scores? = null,
    val createdAt: Instant,
    val updatedAt: Instant,
)

class SiteRepository(db: MongoDatabase) {
    private val col = db.getCollection<Site>("sites")

    suspend fun insert(site: Site): Site {
        try {
            col.insertOne(site)
        } catch (e: MongoWriteException) {
            if (e.error.code == 11000) {
                throw AppException(HttpStatusCode.Conflict, "site_exists", "You've already added this site.")
            }
            throw e
        }
        return site
    }

    suspend fun findById(id: ObjectId): Site? = col.find(eq("_id", id)).firstOrNull()

    suspend fun listFor(userId: ObjectId): List<Site> = col.find(eq("userId", userId)).toList()

    suspend fun countFor(userId: ObjectId): Long = col.countDocuments(eq("userId", userId))

    suspend fun updateAfterAssessment(id: ObjectId, platform: String, scores: Scores) {
        col.updateOne(
            eq("_id", id),
            combine(set("platform", platform), set("latestScores", scores), set("updatedAt", Instant.now())),
        )
    }
}
```

`backend/src/main/kotlin/app/geostrategy/sites/SiteRoutes.kt`:
```kotlin
package app.geostrategy.sites

import app.geostrategy.AppDeps
import app.geostrategy.assessment.hostOf
import app.geostrategy.assessment.normalizeUrl
import app.geostrategy.auth.requireUser
import app.geostrategy.claude.Scores
import app.geostrategy.http.AppException
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import kotlinx.serialization.Serializable
import java.time.Instant

@Serializable data class CreateSiteRequest(val url: String)
@Serializable data class SiteDto(val id: String, val domain: String, val url: String, val platform: String?, val latestScores: Scores?)
@Serializable data class SiteListResponse(val sites: List<SiteDto>)

fun Site.toDto() = SiteDto(id.toHexString(), domain, url, platform, latestScores)

fun Route.siteRoutes(deps: AppDeps) {
    post("/v1/sites") {
        val user = call.requireUser(deps)
        val url = normalizeUrl(call.receive<CreateSiteRequest>().url)
        val max = deps.config.tierLimits.maxSitesFor(user.tier)
        if (deps.sites.countFor(user.id) >= max) {
            throw AppException(HttpStatusCode.Forbidden, "site_limit_reached", "Your plan includes $max site${if (max == 1) "" else "s"}. Upgrade to add more.")
        }
        val now = Instant.now()
        val site = deps.sites.insert(Site(userId = user.id, domain = hostOf(url), url = url, createdAt = now, updatedAt = now))
        call.respond(HttpStatusCode.Created, site.toDto())
    }

    get("/v1/sites") {
        val user = call.requireUser(deps)
        call.respond(SiteListResponse(deps.sites.listFor(user.id).map { it.toDto() }))
    }
}
```

Wiring: `AppDeps` gains `val sites: SiteRepository`; `main()` passes `SiteRepository(db)`; `appModule`'s routing adds `siteRoutes(deps)` after `googleAuthRoutes(deps)`; `testDeps` adds `sites = SiteRepository(db)`.

Append to `ensureIndexes` in `persistence/Mongo.kt` (all Plan 2 indexes at once):
```kotlin
    db.getCollection<Document>("sites")
        .createIndex(Indexes.ascending("userId", "domain"), IndexOptions().unique(true))
    db.getCollection<Document>("jobs")
        .createIndex(Indexes.ascending("status", "leasedUntil"))
    db.getCollection<Document>("assessments")
        .createIndex(Indexes.ascending("siteId", "createdAt"))
    db.getCollection<Document>("assessments")
        .createIndex(Indexes.ascending("userId", "createdAt"))
    db.getCollection<Document>("plans")
        .createIndex(Indexes.ascending("siteId", "createdAt"))
```

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL (all Plan 1 tests still green — `AppConfig` changes are additive with defaults handled in `fromEnv`).

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): tier limits config and sites API with per-tier cap"
```

---

### Task 3: Job queue with lease semantics

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/jobs/Jobs.kt`
- Modify: `AppDeps.kt` (+ `jobs: JobQueue`), `Application.kt` `main()`, `TestSupport.kt` `testDeps`
- Test: `backend/src/test/kotlin/app/geostrategy/jobs/JobQueueTest.kt`

**Interfaces:**
- Consumes: `TestMongo`.
- Produces: `data class Job(@BsonId val id: ObjectId = ObjectId(), val type: String, val payload: Document, val status: String = "queued", val attempts: Int = 0, val leasedUntil: Instant? = null, val error: String? = null, val createdAt: Instant, val updatedAt: Instant)`; `class JobQueue(db, maxAttempts: Int = 2)` with `suspend fun enqueue(type: String, payload: Document): Job`, `suspend fun claim(leaseSeconds: Long = 300): Job?` (oldest first; re-claims expired leases; increments `attempts`), `suspend fun complete(id: ObjectId)`, `suspend fun fail(id: ObjectId, error: String)` (re-queues below `maxAttempts`, else marks `failed`), `suspend fun findById(id: ObjectId): Job?`.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/jobs/JobQueueTest.kt`:
```kotlin
package app.geostrategy.jobs

import app.geostrategy.TestMongo
import kotlinx.coroutines.runBlocking
import org.bson.Document
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class JobQueueTest {
    @Test
    fun `claim returns oldest queued job once and complete finishes it`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb())
        val first = q.enqueue("assessment", Document("k", "v1"))
        q.enqueue("assessment", Document("k", "v2"))
        val claimed = q.claim()
        assertNotNull(claimed)
        assertEquals(first.id, claimed.id)
        assertEquals("running", claimed.status)
        assertEquals(1, claimed.attempts)
        q.complete(claimed.id)
        assertEquals("done", q.findById(claimed.id)!!.status)
        // second job still claimable, first is not
        assertEquals("v2", q.claim()!!.payload.getString("k"))
        assertNull(q.claim())
    }

    @Test
    fun `expired lease is re-claimable, exhausted attempts fail the job`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb(), maxAttempts = 2)
        val j = q.enqueue("assessment", Document())
        assertEquals(1, q.claim(leaseSeconds = -10)!!.attempts)  // lease already expired
        assertEquals(2, q.claim(leaseSeconds = -10)!!.attempts)  // re-claimed
        q.fail(j.id, "boom")                                     // attempts == max -> failed
        val failed = q.findById(j.id)!!
        assertEquals("failed", failed.status)
        assertEquals("boom", failed.error)
        assertNull(q.claim())
    }

    @Test
    fun `fail below max attempts re-queues`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb(), maxAttempts = 2)
        val j = q.enqueue("assessment", Document())
        q.claim()
        q.fail(j.id, "transient")
        assertEquals("queued", q.findById(j.id)!!.status)
        assertNotNull(q.claim())
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.jobs.JobQueueTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/app/geostrategy/jobs/Jobs.kt`:
```kotlin
package app.geostrategy.jobs

import com.mongodb.client.model.Filters.and
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Filters.lt
import com.mongodb.client.model.Filters.or
import com.mongodb.client.model.FindOneAndUpdateOptions
import com.mongodb.client.model.ReturnDocument
import com.mongodb.client.model.Sorts
import com.mongodb.client.model.Updates.combine
import com.mongodb.client.model.Updates.inc
import com.mongodb.client.model.Updates.set
import com.mongodb.client.model.Updates.unset
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import kotlinx.coroutines.flow.firstOrNull
import org.bson.Document
import org.bson.codecs.pojo.annotations.BsonId
import org.bson.types.ObjectId
import java.time.Instant

data class Job(
    @BsonId val id: ObjectId = ObjectId(),
    val type: String,
    val payload: Document,
    val status: String = "queued",
    val attempts: Int = 0,
    val leasedUntil: Instant? = null,
    val error: String? = null,
    val createdAt: Instant,
    val updatedAt: Instant,
)

class JobQueue(db: MongoDatabase, private val maxAttempts: Int = 2) {
    private val col = db.getCollection<Job>("jobs")

    suspend fun enqueue(type: String, payload: Document): Job {
        val now = Instant.now()
        val job = Job(type = type, payload = payload, createdAt = now, updatedAt = now)
        col.insertOne(job)
        return job
    }

    suspend fun claim(leaseSeconds: Long = 300): Job? {
        val now = Instant.now()
        return col.findOneAndUpdate(
            or(
                eq("status", "queued"),
                and(eq("status", "running"), lt("leasedUntil", now)),
            ),
            combine(
                set("status", "running"),
                set("leasedUntil", now.plusSeconds(leaseSeconds)),
                inc("attempts", 1),
                set("updatedAt", now),
            ),
            FindOneAndUpdateOptions().sort(Sorts.ascending("createdAt")).returnDocument(ReturnDocument.AFTER),
        )
    }

    suspend fun complete(id: ObjectId) {
        col.updateOne(eq("_id", id), combine(set("status", "done"), unset("leasedUntil"), set("updatedAt", Instant.now())))
    }

    suspend fun fail(id: ObjectId, error: String) {
        val job = findById(id) ?: return
        val newStatus = if (job.attempts >= maxAttempts) "failed" else "queued"
        col.updateOne(
            eq("_id", id),
            combine(set("status", newStatus), set("error", error), unset("leasedUntil"), set("updatedAt", Instant.now())),
        )
    }

    suspend fun findById(id: ObjectId): Job? = col.find(eq("_id", id)).firstOrNull()
}
```

Wiring: `AppDeps` gains `val jobs: JobQueue`; `main()` passes `JobQueue(db)`; `testDeps` adds `jobs = JobQueue(db)`.

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): Mongo-backed job queue with lease claiming and bounded attempts"
```

---

### Task 4: Job worker loop

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/jobs/JobWorker.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/jobs/JobWorkerTest.kt`

**Interfaces:**
- Consumes: `JobQueue`, `Job` (Task 3).
- Produces: `class JobWorker(queue: JobQueue, handlers: Map<String, suspend (Job) -> Unit>, pollMillis: Long = 1000)` with `fun start(scope: CoroutineScope): kotlinx.coroutines.Job` — polls `claim()`, runs the handler for `job.type`, `complete`s on success, `fail`s with the exception message on error, keeps looping until the scope is cancelled. An unknown job type fails the job.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/jobs/JobWorkerTest.kt`:
```kotlin
package app.geostrategy.jobs

import app.geostrategy.TestMongo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.bson.Document
import kotlin.test.Test
import kotlin.test.assertEquals

class JobWorkerTest {
    private suspend fun awaitStatus(q: JobQueue, id: org.bson.types.ObjectId, status: String) =
        withTimeout(10_000) {
            while (q.findById(id)!!.status != status) delay(50)
        }

    @Test
    fun `worker runs handler and completes the job`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb())
        val seen = mutableListOf<String>()
        val worker = JobWorker(q, mapOf("greet" to { job -> seen.add(job.payload.getString("name")) }), pollMillis = 50)
        val j = q.enqueue("greet", Document("name", "ada"))
        val handle = worker.start(CoroutineScope(Dispatchers.Default))
        awaitStatus(q, j.id, "done")
        handle.cancelAndJoin()
        assertEquals(listOf("ada"), seen)
    }

    @Test
    fun `failing handler retries then fails the job`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb(), maxAttempts = 2)
        var calls = 0
        val worker = JobWorker(q, mapOf("boom" to { _ -> calls++; error("nope") }), pollMillis = 50)
        val j = q.enqueue("boom", Document())
        val handle = worker.start(CoroutineScope(Dispatchers.Default))
        awaitStatus(q, j.id, "failed")
        handle.cancelAndJoin()
        assertEquals(2, calls)
        assertEquals("nope", q.findById(j.id)!!.error)
    }

    @Test
    fun `unknown job type fails without crashing the worker`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb(), maxAttempts = 1)
        val worker = JobWorker(q, emptyMap(), pollMillis = 50)
        val j = q.enqueue("mystery", Document())
        val handle = worker.start(CoroutineScope(Dispatchers.Default))
        awaitStatus(q, j.id, "failed")
        handle.cancelAndJoin()
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.jobs.JobWorkerTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/app/geostrategy/jobs/JobWorker.kt`:
```kotlin
package app.geostrategy.jobs

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory

class JobWorker(
    private val queue: JobQueue,
    private val handlers: Map<String, suspend (Job) -> Unit>,
    private val pollMillis: Long = 1000,
) {
    private val log = LoggerFactory.getLogger(JobWorker::class.java)

    fun start(scope: CoroutineScope): kotlinx.coroutines.Job = scope.launch {
        while (isActive) {
            val job = queue.claim()
            if (job == null) {
                delay(pollMillis)
                continue
            }
            try {
                val handler = handlers[job.type] ?: error("no handler registered for job type '${job.type}'")
                handler(job)
                queue.complete(job.id)
            } catch (e: Exception) {
                log.warn("job {} ({}) attempt {} failed: {}", job.id, job.type, job.attempts, e.message)
                queue.fail(job.id, e.message ?: "unknown error")
            }
        }
    }
}
```

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): coroutine job worker with retry-aware error handling"
```

---

### Task 5: Fetcher, robots.txt, URL discovery

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/crawl/Fetching.kt`, `crawl/Robots.kt`, `crawl/Discovery.kt`
- Modify: `backend/build.gradle.kts` (add `implementation("org.jsoup:jsoup:1.18.3")`)
- Modify: `TestSupport.kt` (add `MapFetcher`)
- Test: `backend/src/test/kotlin/app/geostrategy/crawl/DiscoveryTest.kt`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `data class FetchResult(val url: String, val status: Int, val contentType: String?, val body: String)`
  - `interface Fetcher { suspend fun fetch(url: String): FetchResult? }` (null = network failure)
  - `class HttpFetcher(http: HttpClient, maxBytes: Int = 2_000_000) : Fetcher` — 10 s request timeout handled by the client config passed in `main()`; truncates bodies at `maxBytes`; sends `User-Agent: GeoStrategyBot/1.0 (+https://geostrategy.app)`.
  - `class Robots(disallowed: List<String>)` with `fun allows(path: String): Boolean`; `Robots.parse(txt: String?): Robots` — collects `Disallow:` prefixes in `User-agent: *` groups; null/blank input allows everything.
  - `fun discoverUrls(baseUrl: String, homepageHtml: String, sitemapXml: String?, cap: Int = 15): List<String>` — homepage first, then same-host `<a href>` links (Jsoup, absolute, query/fragment stripped), then sitemap `<loc>` entries; de-duplicated, capped.
  - Test helper `class MapFetcher(private val pages: Map<String, String>) : Fetcher` in `TestSupport.kt` — returns 200/text-html for known URLs, null otherwise.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/crawl/DiscoveryTest.kt`:
```kotlin
package app.geostrategy.crawl

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DiscoveryTest {
    @Test
    fun `robots parse respects star group and allows when absent`() {
        val robots = Robots.parse(
            """
            User-agent: OtherBot
            Disallow: /everything
            User-agent: *
            Disallow: /admin
            Disallow: /private/
            """.trimIndent(),
        )
        assertFalse(robots.allows("/admin"))
        assertFalse(robots.allows("/private/page"))
        assertTrue(robots.allows("/blog"))
        assertTrue(Robots.parse(null).allows("/anything"))
    }

    @Test
    fun `discovery merges nav links and sitemap, same host only, capped, homepage first`() {
        val html = """
            <html><body>
              <nav><a href="/about">About</a><a href="https://example.com/pricing?x=1">Pricing</a></nav>
              <a href="https://elsewhere.example/other">External</a>
              <a href="mailto:hi@example.com">Mail</a>
            </body></html>
        """
        val sitemap = """
            <urlset><url><loc>https://example.com/blog/post-1</loc></url>
            <url><loc>https://example.com/about</loc></url></urlset>
        """
        val urls = discoverUrls("https://example.com", html, sitemap, cap = 4)
        assertEquals("https://example.com", urls.first())
        assertTrue("https://example.com/about" in urls)
        assertTrue("https://example.com/pricing" in urls)
        assertTrue("https://example.com/blog/post-1" in urls)
        assertEquals(4, urls.size)
        assertFalse(urls.any { "elsewhere" in it })
    }

    @Test
    fun `discovery survives missing sitemap and relative junk`() {
        val urls = discoverUrls("https://example.com", "<a href='#'>x</a><a href='/only'>y</a>", null)
        assertEquals(listOf("https://example.com", "https://example.com/only"), urls)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.crawl.DiscoveryTest"`
Expected: compilation FAILS (also add the jsoup dependency now or this cannot compile).

- [ ] **Step 3: Implement**

Add to `backend/build.gradle.kts` dependencies: `implementation("org.jsoup:jsoup:1.18.3")`.

`backend/src/main/kotlin/app/geostrategy/crawl/Fetching.kt`:
```kotlin
package app.geostrategy.crawl

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.HttpHeaders
import io.ktor.utils.io.readRemaining
import kotlinx.io.readString

data class FetchResult(val url: String, val status: Int, val contentType: String?, val body: String)

interface Fetcher {
    suspend fun fetch(url: String): FetchResult?
}

class HttpFetcher(private val http: HttpClient, private val maxBytes: Int = 2_000_000) : Fetcher {
    override suspend fun fetch(url: String): FetchResult? = try {
        val res = http.get(url) {
            header(HttpHeaders.UserAgent, "GeoStrategyBot/1.0 (+https://geostrategy.app)")
        }
        val body = res.bodyAsChannel().readRemaining(maxBytes.toLong()).readString()
        FetchResult(url, res.status.value, res.headers[HttpHeaders.ContentType], body)
    } catch (e: Exception) {
        null
    }
}
```
(If `readString()` doesn't resolve on the project's Ktor version, use `readText()` from `io.ktor.utils.io.core` — same semantics; keep whichever compiles.)

`backend/src/main/kotlin/app/geostrategy/crawl/Robots.kt`:
```kotlin
package app.geostrategy.crawl

class Robots(private val disallowed: List<String>) {
    fun allows(path: String): Boolean = disallowed.none { it.isNotEmpty() && path.startsWith(it) }

    companion object {
        fun parse(txt: String?): Robots {
            if (txt.isNullOrBlank()) return Robots(emptyList())
            val rules = mutableListOf<String>()
            var inStarGroup = false
            for (line in txt.lines()) {
                val trimmed = line.substringBefore('#').trim()
                when {
                    trimmed.startsWith("User-agent:", ignoreCase = true) ->
                        inStarGroup = trimmed.substringAfter(':').trim() == "*"
                    trimmed.startsWith("Disallow:", ignoreCase = true) && inStarGroup ->
                        rules.add(trimmed.substringAfter(':').trim())
                }
            }
            return Robots(rules)
        }
    }
}
```

`backend/src/main/kotlin/app/geostrategy/crawl/Discovery.kt`:
```kotlin
package app.geostrategy.crawl

import org.jsoup.Jsoup
import java.net.URI

fun discoverUrls(baseUrl: String, homepageHtml: String, sitemapXml: String?, cap: Int = 15): List<String> {
    val base = URI(baseUrl)
    val result = linkedSetOf(baseUrl)

    val doc = Jsoup.parse(homepageHtml, baseUrl)
    for (a in doc.select("a[href]")) {
        normalizeCandidate(a.absUrl("href"), base)?.let { result.add(it) }
        if (result.size >= cap) return result.toList()
    }

    if (sitemapXml != null) {
        for (match in Regex("<loc>\\s*(.*?)\\s*</loc>").findAll(sitemapXml)) {
            normalizeCandidate(match.groupValues[1], base)?.let { result.add(it) }
            if (result.size >= cap) break
        }
    }
    return result.take(cap).toList()
}

private fun normalizeCandidate(raw: String, base: URI): String? {
    if (raw.isBlank()) return null
    val uri = try { URI(raw) } catch (e: Exception) { return null }
    val scheme = uri.scheme?.lowercase() ?: return null
    if (scheme != "http" && scheme != "https") return null
    val host = uri.host?.lowercase() ?: return null
    if (host != base.host.lowercase()) return null
    val path = uri.rawPath?.takeIf { it.isNotEmpty() && it != "/" }?.trimEnd('/') ?: ""
    return "$scheme://$host$path"
}
```

Append to `TestSupport.kt`:
```kotlin
class MapFetcher(private val pages: Map<String, String>) : app.geostrategy.crawl.Fetcher {
    override suspend fun fetch(url: String): app.geostrategy.crawl.FetchResult? =
        pages[url]?.let { app.geostrategy.crawl.FetchResult(url, 200, "text/html", it) }
}
```
(Imports at top of file.)

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): fetcher, robots parsing and same-host URL discovery"
```

---

### Task 6: Page signal extraction + platform fingerprinting

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/crawl/PageSignals.kt`, `crawl/Platform.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/crawl/PageSignalsTest.kt`

**Interfaces:**
- Consumes: Jsoup (Task 5 dependency).
- Produces:
  - `data class PageDigest(val url: String, val title: String?, val metaDescription: String?, val h1Count: Int, val h2Count: Int, val canonical: String?, val hasOgTags: Boolean, val jsonLdTypes: List<String>, val robotsMeta: String?, val imgCount: Int, val imgWithAltCount: Int, val wordCount: Int, val internalLinkCount: Int, val externalLinkCount: Int, val looksJsOnly: Boolean)`
  - `fun extractPageSignals(url: String, html: String): PageDigest`
  - `fun detectPlatform(html: String): String` — one of `wordpress|wix|squarespace|shopify|webflow|custom`.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/crawl/PageSignalsTest.kt`:
```kotlin
package app.geostrategy.crawl

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PageSignalsTest {
    private val richHtml = """
        <html><head>
          <title>Ada's Bakery</title>
          <meta name="description" content="Fresh bread daily in Warsaw.">
          <link rel="canonical" href="https://example.com/">
          <meta property="og:title" content="Ada's Bakery">
          <script type="application/ld+json">{"@type":"LocalBusiness","name":"Ada's"}</script>
        </head><body>
          <h1>Welcome</h1><h2>Our bread</h2><h2>Visit us</h2>
          <img src="a.jpg" alt="sourdough loaf"><img src="b.jpg">
          <a href="/menu">Menu</a><a href="https://instagram.com/ada">IG</a>
          <p>${"fresh bread ".repeat(40)}</p>
        </body></html>
    """

    @Test
    fun `extracts the full signal set`() {
        val d = extractPageSignals("https://example.com", richHtml)
        assertEquals("Ada's Bakery", d.title)
        assertEquals("Fresh bread daily in Warsaw.", d.metaDescription)
        assertEquals(1, d.h1Count)
        assertEquals(2, d.h2Count)
        assertEquals("https://example.com/", d.canonical)
        assertTrue(d.hasOgTags)
        assertEquals(listOf("LocalBusiness"), d.jsonLdTypes)
        assertEquals(2, d.imgCount)
        assertEquals(1, d.imgWithAltCount)
        assertTrue(d.wordCount > 50)
        assertEquals(1, d.internalLinkCount)
        assertEquals(1, d.externalLinkCount)
        assertFalse(d.looksJsOnly)
    }

    @Test
    fun `sparse js-shell page is flagged and empty fields are null`() {
        val d = extractPageSignals("https://example.com", """<html><head></head><body><div id="root"></div><script src="app.js"></script></body></html>""")
        assertNull(d.title)
        assertNull(d.metaDescription)
        assertTrue(d.looksJsOnly)
    }

    @Test
    fun `platform fingerprints`() {
        assertEquals("wordpress", detectPlatform("""<link href="/wp-content/themes/x/style.css">"""))
        assertEquals("wordpress", detectPlatform("""<meta name="generator" content="WordPress 6.5">"""))
        assertEquals("wix", detectPlatform("""<script src="https://static.parastorage.com/x.js"></script><meta name="generator" content="Wix.com Website Builder">"""))
        assertEquals("squarespace", detectPlatform("""<!-- This is Squarespace. -->"""))
        assertEquals("shopify", detectPlatform("""<link href="https://cdn.shopify.com/x.css">"""))
        assertEquals("webflow", detectPlatform("""<html data-wf-domain="x" class="w-mod-js">"""))
        assertEquals("custom", detectPlatform("<html><body>plain</body></html>"))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.crawl.PageSignalsTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/app/geostrategy/crawl/PageSignals.kt`:
```kotlin
package app.geostrategy.crawl

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.jsoup.Jsoup
import java.net.URI

data class PageDigest(
    val url: String,
    val title: String?,
    val metaDescription: String?,
    val h1Count: Int,
    val h2Count: Int,
    val canonical: String?,
    val hasOgTags: Boolean,
    val jsonLdTypes: List<String>,
    val robotsMeta: String?,
    val imgCount: Int,
    val imgWithAltCount: Int,
    val wordCount: Int,
    val internalLinkCount: Int,
    val externalLinkCount: Int,
    val looksJsOnly: Boolean,
)

fun extractPageSignals(url: String, html: String): PageDigest {
    val doc = Jsoup.parse(html, url)
    val host = URI(url).host?.lowercase()
    val text = doc.body()?.text() ?: ""
    val wordCount = text.split(Regex("\\s+")).count { it.isNotBlank() }
    val links = doc.select("a[href]").mapNotNull {
        try { URI(it.absUrl("href")).host?.lowercase() } catch (e: Exception) { null }
    }
    val jsonLdTypes = doc.select("script[type=application/ld+json]").mapNotNull { el ->
        try {
            Json.parseToJsonElement(el.data()).jsonObject["@type"]?.jsonPrimitive?.content
        } catch (e: Exception) { null }
    }
    return PageDigest(
        url = url,
        title = doc.selectFirst("head > title")?.text()?.takeIf { it.isNotBlank() },
        metaDescription = doc.selectFirst("meta[name=description]")?.attr("content")?.takeIf { it.isNotBlank() },
        h1Count = doc.select("h1").size,
        h2Count = doc.select("h2").size,
        canonical = doc.selectFirst("link[rel=canonical]")?.attr("href")?.takeIf { it.isNotBlank() },
        hasOgTags = doc.select("meta[property^=og:]").isNotEmpty(),
        jsonLdTypes = jsonLdTypes,
        robotsMeta = doc.selectFirst("meta[name=robots]")?.attr("content")?.takeIf { it.isNotBlank() },
        imgCount = doc.select("img").size,
        imgWithAltCount = doc.select("img[alt]").count { it.attr("alt").isNotBlank() },
        wordCount = wordCount,
        internalLinkCount = links.count { it == host },
        externalLinkCount = links.count { it != null && it != host },
        looksJsOnly = wordCount < 30 && doc.select("script").isNotEmpty(),
    )
}
```

`backend/src/main/kotlin/app/geostrategy/crawl/Platform.kt`:
```kotlin
package app.geostrategy.crawl

fun detectPlatform(html: String): String {
    val h = html.lowercase()
    return when {
        "wp-content" in h || "wp-includes" in h || "content=\"wordpress" in h -> "wordpress"
        "parastorage.com" in h || "wix.com website builder" in h || "wixstatic.com" in h -> "wix"
        "squarespace" in h -> "squarespace"
        "cdn.shopify.com" in h || "shopify.theme" in h -> "shopify"
        "data-wf-domain" in h || "assets.website-files.com" in h -> "webflow"
        else -> "custom"
    }
}
```

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): page signal extraction and platform fingerprinting"
```

### Task 7: Crawl orchestrator

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/crawl/Crawler.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/crawl/CrawlerTest.kt`

**Interfaces:**
- Consumes: `Fetcher`, `Robots`, `discoverUrls`, `extractPageSignals`, `detectPlatform` (Tasks 5–6); `MapFetcher` (test).
- Produces: `data class SiteFacts(val https: Boolean, val robotsTxtPresent: Boolean, val sitemapPresent: Boolean, val llmsTxtPresent: Boolean)`; `data class CrawlDigest(val startUrl: String, val platform: String, val facts: SiteFacts, val pages: List<PageDigest>, val looksJsOnly: Boolean)`; `class Crawler(fetcher: Fetcher, budgetMillis: Long = 90_000, pageCap: Int = 15)` with `suspend fun crawl(startUrl: String): CrawlDigest`. The crawler throws `AppException(502, "site_unreachable", …)` when the homepage does not load.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/crawl/CrawlerTest.kt`:
```kotlin
package app.geostrategy.crawl

import app.geostrategy.MapFetcher
import app.geostrategy.http.AppException
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CrawlerTest {
    private val home = """
        <html><head><title>Ada's Bakery</title><meta name="description" content="Bread."></head>
        <body><a href="/menu">Menu</a><a href="/admin">Admin</a><p>${"bread ".repeat(50)}</p></body></html>
    """
    private val menu = """<html><head><title>Menu</title></head><body><p>${"rye ".repeat(50)}</p></body></html>"""

    @Test
    fun `crawls homepage plus discovered pages and collects site facts`() = runBlocking {
        val fetcher = MapFetcher(mapOf(
            "https://example.com" to home,
            "https://example.com/menu" to menu,
            "https://example.com/admin" to "<html><body>secret</body></html>",
            "https://example.com/robots.txt" to "User-agent: *\nDisallow: /admin",
            "https://example.com/sitemap.xml" to "<urlset><url><loc>https://example.com/menu</loc></url></urlset>",
        ))
        val digest = Crawler(fetcher).crawl("https://example.com")
        assertEquals(listOf("https://example.com", "https://example.com/menu"), digest.pages.map { it.url })
        assertTrue(digest.facts.https)
        assertTrue(digest.facts.robotsTxtPresent)
        assertTrue(digest.facts.sitemapPresent)
        assertFalse(digest.facts.llmsTxtPresent)
        assertFalse(digest.looksJsOnly)
        assertEquals("custom", digest.platform)
    }

    @Test
    fun `unreachable homepage throws site_unreachable`() = runBlocking {
        val e = assertFailsWith<AppException> { Crawler(MapFetcher(emptyMap())).crawl("https://gone.example") }
        assertEquals("site_unreachable", e.code)
    }

    @Test
    fun `majority js-shell pages set looksJsOnly`() = runBlocking {
        val shell = """<html><body><div id="root"></div><script src="a.js"></script></body></html>"""
        val digest = Crawler(MapFetcher(mapOf("https://spa.example" to shell))).crawl("https://spa.example")
        assertTrue(digest.looksJsOnly)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.crawl.CrawlerTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/app/geostrategy/crawl/Crawler.kt`:
```kotlin
package app.geostrategy.crawl

import app.geostrategy.http.AppException
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.withTimeoutOrNull
import java.net.URI

data class SiteFacts(
    val https: Boolean,
    val robotsTxtPresent: Boolean,
    val sitemapPresent: Boolean,
    val llmsTxtPresent: Boolean,
)

data class CrawlDigest(
    val startUrl: String,
    val platform: String,
    val facts: SiteFacts,
    val pages: List<PageDigest>,
    val looksJsOnly: Boolean,
)

class Crawler(
    private val fetcher: Fetcher,
    private val budgetMillis: Long = 90_000,
    private val pageCap: Int = 15,
) {
    suspend fun crawl(startUrl: String): CrawlDigest {
        val uri = URI(startUrl)
        val origin = "${uri.scheme}://${uri.host}" + if (uri.port != -1) ":${uri.port}" else ""

        val home = fetcher.fetch(startUrl)
            ?: throw AppException(HttpStatusCode.BadGateway, "site_unreachable", "We couldn't reach your site. Make sure it is online, then try again.")
        if (home.status >= 400) {
            throw AppException(HttpStatusCode.BadGateway, "site_unreachable", "Your site answered with an error (HTTP ${home.status}). Try again later.")
        }

        val robotsTxt = fetcher.fetch("$origin/robots.txt")?.takeIf { it.status == 200 }?.body
        val sitemapXml = fetcher.fetch("$origin/sitemap.xml")?.takeIf { it.status == 200 }?.body
        val llmsPresent = fetcher.fetch("$origin/llms.txt")?.status == 200
        val robots = Robots.parse(robotsTxt)

        val urls = discoverUrls(startUrl, home.body, sitemapXml, pageCap)
            .filter { robots.allows(URI(it).rawPath?.takeIf(String::isNotEmpty) ?: "/") }

        val pages = mutableListOf<PageDigest>()
        withTimeoutOrNull(budgetMillis) {
            for (url in urls) {
                val res = if (url == startUrl) home else fetcher.fetch(url) ?: continue
                if (res.status != 200) continue
                pages.add(extractPageSignals(url, res.body))
            }
        }
        if (pages.isEmpty()) pages.add(extractPageSignals(startUrl, home.body))

        return CrawlDigest(
            startUrl = startUrl,
            platform = detectPlatform(home.body),
            facts = SiteFacts(
                https = startUrl.startsWith("https://"),
                robotsTxtPresent = robotsTxt != null,
                sitemapPresent = sitemapXml != null,
                llmsTxtPresent = llmsPresent,
            ),
            pages = pages,
            looksJsOnly = pages.count { it.looksJsOnly } * 2 > pages.size,
        )
    }
}
```

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): crawl orchestrator with robots filter, budget and site facts"
```

---

### Task 8: Claude model types, canned client, real client, prompts, schemas

**Files:**
- Modify: `backend/src/main/kotlin/app/geostrategy/claude/Model.kt` (extend past `Scores`)
- Create: `backend/src/main/kotlin/app/geostrategy/claude/CannedClaudeClient.kt`, `claude/RealClaudeClient.kt`
- Create: `backend/src/main/resources/prompts/analyze-system.txt`, `prompts/plan-system.txt`, `schemas/analysis.json`, `schemas/plan.json`
- Modify: `backend/build.gradle.kts` (add `implementation("com.anthropic:anthropic-java:2.34.0")`)
- Test: `backend/src/test/kotlin/app/geostrategy/claude/CannedClaudeClientTest.kt`

**Interfaces:**
- Consumes: `CrawlDigest`, `PageDigest`, `SiteFacts` (Task 7).
- Produces (all in `claude/Model.kt` unless stated):
  - `@Serializable data class Finding(val id: String, val category: String, val severity: String, val evidence: String, val affectedPages: List<String>)`
  - `@Serializable data class AnalysisResult(val scores: Scores, val findings: List<Finding>)`
  - `@Serializable data class PlanTaskGen(val title: String, val category: String, val impact: String, val effortMinutes: Int, val whyItMatters: String, val steps: List<String>, val doneCheck: String, val findingId: String? = null)`
  - `@Serializable data class PlanResult(val tasks: List<PlanTaskGen>)`
  - `data class ClaudeUsage(val inputTokens: Long, val outputTokens: Long)` with `operator fun plus` and `fun costUsd(): Double` ($5/M input + $25/M output)
  - `data class ClaudeResponse<T>(val value: T, val usage: ClaudeUsage)`
  - `interface ClaudeClient { suspend fun analyze(digest: CrawlDigest): ClaudeResponse<AnalysisResult>; suspend fun plan(analysis: AnalysisResult, platform: String): ClaudeResponse<PlanResult> }`
  - `fun digestToPromptText(d: CrawlDigest): String`
  - `class CannedClaudeClient : ClaudeClient` — deterministic; derives findings from the digest; zero usage.
  - `class RealClaudeClient(apiKey: String, model: String) : ClaudeClient` — Anthropic Java SDK; structured outputs; prompt caching on the system prompt.
- Tests never construct `RealClaudeClient` against the network. It is a thin adapter. The canned client covers the pipeline contract.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/claude/CannedClaudeClientTest.kt`:
```kotlin
package app.geostrategy.claude

import app.geostrategy.crawl.CrawlDigest
import app.geostrategy.crawl.PageDigest
import app.geostrategy.crawl.SiteFacts
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CannedClaudeClientTest {
    private fun page(url: String, meta: String?) = PageDigest(
        url = url, title = "T", metaDescription = meta, h1Count = 1, h2Count = 0,
        canonical = null, hasOgTags = false, jsonLdTypes = emptyList(), robotsMeta = null,
        imgCount = 0, imgWithAltCount = 0, wordCount = 200, internalLinkCount = 1,
        externalLinkCount = 0, looksJsOnly = false,
    )

    private val digest = CrawlDigest(
        startUrl = "https://example.com",
        platform = "wordpress",
        facts = SiteFacts(https = true, robotsTxtPresent = true, sitemapPresent = false, llmsTxtPresent = false),
        pages = listOf(page("https://example.com", null), page("https://example.com/menu", "Menu.")),
        looksJsOnly = false,
    )

    @Test
    fun `analyze derives stable findings and clamped scores`() = runBlocking {
        val client = CannedClaudeClient()
        val a = client.analyze(digest).value
        val ids = a.findings.map { it.id }
        assertTrue("missing-meta-description:/" in ids)
        assertTrue("missing-sitemap" in ids)
        assertTrue("missing-llms-txt" in ids)
        assertTrue("missing-structured-data" in ids)
        assertTrue(a.scores.seo in 5..100 && a.scores.aeo in 5..100 && a.scores.geo in 5..100)
        // deterministic
        assertEquals(a, client.analyze(digest).value)
    }

    @Test
    fun `plan links tasks to findings and uses platform steps`() = runBlocking {
        val client = CannedClaudeClient()
        val analysis = client.analyze(digest).value
        val plan = client.plan(analysis, "wordpress").value
        assertEquals(analysis.findings.size, plan.tasks.size)
        assertTrue(plan.tasks.all { it.findingId != null && analysis.findings.any { f -> f.id == it.findingId } })
        assertTrue(plan.tasks.all { it.steps.isNotEmpty() && it.whyItMatters.isNotBlank() && it.doneCheck.isNotBlank() })
        assertTrue(plan.tasks.any { task -> task.steps.first().contains("WordPress") })
    }

    @Test
    fun `usage cost math and schema resources are valid`() {
        val usage = ClaudeUsage(1_000_000, 100_000) + ClaudeUsage(0, 0)
        assertEquals(5.0 + 2.5, usage.costUsd())
        for (path in listOf("/schemas/analysis.json", "/schemas/plan.json")) {
            val schema = Json.parseToJsonElement(object {}.javaClass.getResource(path)!!.readText()).jsonObject
            assertEquals("object", schema["type"]!!.toString().trim('"'))
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.claude.CannedClaudeClientTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

Extend `backend/src/main/kotlin/app/geostrategy/claude/Model.kt` (keep `Scores`; add below it):
```kotlin
import app.geostrategy.crawl.CrawlDigest

@Serializable
data class Finding(val id: String, val category: String, val severity: String, val evidence: String, val affectedPages: List<String>)

@Serializable
data class AnalysisResult(val scores: Scores, val findings: List<Finding>)

@Serializable
data class PlanTaskGen(
    val title: String,
    val category: String,
    val impact: String,
    val effortMinutes: Int,
    val whyItMatters: String,
    val steps: List<String>,
    val doneCheck: String,
    val findingId: String? = null,
)

@Serializable
data class PlanResult(val tasks: List<PlanTaskGen>)

data class ClaudeUsage(val inputTokens: Long, val outputTokens: Long) {
    operator fun plus(other: ClaudeUsage) = ClaudeUsage(inputTokens + other.inputTokens, outputTokens + other.outputTokens)
    fun costUsd(): Double = inputTokens * 5.0 / 1_000_000 + outputTokens * 25.0 / 1_000_000
}

data class ClaudeResponse<T>(val value: T, val usage: ClaudeUsage)

interface ClaudeClient {
    suspend fun analyze(digest: CrawlDigest): ClaudeResponse<AnalysisResult>
    suspend fun plan(analysis: AnalysisResult, platform: String): ClaudeResponse<PlanResult>
}

fun digestToPromptText(d: CrawlDigest): String = buildString {
    appendLine("Site: ${d.startUrl}")
    appendLine("Platform: ${d.platform}")
    appendLine("HTTPS: ${d.facts.https}; robots.txt: ${d.facts.robotsTxtPresent}; sitemap.xml: ${d.facts.sitemapPresent}; llms.txt: ${d.facts.llmsTxtPresent}")
    appendLine("Pages (${d.pages.size}):")
    for (p in d.pages) {
        appendLine("- ${p.url}")
        appendLine("  title=${p.title ?: "MISSING"}; metaDescription=${p.metaDescription ?: "MISSING"}; h1=${p.h1Count}; h2=${p.h2Count}; canonical=${p.canonical ?: "none"}; og=${p.hasOgTags}; jsonLd=${p.jsonLdTypes}; robotsMeta=${p.robotsMeta ?: "none"}; words=${p.wordCount}; imgs=${p.imgCount} (alt ${p.imgWithAltCount}); links int=${p.internalLinkCount} ext=${p.externalLinkCount}")
    }
}
```

`backend/src/main/kotlin/app/geostrategy/claude/CannedClaudeClient.kt`:
```kotlin
package app.geostrategy.claude

import app.geostrategy.crawl.CrawlDigest
import java.net.URI

/**
 * Deterministic stand-in for the real Claude client. The app uses it when
 * ANTHROPIC_API_KEY is not set. Tests always use it.
 */
class CannedClaudeClient : ClaudeClient {
    private val zero = ClaudeUsage(0, 0)

    override suspend fun analyze(digest: CrawlDigest): ClaudeResponse<AnalysisResult> {
        val findings = mutableListOf<Finding>()
        fun path(url: String) = URI(url).rawPath?.takeIf { it.isNotEmpty() } ?: "/"

        for (p in digest.pages) {
            if (p.metaDescription == null) findings.add(Finding("missing-meta-description:${path(p.url)}", "seo", "high", "The page ${path(p.url)} has no meta description. Search engines show this text under your link.", listOf(p.url)))
            if (p.title == null) findings.add(Finding("missing-title:${path(p.url)}", "seo", "high", "The page ${path(p.url)} has no title tag.", listOf(p.url)))
            if (p.h1Count == 0) findings.add(Finding("missing-h1:${path(p.url)}", "seo", "medium", "The page ${path(p.url)} has no main heading (H1).", listOf(p.url)))
        }
        if (!digest.facts.sitemapPresent) findings.add(Finding("missing-sitemap", "seo", "medium", "Your site has no sitemap.xml. A sitemap helps search engines find your pages.", listOf(digest.startUrl)))
        if (!digest.facts.llmsTxtPresent) findings.add(Finding("missing-llms-txt", "geo", "low", "Your site has no llms.txt. This file tells AI assistants what your site is about.", listOf(digest.startUrl)))
        if (digest.pages.none { it.jsonLdTypes.isNotEmpty() }) findings.add(Finding("missing-structured-data", "aeo", "high", "No page has structured data (schema.org). Answer engines use it to understand your business.", listOf(digest.startUrl)))
        val totalImgs = digest.pages.sumOf { it.imgCount }
        if (totalImgs > 0 && digest.pages.sumOf { it.imgWithAltCount } * 2 < totalImgs) {
            findings.add(Finding("missing-alt-text", "seo", "low", "More than half of your images have no alt text.", digest.pages.filter { it.imgCount > it.imgWithAltCount }.map { it.url }))
        }

        fun clamp(v: Int) = v.coerceIn(5, 100)
        val scores = Scores(
            seo = clamp(95 - 12 * findings.count { it.category == "seo" }),
            aeo = clamp(90 - 15 * findings.count { it.category == "aeo" }),
            geo = clamp(90 - 20 * findings.count { it.category == "geo" }),
        )
        return ClaudeResponse(AnalysisResult(scores, findings), zero)
    }

    override suspend fun plan(analysis: AnalysisResult, platform: String): ClaudeResponse<PlanResult> {
        val firstStep = when (platform) {
            "wordpress" -> "Log in to your WordPress admin (usually yoursite.com/wp-admin)."
            "wix" -> "Log in to Wix and open your site's dashboard."
            "squarespace" -> "Log in to Squarespace and open your site."
            "shopify" -> "Log in to your Shopify admin."
            "webflow" -> "Log in to Webflow and open your project."
            else -> "Open the folder or tool you use to edit your website."
        }
        val tasks = analysis.findings.take(20).map { f ->
            PlanTaskGen(
                title = "Fix: ${f.id.substringBefore(':').replace('-', ' ')}",
                category = f.category,
                impact = f.severity,
                effortMinutes = if (f.severity == "high") 30 else 15,
                whyItMatters = f.evidence,
                steps = listOf(firstStep, "Make this change: ${f.evidence}", "Save and publish your site."),
                doneCheck = "Run a new assessment. This item should disappear from the list.",
                findingId = f.id,
            )
        }
        return ClaudeResponse(PlanResult(tasks), zero)
    }
}
```

`backend/src/main/resources/schemas/analysis.json`:
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["scores", "findings"],
  "properties": {
    "scores": {
      "type": "object",
      "additionalProperties": false,
      "required": ["seo", "aeo", "geo"],
      "properties": {
        "seo": { "type": "integer" },
        "aeo": { "type": "integer" },
        "geo": { "type": "integer" }
      }
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "category", "severity", "evidence", "affectedPages"],
        "properties": {
          "id": { "type": "string" },
          "category": { "type": "string", "enum": ["seo", "aeo", "geo"] },
          "severity": { "type": "string", "enum": ["high", "medium", "low"] },
          "evidence": { "type": "string" },
          "affectedPages": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  }
}
```

`backend/src/main/resources/schemas/plan.json`:
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["tasks"],
  "properties": {
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "category", "impact", "effortMinutes", "whyItMatters", "steps", "doneCheck", "findingId"],
        "properties": {
          "title": { "type": "string" },
          "category": { "type": "string", "enum": ["seo", "aeo", "geo"] },
          "impact": { "type": "string", "enum": ["high", "medium", "low"] },
          "effortMinutes": { "type": "integer" },
          "whyItMatters": { "type": "string" },
          "steps": { "type": "array", "items": { "type": "string" } },
          "doneCheck": { "type": "string" },
          "findingId": { "type": ["string", "null"] }
        }
      }
    }
  }
}
```

`backend/src/main/resources/prompts/analyze-system.txt`:
```
You are the assessment engine of GeoStrategy. You examine a website crawl digest.
You score the site for SEO (search engines), AEO (answer engines), and GEO (generative AI engines).
You return JSON that matches the given schema. Do not return anything else.

Rules:
- Score each area from 0 to 100. Be honest. A site with many problems must get a low score.
- Create one finding for each real problem you see in the digest.
- Give each finding a stable id in kebab-case. Format: "<problem>:<page-path>" for page problems, "<problem>" for site problems. Use the same id for the same problem every time.
- Set category to seo, aeo, or geo. Set severity to high, medium, or low.
- Write the evidence for a person with no technical skill. Use short sentences. Explain each term you use.
- List the affected page URLs in affectedPages.
```

`backend/src/main/resources/prompts/plan-system.txt`:
```
You are the plan writer of GeoStrategy. You turn findings into a step-by-step action plan.
The reader is a site owner with no software skill. Think of a smart 10-year-old.
You return JSON that matches the given schema. Do not return anything else.

Rules:
- Create one task for each finding. Copy the finding id into findingId.
- Order tasks from the highest impact to the lowest impact.
- Write a short title that starts with a verb.
- In whyItMatters, explain the benefit in plain words. Use short sentences. No jargon.
- In steps, give one action per step. Tell the reader where to click for their platform.
- The platform is given in the user message. Use its real menu names.
- In doneCheck, tell the reader how they can see that the fix worked.
- Set effortMinutes to a realistic estimate.
```

`backend/src/main/kotlin/app/geostrategy/claude/RealClaudeClient.kt`:
```kotlin
package app.geostrategy.claude

import app.geostrategy.crawl.CrawlDigest
import com.anthropic.client.AnthropicClient
import com.anthropic.client.okhttp.AnthropicOkHttpClient
import com.anthropic.core.JsonValue
import com.anthropic.models.messages.CacheControlEphemeral
import com.anthropic.models.messages.JsonOutputFormat
import com.anthropic.models.messages.MessageCreateParams
import com.anthropic.models.messages.OutputConfig
import com.anthropic.models.messages.TextBlockParam
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

private val json = Json { ignoreUnknownKeys = true }

/**
 * Thin adapter over the official Anthropic Java SDK. Uses structured outputs
 * (output_config.format = json_schema) so responses always parse.
 * Not covered by unit tests: it makes network calls. The canned client covers
 * the ClaudeClient contract.
 */
class RealClaudeClient(apiKey: String, private val model: String) : ClaudeClient {
    private val client: AnthropicClient = AnthropicOkHttpClient.builder().apiKey(apiKey).build()
    private val analysisSchema = loadSchema("/schemas/analysis.json")
    private val planSchema = loadSchema("/schemas/plan.json")
    private val analyzeSystem = loadResource("/prompts/analyze-system.txt")
    private val planSystem = loadResource("/prompts/plan-system.txt")

    override suspend fun analyze(digest: CrawlDigest): ClaudeResponse<AnalysisResult> {
        val (text, usage) = complete(analyzeSystem, digestToPromptText(digest), analysisSchema)
        return ClaudeResponse(json.decodeFromString<AnalysisResult>(text), usage)
    }

    override suspend fun plan(analysis: AnalysisResult, platform: String): ClaudeResponse<PlanResult> {
        val user = "Platform: $platform\n\nFindings JSON:\n" + json.encodeToString(AnalysisResult.serializer(), analysis)
        val (text, usage) = complete(planSystem, user, planSchema)
        return ClaudeResponse(json.decodeFromString<PlanResult>(text), usage)
    }

    private suspend fun complete(system: String, user: String, schema: Any): Pair<String, ClaudeUsage> =
        withContext(Dispatchers.IO) {
            val params = MessageCreateParams.builder()
                .model(model)
                .maxTokens(16000L)
                .systemOfTextBlockParams(
                    listOf(
                        TextBlockParam.builder()
                            .text(system)
                            .cacheControl(CacheControlEphemeral.builder().build())
                            .build(),
                    ),
                )
                .outputConfig(
                    OutputConfig.builder()
                        .format(JsonOutputFormat.builder().schema(JsonValue.from(schema)).build())
                        .build(),
                )
                .addUserMessage(user)
                .build()
            val res = client.messages().create(params)
            val text = res.content().joinToString("") { block -> block.text().map { it.text() }.orElse("") }
            text to ClaudeUsage(res.usage().inputTokens(), res.usage().outputTokens())
        }

    private fun loadResource(path: String): String = javaClass.getResource(path)!!.readText()
    private fun loadSchema(path: String): Any = Json.parseToJsonElement(loadResource(path)).toJava()!!
}

internal fun JsonElement.toJava(): Any? = when (this) {
    is JsonNull -> null
    is JsonPrimitive -> if (isString) content else booleanOrNull ?: longOrNull ?: doubleOrNull ?: content
    is JsonArray -> map { it.toJava() }
    is JsonObject -> entries.associate { it.key to it.value.toJava() }
}
```
Implementer note: the Anthropic Java SDK builder method names above follow the SDK docs. If one name does not compile (for example `JsonOutputFormat.builder().schema(...)`), find the exact name with `javap` on the SDK jar and adjust. The wire shape must stay: `output_config.format` = JSON schema, cached system block, `max_tokens` 16000. Do not change the `ClaudeClient` interface.

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): Claude client interface with canned fake and real SDK adapter"
```

---

### Task 9: Assessment model, submission, SSE progress, resend verification

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/assessment/Assessment.kt`, `assessment/AssessmentRoutes.kt`
- Modify: `auth/AuthRoutes.kt` (add `POST /v1/auth/resend-verification`)
- Modify: `AppDeps.kt` (+ `assessments: AssessmentRepository`, + `ssrf: SsrfGuard`), `Application.kt` (`main()` + routing `assessmentRoutes(deps)`), `TestSupport.kt` (`testDeps` gains `ssrf` with a public-IP fake resolver; add `registerVerifyLogin` helper)
- Test: `backend/src/test/kotlin/app/geostrategy/assessment/AssessmentRoutesTest.kt`

**Interfaces:**
- Consumes: Tasks 1–3, 7–8 types; Plan 1 auth and email.
- Produces:
  - `data class Assessment(@BsonId val id: ObjectId = ObjectId(), val siteId: ObjectId, val userId: ObjectId, val status: String = "queued", val crawlDigest: CrawlDigest? = null, val scores: Scores? = null, val findings: List<Finding> = emptyList(), val errorCode: String? = null, val errorMessage: String? = null, val inputTokens: Long = 0, val outputTokens: Long = 0, val costUsd: Double = 0.0, val createdAt: Instant, val updatedAt: Instant, val completedAt: Instant? = null)`
  - `class AssessmentRepository(db)`: `insert`, `findById`, `listFor(siteId)` (newest first), `countNonFailedForUserSince(userId, since): Long`, `anyNonFailedFor(siteId): Boolean`, `setStatus`, `saveCrawl(id, digest)`, `saveAnalysis(id, analysis)`, `markReady(id, usage: ClaudeUsage)` (sets tokens, `costUsd`, `completedAt`), `markFailed(id, code, message)` (sets `completedAt`).
  - Routes: `POST /v1/sites/{siteId}/assessments` → 202 `AssessmentDto`; 403 `email_not_verified` when the user has not confirmed their email; 403 `quota_exceeded` at the monthly cap; `GET /v1/assessments/{id}` → `AssessmentDto`; `GET /v1/assessments/{id}/events` → SSE stream of `data: {"status":"<status>"}` lines until a terminal status.
  - `@Serializable data class AssessmentDto(val id: String, val siteId: String, val status: String, val scores: Scores?, val findings: List<Finding>, val errorCode: String?, val errorMessage: String?, val createdAt: String, val completedAt: String?)`
  - `POST /v1/auth/resend-verification` → 202; sends a new verification email when the account is not verified; does nothing otherwise.
  - Test helper `suspend fun registerVerifyLogin(http, emails: RecordingEmailSender, email: String, password: String = "correct-horse")` in `TestSupport.kt`.
- Quota rule: count assessments with `status != "failed"` created in the last 30 days. Compare against `tierLimits.assessmentsPerMonthFor(tier)`. A failed assessment does not count.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/assessment/AssessmentRoutesTest.kt`:
```kotlin
package app.geostrategy.assessment

import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
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
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class AssessmentRoutesTest {
    private suspend fun createSite(http: io.ktor.client.HttpClient): String {
        val res = http.post("/v1/sites") {
            contentType(ContentType.Application.Json)
            setBody("""{"url":"example.com"}""")
        }
        return Json.parseToJsonElement(res.bodyAsText()).jsonObject["id"]!!.jsonPrimitive.content
    }

    @Test
    fun `submission needs a verified email`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val siteId = createSite(http)
        val res = http.post("/v1/sites/$siteId/assessments")
        assertEquals(HttpStatusCode.Forbidden, res.status)
        assertTrue(res.bodyAsText().contains("email_not_verified"))
    }

    @Test
    fun `verified user submits, gets 202, job is queued, second submit hits quota`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = createSite(http)

        val res = http.post("/v1/sites/$siteId/assessments")
        assertEquals(HttpStatusCode.Accepted, res.status)
        assertEquals("queued", Json.parseToJsonElement(res.bodyAsText()).jsonObject["status"]!!.jsonPrimitive.content)
        assertNotNull(runBlocking { deps.jobs.claim() })

        val second = http.post("/v1/sites/$siteId/assessments")
        assertEquals(HttpStatusCode.Forbidden, second.status)
        assertTrue(second.bodyAsText().contains("quota_exceeded"))
    }

    @Test
    fun `sse stream reports a terminal status`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = createSite(http)
        val id = Json.parseToJsonElement(
            http.post("/v1/sites/$siteId/assessments").bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content

        runBlocking { deps.assessments.markFailed(org.bson.types.ObjectId(id), "js_only_site", "We can't read this site.") }
        val events = http.get("/v1/assessments/$id/events")
        assertTrue(events.bodyAsText().contains("\"status\":\"failed\""))
    }

    @Test
    fun `resend verification issues a fresh working token`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        application { appModule(testDeps(db, email = emails)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        assertEquals(HttpStatusCode.Accepted, http.post("/v1/auth/resend-verification").status)
        assertEquals(2, emails.sent.size)
        val token = app.geostrategy.extractToken(emails.sent.last().html)
        val verify = http.post("/v1/auth/verify-email") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"$token"}""")
        }
        assertEquals(HttpStatusCode.OK, verify.status)
    }

    @Test
    fun `assessment access is owner-only`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val ada = createClient { install(HttpCookies) }
        registerVerifyLogin(ada, emails, "ada@example.com")
        val siteId = createSite(ada)
        val id = Json.parseToJsonElement(ada.post("/v1/sites/$siteId/assessments").bodyAsText()).jsonObject["id"]!!.jsonPrimitive.content

        val bob = createClient { install(HttpCookies) }
        registerVerifyLogin(bob, emails, "bob@example.com")
        assertEquals(HttpStatusCode.NotFound, bob.get("/v1/assessments/$id").status)
    }
}
```

Add to `TestSupport.kt`:
```kotlin
suspend fun registerVerifyLogin(
    http: io.ktor.client.HttpClient,
    emails: RecordingEmailSender,
    email: String,
    password: String = "correct-horse",
) {
    registerAndLogin(http, email, password)
    val token = extractToken(emails.sent.last().html)
    http.post("/v1/auth/verify-email") {
        io.ktor.http.contentType(io.ktor.http.ContentType.Application.Json)
        io.ktor.client.request.setBody("""{"token":"$token"}""")
    }
}
```
Also change `testDeps` to build `ssrf = SsrfGuard { listOf(java.net.InetAddress.getByName("93.184.216.34")) }` and `assessments = AssessmentRepository(db)`. (Imports at top.)

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.assessment.AssessmentRoutesTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/app/geostrategy/assessment/Assessment.kt`:
```kotlin
package app.geostrategy.assessment

import app.geostrategy.claude.AnalysisResult
import app.geostrategy.claude.ClaudeUsage
import app.geostrategy.claude.Finding
import app.geostrategy.claude.Scores
import app.geostrategy.crawl.CrawlDigest
import com.mongodb.client.model.Filters.and
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Filters.gte
import com.mongodb.client.model.Filters.ne
import com.mongodb.client.model.Sorts
import com.mongodb.client.model.Updates.combine
import com.mongodb.client.model.Updates.set
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.toList
import org.bson.codecs.pojo.annotations.BsonId
import org.bson.types.ObjectId
import java.time.Instant

data class Assessment(
    @BsonId val id: ObjectId = ObjectId(),
    val siteId: ObjectId,
    val userId: ObjectId,
    val status: String = "queued",
    val crawlDigest: CrawlDigest? = null,
    val scores: Scores? = null,
    val findings: List<Finding> = emptyList(),
    val errorCode: String? = null,
    val errorMessage: String? = null,
    val inputTokens: Long = 0,
    val outputTokens: Long = 0,
    val costUsd: Double = 0.0,
    val createdAt: Instant,
    val updatedAt: Instant,
    val completedAt: Instant? = null,
)

val TERMINAL_STATUSES = setOf("ready", "failed")

class AssessmentRepository(db: MongoDatabase) {
    private val col = db.getCollection<Assessment>("assessments")

    suspend fun insert(a: Assessment): Assessment { col.insertOne(a); return a }

    suspend fun findById(id: ObjectId): Assessment? = col.find(eq("_id", id)).firstOrNull()

    suspend fun listFor(siteId: ObjectId): List<Assessment> =
        col.find(eq("siteId", siteId)).sort(Sorts.descending("createdAt")).toList()

    suspend fun countNonFailedForUserSince(userId: ObjectId, since: Instant): Long =
        col.countDocuments(and(eq("userId", userId), ne("status", "failed"), gte("createdAt", since)))

    suspend fun anyNonFailedFor(siteId: ObjectId): Boolean =
        col.find(and(eq("siteId", siteId), ne("status", "failed"))).firstOrNull() != null

    suspend fun setStatus(id: ObjectId, status: String) {
        col.updateOne(eq("_id", id), combine(set("status", status), set("updatedAt", Instant.now())))
    }

    suspend fun saveCrawl(id: ObjectId, digest: CrawlDigest) {
        col.updateOne(eq("_id", id), combine(set("crawlDigest", digest), set("updatedAt", Instant.now())))
    }

    suspend fun saveAnalysis(id: ObjectId, analysis: AnalysisResult) {
        col.updateOne(
            eq("_id", id),
            combine(set("scores", analysis.scores), set("findings", analysis.findings), set("updatedAt", Instant.now())),
        )
    }

    suspend fun markReady(id: ObjectId, usage: ClaudeUsage) {
        val now = Instant.now()
        col.updateOne(
            eq("_id", id),
            combine(
                set("status", "ready"),
                set("inputTokens", usage.inputTokens),
                set("outputTokens", usage.outputTokens),
                set("costUsd", usage.costUsd()),
                set("completedAt", now),
                set("updatedAt", now),
            ),
        )
    }

    suspend fun markFailed(id: ObjectId, code: String, message: String) {
        val now = Instant.now()
        col.updateOne(
            eq("_id", id),
            combine(set("status", "failed"), set("errorCode", code), set("errorMessage", message), set("completedAt", now), set("updatedAt", now)),
        )
    }
}
```

`backend/src/main/kotlin/app/geostrategy/assessment/AssessmentRoutes.kt`:
```kotlin
package app.geostrategy.assessment

import app.geostrategy.AppDeps
import app.geostrategy.auth.requireUser
import app.geostrategy.claude.Finding
import app.geostrategy.claude.Scores
import app.geostrategy.http.AppException
import io.ktor.http.CacheControl
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.response.cacheControl
import io.ktor.server.response.respond
import io.ktor.server.response.respondTextWriter
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable
import org.bson.Document
import org.bson.types.ObjectId
import java.time.Duration
import java.time.Instant

@Serializable
data class AssessmentDto(
    val id: String,
    val siteId: String,
    val status: String,
    val scores: Scores?,
    val findings: List<Finding>,
    val errorCode: String?,
    val errorMessage: String?,
    val createdAt: String,
    val completedAt: String?,
)

fun Assessment.toDto() = AssessmentDto(
    id = id.toHexString(), siteId = siteId.toHexString(), status = status, scores = scores,
    findings = findings, errorCode = errorCode, errorMessage = errorMessage,
    createdAt = createdAt.toString(), completedAt = completedAt?.toString(),
)

fun Route.assessmentRoutes(deps: AppDeps) {
    post("/v1/sites/{siteId}/assessments") {
        val user = call.requireUser(deps)
        if (!user.emailVerified) {
            throw AppException(HttpStatusCode.Forbidden, "email_not_verified", "Please confirm your email first. Check your inbox for the link, or ask for a new one in your account settings.")
        }
        val site = deps.sites.findById(call.parameters["siteId"]!!.toObjectIdOr404())
            ?.takeIf { it.userId == user.id }
            ?: throw AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that site.")

        val limit = deps.config.tierLimits.assessmentsPerMonthFor(user.tier)
        val used = deps.assessments.countNonFailedForUserSince(user.id, Instant.now().minus(Duration.ofDays(30)))
        if (used >= limit) {
            val noun = if (limit == 1) "assessment" else "assessments"
            throw AppException(HttpStatusCode.Forbidden, "quota_exceeded", "You've used your $limit $noun for this month. Upgrade for more.")
        }

        deps.ssrf.check(site.domain)

        val now = Instant.now()
        val assessment = deps.assessments.insert(Assessment(siteId = site.id, userId = user.id, createdAt = now, updatedAt = now))
        deps.jobs.enqueue("assessment", Document("assessmentId", assessment.id))
        call.respond(HttpStatusCode.Accepted, assessment.toDto())
    }

    get("/v1/assessments/{id}") {
        val user = call.requireUser(deps)
        val a = deps.assessments.findById(call.parameters["id"]!!.toObjectIdOr404())
            ?.takeIf { it.userId == user.id }
            ?: throw AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that assessment.")
        call.respond(a.toDto())
    }

    get("/v1/assessments/{id}/events") {
        val user = call.requireUser(deps)
        val id = call.parameters["id"]!!.toObjectIdOr404()
        deps.assessments.findById(id)?.takeIf { it.userId == user.id }
            ?: throw AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that assessment.")
        call.response.cacheControl(CacheControl.NoCache(null))
        call.respondTextWriter(contentType = ContentType.Text.EventStream) {
            var last: String? = null
            while (true) {
                val current = deps.assessments.findById(id) ?: break
                if (current.status != last) {
                    write("data: {\"status\":\"${current.status}\"}\n\n")
                    flush()
                    last = current.status
                }
                if (current.status in TERMINAL_STATUSES) break
                delay(1000)
            }
        }
    }
}
```
Note: `countNonFailedForUserSince` returns `Long`. Compare with `used >= limit` after `val limit = …` — Kotlin compares `Long >= Int` directly.

Add to `auth/AuthRoutes.kt` inside `authRoutes(deps)`:
```kotlin
    post("/v1/auth/resend-verification") {
        val user = call.requireUser(deps)
        if (!user.emailVerified) {
            val token = deps.tokens.issue(user.id, TokenPurpose.VERIFY_EMAIL, Duration.ofHours(24))
            deps.emailSender.send(user.email, "Confirm your GeoStrategy email", verifyEmailHtml(deps.config.appUrl, token))
        }
        call.respond(HttpStatusCode.Accepted, OkResponse())
    }
```

Wiring: `AppDeps` gains `val assessments: AssessmentRepository` and `val ssrf: SsrfGuard`; `main()` passes `AssessmentRepository(db)` and `SsrfGuard()`; routing adds `assessmentRoutes(deps)`.

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): assessment submission with quotas, SSE progress and resend-verification"
```

---

### Task 10: Plan storage + assessment pipeline + worker wiring

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/plans/Plans.kt`, `backend/src/main/kotlin/app/geostrategy/assessment/AssessmentPipeline.kt`
- Modify: `AppDeps.kt` (+ `plans: PlanRepository`), `Application.kt` (`main()`: build `HttpFetcher`, `Crawler`, Claude client selection, `AssessmentPipeline`, start `JobWorker`), `TestSupport.kt` (`testDeps` gains `plans`)
- Test: `backend/src/test/kotlin/app/geostrategy/assessment/AssessmentPipelineTest.kt`

**Interfaces:**
- Consumes: Tasks 3, 7, 8, 9.
- Produces:
  - `data class PlanTask(val taskId: String, val title: String, val category: String, val impact: String, val effortMinutes: Int, val whyItMatters: String, val steps: List<String>, val doneCheck: String, val findingId: String?, val status: String = "todo", val completedAt: Instant? = null)`
  - `data class PlanDoc(@BsonId val id: ObjectId = ObjectId(), val assessmentId: ObjectId, val siteId: ObjectId, val userId: ObjectId, val tasks: List<PlanTask>, val createdAt: Instant, val updatedAt: Instant)`
  - `class PlanRepository(db)`: `insert`, `findById`, `findByAssessment(assessmentId)`, `latestFor(siteId)`.
  - `fun buildPlanDoc(assessment: Assessment, result: PlanResult): PlanDoc` — orders tasks high→medium→low; `taskId = ObjectId().toHexString()`.
  - `class AssessmentPipeline(assessments, sites, plans, crawler, claude, maxJobAttempts: Int = 2)` with `suspend fun handle(job: Job)`. Behavior: checkpointed stages (`crawling` → save digest → `analyzing` → save analysis → `planning` → insert plan → update site → `markReady`). A JS-only site fails with `js_only_site` and a friendly message. An `AppException` fails the assessment and completes the job (no retry). Any other exception: mark failed only on the final attempt, then rethrow so the queue retries.
  - `main()` selects the Claude client: `RealClaudeClient` when `config.anthropicApiKey` is set, else `CannedClaudeClient` plus a WARN log line.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/assessment/AssessmentPipelineTest.kt`:
```kotlin
package app.geostrategy.assessment

import app.geostrategy.MapFetcher
import app.geostrategy.TestMongo
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.claude.AnalysisResult
import app.geostrategy.claude.ClaudeClient
import app.geostrategy.claude.ClaudeResponse
import app.geostrategy.claude.PlanResult
import app.geostrategy.crawl.Crawler
import app.geostrategy.crawl.CrawlDigest
import app.geostrategy.jobs.JobQueue
import app.geostrategy.plans.PlanRepository
import app.geostrategy.sites.Site
import app.geostrategy.sites.SiteRepository
import kotlinx.coroutines.runBlocking
import org.bson.Document
import org.bson.types.ObjectId
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class AssessmentPipelineTest {
    private val homeHtml = """
        <html><head><title>Ada's</title></head>
        <body><h1>Hi</h1><p>${"bread ".repeat(60)}</p></body></html>
    """

    private fun fixtures(db: com.mongodb.kotlin.client.coroutine.MongoDatabase) = object {
        val sites = SiteRepository(db)
        val assessments = AssessmentRepository(db)
        val plans = PlanRepository(db)
        val jobs = JobQueue(db)
        val now: Instant = Instant.now()
        val site = runBlocking {
            sites.insert(Site(userId = ObjectId(), domain = "example.com", url = "https://example.com", createdAt = now, updatedAt = now))
        }
        val assessment = runBlocking {
            assessments.insert(Assessment(siteId = site.id, userId = site.userId, createdAt = now, updatedAt = now))
        }
    }

    @Test
    fun `happy path produces ready assessment, plan and site scores`() = runBlocking {
        val db = TestMongo.freshDb()
        val f = fixtures(db)
        val crawler = Crawler(MapFetcher(mapOf("https://example.com" to homeHtml)))
        val pipeline = AssessmentPipeline(f.assessments, f.sites, f.plans, crawler, CannedClaudeClient())
        f.jobs.enqueue("assessment", Document("assessmentId", f.assessment.id))
        pipeline.handle(f.jobs.claim()!!)

        val done = f.assessments.findById(f.assessment.id)!!
        assertEquals("ready", done.status)
        assertNotNull(done.scores)
        assertNotNull(done.completedAt)
        val plan = f.plans.findByAssessment(f.assessment.id)!!
        assertTrue(plan.tasks.isNotEmpty())
        assertTrue(plan.tasks.all { it.status == "todo" && it.taskId.isNotBlank() })
        assertEquals(done.scores, f.sites.findById(f.site.id)!!.latestScores)
    }

    @Test
    fun `retry after analyze crash resumes from saved crawl digest`() = runBlocking {
        val db = TestMongo.freshDb()
        val f = fixtures(db)
        var fetches = 0
        val countingFetcher = object : app.geostrategy.crawl.Fetcher {
            val inner = MapFetcher(mapOf("https://example.com" to homeHtml))
            override suspend fun fetch(url: String): app.geostrategy.crawl.FetchResult? {
                if (url == "https://example.com") fetches++
                return inner.fetch(url)
            }
        }
        var analyzeCalls = 0
        val flakyClaude = object : ClaudeClient {
            val real = CannedClaudeClient()
            override suspend fun analyze(digest: CrawlDigest): ClaudeResponse<AnalysisResult> {
                analyzeCalls++
                if (analyzeCalls == 1) error("transient claude outage")
                return real.analyze(digest)
            }
            override suspend fun plan(analysis: AnalysisResult, platform: String) = real.plan(analysis, platform)
        }
        val pipeline = AssessmentPipeline(f.assessments, f.sites, f.plans, Crawler(countingFetcher), flakyClaude)
        f.jobs.enqueue("assessment", Document("assessmentId", f.assessment.id))

        assertFailsWith<IllegalStateException> { pipeline.handle(f.jobs.claim()!!) }
        // the queue-level retry is covered by JobWorker tests; here we hand the pipeline a fresh job
        f.jobs.enqueue("assessment", Document("assessmentId", f.assessment.id))
        pipeline.handle(f.jobs.claim()!!)

        assertEquals("ready", f.assessments.findById(f.assessment.id)!!.status)
        assertEquals(1, fetches)  // crawl checkpoint prevented a second homepage fetch
    }

    @Test
    fun `js-only site fails with a friendly reason and does not retry`() = runBlocking {
        val db = TestMongo.freshDb()
        val f = fixtures(db)
        val shell = """<html><body><div id="root"></div><script src="a.js"></script></body></html>"""
        val pipeline = AssessmentPipeline(
            f.assessments, f.sites, f.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to shell))), CannedClaudeClient(),
        )
        f.jobs.enqueue("assessment", Document("assessmentId", f.assessment.id))
        pipeline.handle(f.jobs.claim()!!)  // must not throw
        val failed = f.assessments.findById(f.assessment.id)!!
        assertEquals("failed", failed.status)
        assertEquals("js_only_site", failed.errorCode)
    }
}
```
Intent of the middle test: the first `handle` throws in the analyze stage. The second `handle` gets a fresh job and succeeds. The saved crawl digest prevents a second homepage fetch.

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.assessment.AssessmentPipelineTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/app/geostrategy/plans/Plans.kt`:
```kotlin
package app.geostrategy.plans

import app.geostrategy.assessment.Assessment
import app.geostrategy.claude.PlanResult
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Sorts
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import kotlinx.coroutines.flow.firstOrNull
import org.bson.codecs.pojo.annotations.BsonId
import org.bson.types.ObjectId
import java.time.Instant

data class PlanTask(
    val taskId: String,
    val title: String,
    val category: String,
    val impact: String,
    val effortMinutes: Int,
    val whyItMatters: String,
    val steps: List<String>,
    val doneCheck: String,
    val findingId: String?,
    val status: String = "todo",
    val completedAt: Instant? = null,
)

data class PlanDoc(
    @BsonId val id: ObjectId = ObjectId(),
    val assessmentId: ObjectId,
    val siteId: ObjectId,
    val userId: ObjectId,
    val tasks: List<PlanTask>,
    val createdAt: Instant,
    val updatedAt: Instant,
)

private val IMPACT_ORDER = mapOf("high" to 0, "medium" to 1, "low" to 2)

fun buildPlanDoc(assessment: Assessment, result: PlanResult): PlanDoc {
    val now = Instant.now()
    val tasks = result.tasks
        .sortedBy { IMPACT_ORDER[it.impact] ?: 3 }
        .map {
            PlanTask(
                taskId = ObjectId().toHexString(),
                title = it.title, category = it.category, impact = it.impact,
                effortMinutes = it.effortMinutes, whyItMatters = it.whyItMatters,
                steps = it.steps, doneCheck = it.doneCheck, findingId = it.findingId,
            )
        }
    return PlanDoc(
        assessmentId = assessment.id, siteId = assessment.siteId, userId = assessment.userId,
        tasks = tasks, createdAt = now, updatedAt = now,
    )
}

class PlanRepository(db: MongoDatabase) {
    private val col = db.getCollection<PlanDoc>("plans")

    suspend fun insert(doc: PlanDoc): PlanDoc { col.insertOne(doc); return doc }
    suspend fun findById(id: ObjectId): PlanDoc? = col.find(eq("_id", id)).firstOrNull()
    suspend fun findByAssessment(assessmentId: ObjectId): PlanDoc? = col.find(eq("assessmentId", assessmentId)).firstOrNull()
    suspend fun latestFor(siteId: ObjectId): PlanDoc? =
        col.find(eq("siteId", siteId)).sort(Sorts.descending("createdAt")).firstOrNull()
}
```

`backend/src/main/kotlin/app/geostrategy/assessment/AssessmentPipeline.kt`:
```kotlin
package app.geostrategy.assessment

import app.geostrategy.claude.ClaudeClient
import app.geostrategy.crawl.Crawler
import app.geostrategy.http.AppException
import app.geostrategy.jobs.Job
import app.geostrategy.plans.PlanRepository
import app.geostrategy.plans.buildPlanDoc
import app.geostrategy.sites.SiteRepository
import org.slf4j.LoggerFactory

class AssessmentPipeline(
    private val assessments: AssessmentRepository,
    private val sites: SiteRepository,
    private val plans: PlanRepository,
    private val crawler: Crawler,
    private val claude: ClaudeClient,
    private val maxJobAttempts: Int = 2,
) {
    private val log = LoggerFactory.getLogger(AssessmentPipeline::class.java)

    suspend fun handle(job: Job) {
        val id = job.payload.getObjectId("assessmentId")
        val assessment = assessments.findById(id) ?: return
        if (assessment.status in TERMINAL_STATUSES) return
        val site = sites.findById(assessment.siteId) ?: return

        try {
            val digest = assessment.crawlDigest ?: run {
                assessments.setStatus(id, "crawling")
                val d = crawler.crawl(site.url)
                assessments.saveCrawl(id, d)
                d
            }
            if (digest.looksJsOnly) {
                assessments.markFailed(id, "js_only_site", "Your site needs JavaScript to show its content, so we can't read it yet. If you use a website builder, make sure your pages contain real text.")
                return
            }
            assessments.setStatus(id, "analyzing")
            val analysis = claude.analyze(digest)
            assessments.saveAnalysis(id, analysis.value)

            assessments.setStatus(id, "planning")
            val planResult = claude.plan(analysis.value, digest.platform)
            plans.insert(buildPlanDoc(assessment, planResult.value))

            sites.updateAfterAssessment(site.id, digest.platform, analysis.value.scores)
            assessments.markReady(id, analysis.usage + planResult.usage)
        } catch (e: AppException) {
            assessments.markFailed(id, e.code, e.message)
        } catch (e: Exception) {
            log.warn("assessment {} attempt {} failed: {}", id, job.attempts, e.message)
            if (job.attempts >= maxJobAttempts) {
                assessments.markFailed(id, "assessment_failed", "Something went wrong while we checked your site. Please try again.")
            }
            throw e
        }
    }
}
```

`main()` additions in `Application.kt` (after `deps` is built):
```kotlin
val claudeLog = LoggerFactory.getLogger("app.geostrategy.claude")
val claude: ClaudeClient = config.anthropicApiKey
    ?.let { RealClaudeClient(it, config.claudeModel) }
    ?: CannedClaudeClient().also {
        claudeLog.warn("ANTHROPIC_API_KEY is not set. Assessments use the canned Claude client.")
    }
val crawler = Crawler(HttpFetcher(httpClient))
val pipeline = AssessmentPipeline(deps.assessments, deps.sites, deps.plans, crawler, claude)
val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
JobWorker(deps.jobs, mapOf("assessment" to pipeline::handle)).start(appScope)
```
(Imports: `kotlinx.coroutines.CoroutineScope`, `kotlinx.coroutines.Dispatchers`, `kotlinx.coroutines.SupervisorJob`, `org.slf4j.LoggerFactory`, plus the new types.) `AppDeps` gains `val plans: PlanRepository`; `testDeps` adds `plans = PlanRepository(db)`.

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): checkpointed assessment pipeline with plan generation and worker wiring"
```

---

### Task 11: Plans API with task check-off

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/plans/PlanRoutes.kt`
- Modify: `plans/Plans.kt` (add `updateTaskStatus`), `Application.kt` (routing + `planRoutes(deps)`)
- Test: `backend/src/test/kotlin/app/geostrategy/plans/PlanRoutesTest.kt`

**Interfaces:**
- Consumes: Tasks 9–10; `registerVerifyLogin`.
- Produces:
  - `PlanRepository.updateTaskStatus(planId: ObjectId, taskId: String, status: String): PlanDoc?` — read-modify-write; sets `completedAt` when status becomes `done`; clears it for `todo`.
  - Routes: `GET /v1/assessments/{id}/plan`; `GET /v1/sites/{siteId}/plan` (latest); `PATCH /v1/plans/{planId}/tasks/{taskId}` body `{"status":"done"|"todo"}` → 200 `PlanDto`. Users cannot set `verified` (400 `invalid_status`). All routes are owner-only (404 otherwise).
  - `@Serializable data class PlanTaskDto(val taskId: String, val title: String, val category: String, val impact: String, val effortMinutes: Int, val whyItMatters: String, val steps: List<String>, val doneCheck: String, val status: String)`
  - `@Serializable data class PlanProgressDto(val done: Int, val verified: Int, val total: Int)`
  - `@Serializable data class PlanDto(val id: String, val assessmentId: String, val siteId: String, val tasks: List<PlanTaskDto>, val progress: PlanProgressDto)`

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/plans/PlanRoutesTest.kt`:
```kotlin
package app.geostrategy.plans

import app.geostrategy.MapFetcher
import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.assessment.AssessmentPipeline
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.crawl.Crawler
import app.geostrategy.registerVerifyLogin
import app.geostrategy.testDeps
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.client.request.patch
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

class PlanRoutesTest {
    private val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""

    @Test
    fun `full journey - submit, pipeline runs, read plan, check off a task`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")

        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") {
                contentType(ContentType.Application.Json)
                setBody("""{"url":"example.com"}""")
            }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        val assessmentId = Json.parseToJsonElement(
            http.post("/v1/sites/$siteId/assessments").bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content

        // run the pipeline inline against the queued job
        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to html))), CannedClaudeClient(),
        )
        runBlocking { pipeline.handle(deps.jobs.claim()!!) }

        val planBody = http.get("/v1/assessments/$assessmentId/plan").bodyAsText()
        val plan = Json.parseToJsonElement(planBody).jsonObject
        val planId = plan["id"]!!.jsonPrimitive.content
        val firstTask = plan["tasks"]!!.jsonArray.first().jsonObject["taskId"]!!.jsonPrimitive.content
        assertEquals(0, plan["progress"]!!.jsonObject["done"]!!.jsonPrimitive.content.toInt())

        val patched = http.patch("/v1/plans/$planId/tasks/$firstTask") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"done"}""")
        }
        assertEquals(HttpStatusCode.OK, patched.status)
        val progress = Json.parseToJsonElement(patched.bodyAsText()).jsonObject["progress"]!!.jsonObject
        assertEquals(1, progress["done"]!!.jsonPrimitive.content.toInt())

        // latest plan by site works too
        assertTrue(http.get("/v1/sites/$siteId/plan").bodyAsText().contains(planId))
    }

    @Test
    fun `verified is not settable by users`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") {
                contentType(ContentType.Application.Json)
                setBody("""{"url":"example.com"}""")
            }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        http.post("/v1/sites/$siteId/assessments")
        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to html))), CannedClaudeClient(),
        )
        runBlocking { pipeline.handle(deps.jobs.claim()!!) }
        val plan = runBlocking { deps.plans.latestFor(org.bson.types.ObjectId(siteId))!! }

        val res = http.patch("/v1/plans/${plan.id.toHexString()}/tasks/${plan.tasks.first().taskId}") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"verified"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertTrue(res.bodyAsText().contains("invalid_status"))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.plans.PlanRoutesTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

Add to `PlanRepository`:
```kotlin
    suspend fun updateTaskStatus(planId: ObjectId, taskId: String, status: String): PlanDoc? {
        val doc = findById(planId) ?: return null
        if (doc.tasks.none { it.taskId == taskId }) return null
        val now = Instant.now()
        val updated = doc.tasks.map {
            if (it.taskId == taskId) it.copy(status = status, completedAt = if (status == "done") now else null) else it
        }
        col.updateOne(eq("_id", planId), com.mongodb.client.model.Updates.combine(
            com.mongodb.client.model.Updates.set("tasks", updated),
            com.mongodb.client.model.Updates.set("updatedAt", now),
        ))
        return doc.copy(tasks = updated, updatedAt = now)
    }
```
(Move the `Updates` imports to the top of the file.)

`backend/src/main/kotlin/app/geostrategy/plans/PlanRoutes.kt`:
```kotlin
package app.geostrategy.plans

import app.geostrategy.AppDeps
import app.geostrategy.assessment.toObjectIdOr404
import app.geostrategy.auth.requireUser
import app.geostrategy.http.AppException
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.patch
import kotlinx.serialization.Serializable

@Serializable data class PlanTaskDto(val taskId: String, val title: String, val category: String, val impact: String, val effortMinutes: Int, val whyItMatters: String, val steps: List<String>, val doneCheck: String, val status: String)
@Serializable data class PlanProgressDto(val done: Int, val verified: Int, val total: Int)
@Serializable data class PlanDto(val id: String, val assessmentId: String, val siteId: String, val tasks: List<PlanTaskDto>, val progress: PlanProgressDto)
@Serializable data class TaskStatusRequest(val status: String)

fun PlanDoc.toDto(): PlanDto = PlanDto(
    id = id.toHexString(),
    assessmentId = assessmentId.toHexString(),
    siteId = siteId.toHexString(),
    tasks = tasks.map { PlanTaskDto(it.taskId, it.title, it.category, it.impact, it.effortMinutes, it.whyItMatters, it.steps, it.doneCheck, it.status) },
    progress = PlanProgressDto(
        done = tasks.count { it.status == "done" },
        verified = tasks.count { it.status == "verified" },
        total = tasks.size,
    ),
)

private val NOT_FOUND = { AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that plan.") }

fun Route.planRoutes(deps: AppDeps) {
    get("/v1/assessments/{id}/plan") {
        val user = call.requireUser(deps)
        val plan = deps.plans.findByAssessment(call.parameters["id"]!!.toObjectIdOr404())
            ?.takeIf { it.userId == user.id } ?: throw NOT_FOUND()
        call.respond(plan.toDto())
    }

    get("/v1/sites/{siteId}/plan") {
        val user = call.requireUser(deps)
        val plan = deps.plans.latestFor(call.parameters["siteId"]!!.toObjectIdOr404())
            ?.takeIf { it.userId == user.id } ?: throw NOT_FOUND()
        call.respond(plan.toDto())
    }

    patch("/v1/plans/{planId}/tasks/{taskId}") {
        val user = call.requireUser(deps)
        val body = call.receive<TaskStatusRequest>()
        if (body.status !in setOf("todo", "done")) {
            throw AppException(HttpStatusCode.BadRequest, "invalid_status", "A task can only be marked as done or todo.")
        }
        val planId = call.parameters["planId"]!!.toObjectIdOr404()
        deps.plans.findById(planId)?.takeIf { it.userId == user.id } ?: throw NOT_FOUND()
        val updated = deps.plans.updateTaskStatus(planId, call.parameters["taskId"]!!, body.status) ?: throw NOT_FOUND()
        call.respond(updated.toDto())
    }
}
```
Routing: add `planRoutes(deps)` in `appModule`.

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): plan retrieval and task check-off with progress"
```

---

### Task 12: Re-assessment gate, auto-verification, history, README

**Files:**
- Modify: `assessment/AssessmentRoutes.kt` (pro gate + history route), `assessment/AssessmentPipeline.kt` (auto-verify), `plans/Plans.kt` (add `markTasksVerified`), `backend/README.md` (env vars + engine notes, in ASD-STE100 style)
- Test: `backend/src/test/kotlin/app/geostrategy/assessment/ReassessmentTest.kt`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - Submission gate: a second assessment for the same site requires `tier == "pro"` → else 403 `upgrade_required` ("Re-checking your site is a Pro feature."). The gate runs before the quota check.
  - `PlanRepository.markTasksVerified(planId: ObjectId, taskIds: List<String>)` — sets `status = "verified"` on the named tasks.
  - Pipeline auto-verify: before it inserts the new plan, the pipeline loads `plans.latestFor(site.id)`. Tasks of the previous plan get `verified` when their `findingId` is absent from the new analysis findings and their status is not already `verified`.
  - `GET /v1/sites/{siteId}/assessments` → history list of `AssessmentDto` (newest first). Pro only → else 403 `upgrade_required`.
  - README gains a section for the assessment engine. Write it in ASD-STE100 style. List the new env vars: `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `FREE_MAX_SITES`, `FREE_ASSESSMENTS_PER_MONTH`, `PRO_MAX_SITES`, `PRO_ASSESSMENTS_PER_MONTH`.
  - Test helper: make a user pro by a direct collection update (code below).
  - **"Plan is ready" email (spec §2):** `AssessmentPipeline` gains optional constructor parameters `emailSender: EmailSender? = null` and `users: UserRepository? = null`. Defaults keep the Task 10–11 tests valid. After `markReady`, the pipeline sends "Your GeoStrategy plan is ready" to the owner when both parameters are set. `main()` passes both.
  - **Gate-order reconciliation:** the pro gate runs before the quota check. This changes one Task 9 assertion. Update `AssessmentRoutesTest`: rename the second test to `verified user submits, gets 202, job is queued, second submit needs pro` and change the second-submit assertion from `quota_exceeded` to `upgrade_required`. Add parameter `env: Map<String, String> = emptyMap()` to `testDeps` and pass it to `AppConfig.fromEnv(env)`. Add a pro-tier quota test with `PRO_ASSESSMENTS_PER_MONTH=1` (test code below).

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/assessment/ReassessmentTest.kt`:
```kotlin
package app.geostrategy.assessment

import app.geostrategy.MapFetcher
import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.crawl.Crawler
import app.geostrategy.plans.PlanRepository
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
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.bson.types.ObjectId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ReassessmentTest {
    private val pageNoMeta = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
    private val pageWithMeta = """<html><head><title>T</title><meta name="description" content="Now present."></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""

    private suspend fun makePro(db: com.mongodb.kotlin.client.coroutine.MongoDatabase, email: String) {
        db.getCollection<User>("users").updateOne(eq("email", email), set("tier", "pro"))
    }

    @Test
    fun `free user cannot re-assess, pro user can, history is pro-only`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content

        assertEquals(HttpStatusCode.Accepted, http.post("/v1/sites/$siteId/assessments").status)
        val again = http.post("/v1/sites/$siteId/assessments")
        assertEquals(HttpStatusCode.Forbidden, again.status)
        assertTrue(again.bodyAsText().contains("upgrade_required"))
        assertEquals(HttpStatusCode.Forbidden, http.get("/v1/sites/$siteId/assessments").status)

        runBlocking { makePro(db, "ada@example.com") }
        assertEquals(HttpStatusCode.Accepted, http.post("/v1/sites/$siteId/assessments").status)
        val history = http.get("/v1/sites/$siteId/assessments")
        assertEquals(HttpStatusCode.OK, history.status)
        assertTrue(history.bodyAsText().contains("queued"))
    }

    @Test
    fun `re-assessment auto-verifies fixed tasks in the previous plan`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        runBlocking { makePro(db, "ada@example.com") }
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        val siteOid = ObjectId(siteId)

        // run 1: page without meta description
        http.post("/v1/sites/$siteId/assessments")
        val run1 = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to pageNoMeta))), CannedClaudeClient(),
        )
        runBlocking { run1.handle(deps.jobs.claim()!!) }
        val firstPlan = runBlocking { deps.plans.latestFor(siteOid)!! }
        assertTrue(firstPlan.tasks.any { it.findingId == "missing-meta-description:/" && it.status == "todo" })

        // run 2: meta description fixed
        http.post("/v1/sites/$siteId/assessments")
        val run2 = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to pageWithMeta))), CannedClaudeClient(),
        )
        runBlocking { run2.handle(deps.jobs.claim()!!) }

        val verifiedPlan = runBlocking { PlanRepository(db).findById(firstPlan.id)!! }
        val fixedTask = verifiedPlan.tasks.first { it.findingId == "missing-meta-description:/" }
        assertEquals("verified", fixedTask.status)
        // a task whose finding still exists stays todo
        val stillOpen = verifiedPlan.tasks.first { it.findingId == "missing-llms-txt" }
        assertEquals("todo", stillOpen.status)
    }
}
```

Also add these two tests to `ReassessmentTest`:
```kotlin
    @Test
    fun `pro user hits the quota when the pro monthly limit is reached`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails, env = mapOf("PRO_ASSESSMENTS_PER_MONTH" to "1"))
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        runBlocking { makePro(db, "ada@example.com") }
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        assertEquals(HttpStatusCode.Accepted, http.post("/v1/sites/$siteId/assessments").status)
        val second = http.post("/v1/sites/$siteId/assessments")
        assertEquals(HttpStatusCode.Forbidden, second.status)
        assertTrue(second.bodyAsText().contains("quota_exceeded"))
    }

    @Test
    fun `ready assessment sends the plan-is-ready email`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        http.post("/v1/sites/$siteId/assessments")
        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to pageNoMeta))), CannedClaudeClient(),
            emailSender = deps.emailSender, users = app.geostrategy.users.UserRepository(db),
        )
        runBlocking { pipeline.handle(deps.jobs.claim()!!) }
        assertTrue(emails.sent.any { it.subject.contains("ready", ignoreCase = true) })
    }
```
(Use a normal import for `UserRepository`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.assessment.ReassessmentTest"`
Expected: FAIL — the pro gate, history route, auto-verify, and ready email do not exist yet.

- [ ] **Step 3: Implement**

In `AssessmentRoutes.kt`, insert after the site-ownership check and before the quota check:
```kotlin
        if (deps.assessments.anyNonFailedFor(site.id) && user.tier != "pro") {
            throw AppException(HttpStatusCode.Forbidden, "upgrade_required", "Re-checking your site is a Pro feature. Upgrade to track your progress over time.")
        }
```
Add the history route:
```kotlin
    get("/v1/sites/{siteId}/assessments") {
        val user = call.requireUser(deps)
        val site = deps.sites.findById(call.parameters["siteId"]!!.toObjectIdOr404())
            ?.takeIf { it.userId == user.id }
            ?: throw AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that site.")
        if (user.tier != "pro") {
            throw AppException(HttpStatusCode.Forbidden, "upgrade_required", "Score history is a Pro feature. Upgrade to see your progress over time.")
        }
        call.respond(AssessmentListResponse(deps.assessments.listFor(site.id).map { it.toDto() }))
    }
```
with `@Serializable data class AssessmentListResponse(val assessments: List<AssessmentDto>)` at file level.

Add to `PlanRepository`:
```kotlin
    suspend fun markTasksVerified(planId: ObjectId, taskIds: List<String>) {
        if (taskIds.isEmpty()) return
        val doc = findById(planId) ?: return
        val now = Instant.now()
        val updated = doc.tasks.map { if (it.taskId in taskIds) it.copy(status = "verified") else it }
        col.updateOne(eq("_id", planId), com.mongodb.client.model.Updates.combine(
            com.mongodb.client.model.Updates.set("tasks", updated),
            com.mongodb.client.model.Updates.set("updatedAt", now),
        ))
    }
```

In `AssessmentPipeline.handle`, after `assessments.saveAnalysis(id, analysis.value)` and before the `planning` stage:
```kotlin
            val previousPlan = plans.latestFor(site.id)
            if (previousPlan != null) {
                val openFindingIds = analysis.value.findings.map { it.id }.toSet()
                val fixed = previousPlan.tasks
                    .filter { it.findingId != null && it.findingId !in openFindingIds && it.status != "verified" }
                    .map { it.taskId }
                plans.markTasksVerified(previousPlan.id, fixed)
            }
```

Make these further changes:

1. `AssessmentPipeline` constructor gains `private val emailSender: EmailSender? = null, private val users: UserRepository? = null` (after `maxJobAttempts`, or before it — keep named arguments in `main()`). After `assessments.markReady(...)`, add:
```kotlin
            if (emailSender != null && users != null) {
                users.findById(assessment.userId)?.let { owner ->
                    emailSender.send(
                        owner.email,
                        "Your GeoStrategy plan is ready",
                        "<p>Good news! We finished checking your site.</p><p>Log in to see your scores and your step-by-step plan.</p>",
                    )
                }
            }
```
2. `main()` passes `emailSender = deps.emailSender, users = deps.users` when it builds the pipeline.
3. `testDeps` in `TestSupport.kt` gains `env: Map<String, String> = emptyMap()` and uses `AppConfig.fromEnv(env)`.
4. In `AssessmentRoutesTest`, rename the second test to `verified user submits, gets 202, job is queued, second submit needs pro` and change its final assertion to expect `upgrade_required`.

Append to `backend/README.md` (ASD-STE100 style):
```markdown
## Assessment engine

The engine crawls a site, then asks Claude for an analysis and a plan.
Set these environment variables:

- `ANTHROPIC_API_KEY` — the Anthropic API key. If you do not set it, the app
  uses a canned client. The canned client gives deterministic results and
  makes no network calls. Use it for local development.
- `CLAUDE_MODEL` — the model id. The default is `claude-opus-5`.
- `FREE_MAX_SITES` (default 1), `FREE_ASSESSMENTS_PER_MONTH` (default 1),
  `PRO_MAX_SITES` (default 5), `PRO_ASSESSMENTS_PER_MONTH` (default 10) —
  the tier limits.

How an assessment runs:
1. The user sends `POST /v1/sites/{id}/assessments`.
2. The API checks the email verification, the tier, and the quota.
3. A job goes on the queue. The worker picks it up.
4. The worker crawls the site, calls Claude two times, and stores the plan.
5. The client follows the progress on `GET /v1/assessments/{id}/events` (SSE).
```

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): pro re-assessment gate, auto-verification and score history"
```

---

## Done criteria for Plan 2

- `./gradlew test` green: all Plan 1 tests plus the new suites.
- A verified user can, through the API alone: add a site, start an assessment, follow SSE progress, read the report, read the plan, and check off tasks.
- Without `ANTHROPIC_API_KEY`, the full flow works with the canned client.
- A pro user can re-assess. Fixed tasks in the previous plan become `verified`.
- Quota, ownership, and verified-email rules hold in tests.

**Next:** Plan 3 (Freemius billing + tiers) follows after this plan is implemented. Plan 3 also collects the deferred cleanup items from the Plan 1 ledger.
