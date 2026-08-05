# Billing & Hardening Implementation Plan (Plan 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freemius billing on the backend (webhook, tier updates, daily revalidation, downgrade semantics) plus the deferred hardening batches from Plans 1–2 (queue and cap races, SSE cap, crawl politeness, streaming Claude client).

**Architecture:** Everything extends the existing Ktor monolith. New module: `billing` (webhook verifier, event parser, billing service, revalidator). The webhook is unauthenticated; the HMAC signature is the authentication. External Freemius calls hide behind a `FreemiusClient` interface with a canned no-op default.

**Tech Stack:** Unchanged (Kotlin/Ktor, Mongo coroutine driver, Anthropic Java SDK, Testcontainers). No new dependencies.

## Global Constraints

- All Plan 1 and Plan 2 Global Constraints still bind (package root, `/v1` routes, error envelope, `Instant` timestamps, TDD per task, ASD-STE100 documentation prose, commands from `backend/`).
- **Placeholder/mock policy (standing user directive):** `FREEMIUS_SECRET_KEY`, `FREEMIUS_PRO_PLAN_ID` are optional env vars. Without the secret, the webhook answers 503 `billing_not_configured`. The signature header name is `FREEMIUS_SIGNATURE_HEADER` (default `X-Signature`). The event fixtures in tests define OUR parser's contract; the README must say: verify header name and payload shapes against real Freemius payloads before production. `FreemiusClient` ships as an interface + `CannedFreemiusClient` (returns null = unknown = no change); a real client is a production-checklist item.
- Webhook signature: HMAC-SHA256 over the RAW request body, hex, constant-time compare (`MessageDigest.isEqual`). Unknown event types and unknown emails are acknowledged with 200 (no Freemius retry storms); signature failures are 401 `invalid_signature`.
- Tier semantics: upgrade events set `tier = "pro"` and store `FreemiusInfo`. `subscription.cancelled` only marks `subscriptionStatus = "cancelled"` (tier keeps until expiry). `payment.refund`, `license.expired`, `license.cancelled`, `license.deactivated` downgrade immediately. The daily revalidator downgrades pro users whose `freemius.expiresAt` is past (and asks `FreemiusClient` when it has a license id; `null` answers change nothing).
- Downgrade semantics (spec §7): sites beyond the tier cap become read-only — visible in lists (`readOnly: true`) but not assessable (403 `site_read_only`). "Within the cap" = the user's oldest `maxSitesFor(tier)` sites by `createdAt`.
- Hardening: `JobQueue.fail`/`complete` become conditional updates (no read-then-write); site-cap and assessment-quota get post-insert rechecks that delete the excess row; the assessment job lease grows to 900 s; SSE gets a max duration (`SSE_MAX_MILLIS`, default 900000); the crawler paces page fetches (200 ms) and fails honestly with `robots_blocked` when robots.txt disallows the homepage; `markTasksVerified` sets `completedAt`; the task check-off 404 message names the task. `RealClaudeClient` switches to streaming.
- The `CancellationException`-rethrow-first pattern binds every new catch block around suspend calls.

## File Structure

```
backend/src/main/kotlin/app/geostrategy/
  billing/Freemius.kt          # FreemiusInfo lives on User (users pkg); here: event model, parser, verifier
  billing/BillingService.kt    # apply(event); BillingRevalidator; FreemiusClient + CannedFreemiusClient
  billing/BillingRoutes.kt     # POST /v1/billing/freemius/webhook
```
Modified: `users/User.kt`, `config/AppConfig.kt`, `AppDeps.kt`, `Application.kt`, `jobs/Jobs.kt`, `jobs/JobWorker.kt`, `sites/SiteRoutes.kt`, `assessment/AssessmentRoutes.kt`, `crawl/Crawler.kt`, `plans/Plans.kt`, `plans/PlanRoutes.kt`, `claude/RealClaudeClient.kt`, `README.md`, test `TestSupport.kt`.

---

### Task 1: Billing fields on the user model

**Files:**
- Modify: `backend/src/main/kotlin/app/geostrategy/users/User.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/users/UserBillingTest.kt`

**Interfaces:**
- Consumes: existing `User`/`UserRepository`.
- Produces: `data class FreemiusInfo(val userId: String? = null, val licenseId: String? = null, val planId: String? = null, val subscriptionStatus: String? = null, val expiresAt: Instant? = null)`; `User` gains `val freemius: FreemiusInfo? = null`; `UserRepository` gains `suspend fun setBilling(id: ObjectId, tier: String, info: FreemiusInfo?)` and `suspend fun listByTier(tier: String): List<User>`. Existing documents decode unchanged (new field has a default).

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/users/UserBillingTest.kt`:
```kotlin
package app.geostrategy.users

import app.geostrategy.TestMongo
import kotlinx.coroutines.runBlocking
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class UserBillingTest {
    private fun newUser(email: String) =
        User(email = email, passwordHash = "x", createdAt = Instant.now(), updatedAt = Instant.now())

    @Test
    fun `setBilling upgrades and downgrades with info retained`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val u = repo.insert(newUser("ada@example.com"))
        assertNull(repo.findById(u.id)!!.freemius)

        val info = FreemiusInfo(userId = "fs-1", licenseId = "lic-1", planId = "plan-pro", subscriptionStatus = "active", expiresAt = Instant.now().plusSeconds(3600))
        repo.setBilling(u.id, "pro", info)
        val pro = repo.findById(u.id)!!
        assertEquals("pro", pro.tier)
        assertEquals("lic-1", pro.freemius!!.licenseId)

        repo.setBilling(u.id, "free", info.copy(subscriptionStatus = "expired"))
        val free = repo.findById(u.id)!!
        assertEquals("free", free.tier)
        assertEquals("expired", free.freemius!!.subscriptionStatus)
    }

    @Test
    fun `listByTier returns only that tier`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val a = repo.insert(newUser("a@example.com"))
        repo.insert(newUser("b@example.com"))
        repo.setBilling(a.id, "pro", FreemiusInfo(licenseId = "lic-a"))
        assertEquals(listOf("a@example.com"), repo.listByTier("pro").map { it.email })
        assertEquals(listOf("b@example.com"), repo.listByTier("free").map { it.email })
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.users.UserBillingTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

In `users/User.kt`: add the `FreemiusInfo` data class above `User`; add `val freemius: FreemiusInfo? = null` to `User` (after `tier`); add to `UserRepository`:
```kotlin
    suspend fun setBilling(id: ObjectId, tier: String, info: FreemiusInfo?) {
        col.updateOne(
            eq("_id", id),
            combine(set("tier", tier), set("freemius", info), set("updatedAt", Instant.now())),
        )
    }

    suspend fun listByTier(tier: String): List<User> = col.find(eq("tier", tier)).toList()
```
(Import `kotlinx.coroutines.flow.toList`.)

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL (existing suites unaffected — the new field defaults to null).

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): freemius billing fields on the user model"
```

---

### Task 2: Freemius config + webhook signature verification

**Files:**
- Modify: `backend/src/main/kotlin/app/geostrategy/config/AppConfig.kt` (+3 fields), `backend/src/main/kotlin/app/geostrategy/auth/Crypto.kt` (+`hmacSha256Hex`)
- Create: `backend/src/main/kotlin/app/geostrategy/billing/Freemius.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/billing/FreemiusVerifierTest.kt`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `AppConfig` gains `freemiusSecretKey: String?` (`FREEMIUS_SECRET_KEY`), `freemiusProPlanId: String?` (`FREEMIUS_PRO_PLAN_ID`), `freemiusSignatureHeader: String` (`FREEMIUS_SIGNATURE_HEADER`, default `"X-Signature"`).
  - `fun hmacSha256Hex(secret: String, body: String): String` in `auth/Crypto.kt`.
  - In `billing/Freemius.kt`: `class FreemiusWebhookVerifier(private val secret: String) { fun verify(rawBody: String, signature: String?): Boolean }` — constant-time compare via `MessageDigest.isEqual`; null/blank signature → false.
  - `data class FreemiusEvent(val type: String, val email: String?, val licenseId: String?, val planId: String?, val expiresAt: Instant?)` and `fun parseFreemiusEvent(rawBody: String): FreemiusEvent?` — lenient kotlinx-JSON parsing: `type` required (else null); email from `objects.user.email` or `user.email` (lowercased); licenseId from `objects.license.id` or `license.id` (primitive content); planId from `objects.license.plan_id` or `license.plan_id`; expiresAt from `objects.license.expiration` or `license.expiration` via `Instant.parse` with a null fallback on any parse error.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/billing/FreemiusVerifierTest.kt`:
```kotlin
package app.geostrategy.billing

import app.geostrategy.auth.hmacSha256Hex
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FreemiusVerifierTest {
    @Test
    fun `hmac matches the rfc test vector`() {
        assertEquals(
            "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
            hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"),
        )
    }

    @Test
    fun `verifier accepts the right signature and rejects wrong or missing ones`() {
        val v = FreemiusWebhookVerifier("secret-1")
        val body = """{"type":"license.created"}"""
        val good = hmacSha256Hex("secret-1", body)
        assertTrue(v.verify(body, good))
        assertFalse(v.verify(body, good.dropLast(1) + "0"))
        assertFalse(v.verify(body, null))
        assertFalse(v.verify(body, ""))
    }

    @Test
    fun `parser reads nested and flat payloads and tolerates junk`() {
        val nested = """
            {"type":"license.created","objects":{"user":{"email":"Ada@Example.com"},
             "license":{"id":12345,"plan_id":"plan-pro","expiration":"2027-01-01T00:00:00Z"}}}
        """
        val e = parseFreemiusEvent(nested)!!
        assertEquals("license.created", e.type)
        assertEquals("ada@example.com", e.email)
        assertEquals("12345", e.licenseId)
        assertEquals("plan-pro", e.planId)
        assertEquals("2027-01-01T00:00:00Z", e.expiresAt.toString())

        val flat = """{"type":"subscription.cancelled","user":{"email":"b@x.co"},"license":{"id":"L9","expiration":"not-a-date"}}"""
        val f = parseFreemiusEvent(flat)!!
        assertEquals("b@x.co", f.email)
        assertEquals("L9", f.licenseId)
        assertNull(f.expiresAt)

        assertNull(parseFreemiusEvent("""{"no_type":true}"""))
        assertNull(parseFreemiusEvent("not json"))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.billing.FreemiusVerifierTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

Add to `auth/Crypto.kt`:
```kotlin
fun hmacSha256Hex(secret: String, body: String): String {
    val mac = javax.crypto.Mac.getInstance("HmacSHA256")
    mac.init(javax.crypto.spec.SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
    return mac.doFinal(body.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
```
(Move `javax.crypto` names to imports.)

`billing/Freemius.kt`:
```kotlin
package app.geostrategy.billing

import app.geostrategy.auth.hmacSha256Hex
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.security.MessageDigest
import java.time.Instant

class FreemiusWebhookVerifier(private val secret: String) {
    fun verify(rawBody: String, signature: String?): Boolean {
        if (signature.isNullOrBlank()) return false
        val expected = hmacSha256Hex(secret, rawBody).toByteArray(Charsets.UTF_8)
        return MessageDigest.isEqual(expected, signature.lowercase().toByteArray(Charsets.UTF_8))
    }
}

data class FreemiusEvent(
    val type: String,
    val email: String?,
    val licenseId: String?,
    val planId: String?,
    val expiresAt: Instant?,
)

fun parseFreemiusEvent(rawBody: String): FreemiusEvent? {
    val root = try { Json.parseToJsonElement(rawBody).jsonObject } catch (e: Exception) { return null }
    val type = root.str("type") ?: return null
    val objects = root.obj("objects")
    val user = objects?.obj("user") ?: root.obj("user")
    val license = objects?.obj("license") ?: root.obj("license")
    val expiresAt = license?.str("expiration")?.let {
        try { Instant.parse(it) } catch (e: Exception) { null }
    }
    return FreemiusEvent(
        type = type,
        email = user?.str("email")?.lowercase(),
        licenseId = license?.str("id"),
        planId = license?.str("plan_id"),
        expiresAt = expiresAt,
    )
}

private fun JsonObject.obj(key: String): JsonObject? = try { this[key]?.jsonObject } catch (e: Exception) { null }
private fun JsonObject.str(key: String): String? = try { this[key]?.jsonPrimitive?.content } catch (e: Exception) { null }
```

`AppConfig`: add the three fields and `fromEnv` entries (`freemiusSignatureHeader = env["FREEMIUS_SIGNATURE_HEADER"] ?: "X-Signature"`).

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): freemius config, hmac verifier and lenient event parser"
```

---

### Task 3: Webhook endpoint + billing service

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/billing/BillingService.kt`, `billing/BillingRoutes.kt`
- Modify: `AppDeps.kt` (+ `billing: BillingService?`), `Application.kt` (build service when secret set; routing + `billingRoutes(deps)`), `TestSupport.kt` (`testDeps` builds the service when env has the secret)
- Test: `backend/src/test/kotlin/app/geostrategy/billing/BillingWebhookTest.kt`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `class BillingService(private val users: UserRepository, private val proPlanId: String?)` with `suspend fun apply(event: FreemiusEvent)`:
    - Upgrade types (`license.created`, `license.activated`, `subscription.created`): skip when `proPlanId != null && event.planId != null && event.planId != proPlanId`; else find user by email → `setBilling(id, "pro", FreemiusInfo(licenseId, planId, "active", expiresAt))`. Unknown email → log WARN, return.
    - `subscription.cancelled`: keep tier; update `freemius.subscriptionStatus = "cancelled"` (no-op when the user has no billing info).
    - Downgrade types (`payment.refund`, `license.expired`, `license.cancelled`, `license.deactivated`): `setBilling(id, "free", existingInfo.copy(subscriptionStatus = "expired"))`.
    - Any other type: ignore.
  - Route `POST /v1/billing/freemius/webhook` (no session auth): 503 `billing_not_configured` without a secret; 401 `invalid_signature` on missing/bad signature (verify the RAW body via `call.receiveText()`); unparseable or unknown events → 200 `OkResponse` (ack); parsed events → `billing.apply(event)` → 200.
  - `testDeps(db, email, google, env)` builds `billing = ...` when `env["FREEMIUS_SECRET_KEY"]` is set (same wiring as `main()`).

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/billing/BillingWebhookTest.kt`:
```kotlin
package app.geostrategy.billing

import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.auth.hmacSha256Hex
import app.geostrategy.registerAndLogin
import app.geostrategy.testDeps
import app.geostrategy.users.UserRepository
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class BillingWebhookTest {
    private val secret = "whsec-test"
    private val env = mapOf("FREEMIUS_SECRET_KEY" to secret, "FREEMIUS_PRO_PLAN_ID" to "plan-pro")

    private fun upgradeBody(email: String) = """
        {"type":"license.created","objects":{"user":{"email":"$email"},
         "license":{"id":"lic-1","plan_id":"plan-pro","expiration":"2027-01-01T00:00:00Z"}}}
    """.trimIndent()

    private suspend fun io.ktor.client.HttpClient.webhook(body: String, sig: String?) =
        post("/v1/billing/freemius/webhook") {
            contentType(ContentType.Application.Json)
            if (sig != null) header("X-Signature", sig)
            setBody(body)
        }

    @Test
    fun `signed upgrade event makes the user pro and downgrade reverts`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val up = upgradeBody("Ada@Example.com")
        assertEquals(HttpStatusCode.OK, http.webhook(up, hmacSha256Hex(secret, up)).status)
        val repo = UserRepository(db)
        val pro = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("pro", pro.tier)
        assertEquals("lic-1", pro.freemius!!.licenseId)

        val cancel = """{"type":"subscription.cancelled","objects":{"user":{"email":"ada@example.com"}}}"""
        http.webhook(cancel, hmacSha256Hex(secret, cancel))
        assertEquals("pro", runBlocking { repo.findByEmail("ada@example.com")!! }.tier)
        assertEquals("cancelled", runBlocking { repo.findByEmail("ada@example.com")!! }.freemius!!.subscriptionStatus)

        val refund = """{"type":"payment.refund","objects":{"user":{"email":"ada@example.com"}}}"""
        http.webhook(refund, hmacSha256Hex(secret, refund))
        val free = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("free", free.tier)
        assertEquals("expired", free.freemius!!.subscriptionStatus)
    }

    @Test
    fun `bad signature is 401 and wrong plan or unknown user are acked without change`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val up = upgradeBody("ada@example.com")
        val bad = http.webhook(up, "deadbeef")
        assertEquals(HttpStatusCode.Unauthorized, bad.status)
        assertTrue(bad.bodyAsText().contains("invalid_signature"))

        val wrongPlan = up.replace("plan-pro", "plan-other")
        assertEquals(HttpStatusCode.OK, http.webhook(wrongPlan, hmacSha256Hex(secret, wrongPlan)).status)
        val ghost = upgradeBody("ghost@example.com")
        assertEquals(HttpStatusCode.OK, http.webhook(ghost, hmacSha256Hex(secret, ghost)).status)
        assertEquals("free", runBlocking { UserRepository(db).findByEmail("ada@example.com")!! }.tier)
    }

    @Test
    fun `webhook without configured secret is 503`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }
        val res = client.post("/v1/billing/freemius/webhook") { setBody("{}") }
        assertEquals(HttpStatusCode.ServiceUnavailable, res.status)
        assertTrue(res.bodyAsText().contains("billing_not_configured"))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.billing.BillingWebhookTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

`billing/BillingService.kt`:
```kotlin
package app.geostrategy.billing

import app.geostrategy.users.FreemiusInfo
import app.geostrategy.users.UserRepository
import org.slf4j.LoggerFactory

private val UPGRADE_TYPES = setOf("license.created", "license.activated", "subscription.created")
private val DOWNGRADE_TYPES = setOf("payment.refund", "license.expired", "license.cancelled", "license.deactivated")

class BillingService(
    private val users: UserRepository,
    private val proPlanId: String?,
) {
    private val log = LoggerFactory.getLogger(BillingService::class.java)

    suspend fun apply(event: FreemiusEvent) {
        val email = event.email ?: run { log.warn("freemius event {} without email", event.type); return }
        val user = users.findByEmail(email) ?: run { log.warn("freemius event {} for unknown email", event.type); return }
        when {
            event.type in UPGRADE_TYPES -> {
                if (proPlanId != null && event.planId != null && event.planId != proPlanId) {
                    log.info("freemius event {} for non-pro plan {} ignored", event.type, event.planId)
                    return
                }
                users.setBilling(
                    user.id, "pro",
                    FreemiusInfo(licenseId = event.licenseId, planId = event.planId, subscriptionStatus = "active", expiresAt = event.expiresAt),
                )
            }
            event.type == "subscription.cancelled" -> {
                val info = user.freemius ?: return
                users.setBilling(user.id, user.tier, info.copy(subscriptionStatus = "cancelled"))
            }
            event.type in DOWNGRADE_TYPES -> {
                users.setBilling(user.id, "free", (user.freemius ?: FreemiusInfo()).copy(subscriptionStatus = "expired"))
            }
            else -> log.info("freemius event {} ignored", event.type)
        }
    }
}
```

`billing/BillingRoutes.kt`:
```kotlin
package app.geostrategy.billing

import app.geostrategy.AppDeps
import app.geostrategy.auth.OkResponse
import app.geostrategy.http.AppException
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receiveText
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post

fun Route.billingRoutes(deps: AppDeps) {
    post("/v1/billing/freemius/webhook") {
        val secret = deps.config.freemiusSecretKey
        val billing = deps.billing
        if (secret == null || billing == null) {
            throw AppException(HttpStatusCode.ServiceUnavailable, "billing_not_configured", "Billing is not set up on this server yet.")
        }
        val raw = call.receiveText()
        val signature = call.request.headers[deps.config.freemiusSignatureHeader]
        if (!FreemiusWebhookVerifier(secret).verify(raw, signature)) {
            throw AppException(HttpStatusCode.Unauthorized, "invalid_signature", "The webhook signature does not match.")
        }
        parseFreemiusEvent(raw)?.let { billing.apply(it) }
        call.respond(OkResponse())
    }
}
```

Wiring: `AppDeps` gains `val billing: BillingService?`; `main()` builds `BillingService(users, config.freemiusProPlanId)` when `config.freemiusSecretKey != null`, else null; routing adds `billingRoutes(deps)`; `testDeps` mirrors the same conditional using its `env` map (it already builds `AppConfig.fromEnv(env)` — reuse that config instance for the check).

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): freemius webhook with signed tier upgrades and downgrades"
```

---

### Task 4: License revalidator + daily loop

**Files:**
- Modify: `backend/src/main/kotlin/app/geostrategy/billing/BillingService.kt` (add `FreemiusClient`, `CannedFreemiusClient`, `BillingRevalidator`)
- Modify: `Application.kt` (`main()` starts the daily loop on the app scope)
- Test: `backend/src/test/kotlin/app/geostrategy/billing/BillingRevalidatorTest.kt`

**Interfaces:**
- Consumes: Task 1 (`listByTier`, `setBilling`), Task 3.
- Produces:
  - `interface FreemiusClient { suspend fun isLicenseActive(licenseId: String): Boolean? }` — null = unknown (no change). `class CannedFreemiusClient : FreemiusClient` returns null. A real HTTP client is a production-checklist item (README, Task 8).
  - `class BillingRevalidator(users: UserRepository, client: FreemiusClient)` with `suspend fun run(now: Instant = Instant.now()): Int` — for each pro user: downgrade when `freemius.expiresAt` is before `now`, or when the client answers `false` for the license id. Returns the downgraded count.
  - `main()`: `appScope.launch` loop — run the revalidator, then `delay(24.hours)`; `CancellationException` rethrown, other exceptions logged (WARN) and the loop continues.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/billing/BillingRevalidatorTest.kt`:
```kotlin
package app.geostrategy.billing

import app.geostrategy.TestMongo
import app.geostrategy.users.FreemiusInfo
import app.geostrategy.users.User
import app.geostrategy.users.UserRepository
import kotlinx.coroutines.runBlocking
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals

class BillingRevalidatorTest {
    private fun newUser(email: String) =
        User(email = email, passwordHash = "x", createdAt = Instant.now(), updatedAt = Instant.now())

    @Test
    fun `expired pro users downgrade, active ones stay, canned client changes nothing else`() = runBlocking {
        val db = TestMongo.freshDb()
        val repo = UserRepository(db)
        val now = Instant.now()
        val expired = repo.insert(newUser("expired@example.com"))
        val active = repo.insert(newUser("active@example.com"))
        val noInfo = repo.insert(newUser("noinfo@example.com"))
        repo.setBilling(expired.id, "pro", FreemiusInfo(licenseId = "l1", expiresAt = now.minusSeconds(60)))
        repo.setBilling(active.id, "pro", FreemiusInfo(licenseId = "l2", expiresAt = now.plusSeconds(3600)))
        repo.setBilling(noInfo.id, "pro", null)

        val count = BillingRevalidator(repo, CannedFreemiusClient()).run(now)

        assertEquals(1, count)
        assertEquals("free", repo.findById(expired.id)!!.tier)
        assertEquals("expired", repo.findById(expired.id)!!.freemius!!.subscriptionStatus)
        assertEquals("pro", repo.findById(active.id)!!.tier)
        assertEquals("pro", repo.findById(noInfo.id)!!.tier)
    }

    @Test
    fun `client saying inactive downgrades even before expiry`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val u = repo.insert(newUser("revoked@example.com"))
        repo.setBilling(u.id, "pro", FreemiusInfo(licenseId = "lic-revoked", expiresAt = Instant.now().plusSeconds(3600)))
        val client = object : FreemiusClient {
            override suspend fun isLicenseActive(licenseId: String) = licenseId != "lic-revoked"
        }
        assertEquals(1, BillingRevalidator(repo, client).run())
        assertEquals("free", repo.findById(u.id)!!.tier)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.billing.BillingRevalidatorTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

Append to `billing/BillingService.kt`:
```kotlin
interface FreemiusClient {
    suspend fun isLicenseActive(licenseId: String): Boolean?
}

/** Placeholder client: answers "unknown" so only expiry-based downgrades run. */
class CannedFreemiusClient : FreemiusClient {
    override suspend fun isLicenseActive(licenseId: String): Boolean? = null
}

class BillingRevalidator(
    private val users: UserRepository,
    private val client: FreemiusClient,
) {
    private val log = LoggerFactory.getLogger(BillingRevalidator::class.java)

    suspend fun run(now: java.time.Instant = java.time.Instant.now()): Int {
        var downgraded = 0
        for (user in users.listByTier("pro")) {
            val info = user.freemius ?: continue
            val expired = info.expiresAt?.isBefore(now) == true
            val revoked = info.licenseId?.let { client.isLicenseActive(it) } == false
            if (expired || revoked) {
                users.setBilling(user.id, "free", info.copy(subscriptionStatus = "expired"))
                downgraded++
                log.info("downgraded {} (expired={}, revoked={})", user.email, expired, revoked)
            }
        }
        return downgraded
    }
}
```
(Imports instead of qualified `java.time.Instant`.)

In `main()` after the worker start:
```kotlin
val revalidator = BillingRevalidator(deps.users, CannedFreemiusClient())
appScope.launch {
    while (isActive) {
        try {
            revalidator.run()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            claudeLog.warn("billing revalidation failed: {}", e.message)
        }
        delay(24 * 60 * 60 * 1000L)
    }
}
```
(Imports: `kotlinx.coroutines.delay`, `kotlinx.coroutines.isActive`, `kotlinx.coroutines.launch`, `kotlinx.coroutines.CancellationException`; reuse the existing logger or create a billing logger.)

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): daily billing revalidation with placeholder freemius client"
```

### Task 5: Downgrade semantics — read-only sites

**Files:**
- Modify: `sites/SiteRoutes.kt` (readOnly flag in DTO + list route), `assessment/AssessmentRoutes.kt` (read-only gate)
- Test: `backend/src/test/kotlin/app/geostrategy/billing/DowngradeTest.kt`

**Interfaces:**
- Consumes: Tasks 1–4; Plan 2 routes.
- Produces:
  - `SiteDto` gains `val readOnly: Boolean`. A site is read-only when it is NOT among the user's oldest `maxSitesFor(tier)` sites by `createdAt`. `GET /v1/sites` computes the flag; `Site.toDto()` changes to `toDto(readOnly: Boolean)`.
  - Submission route: after the ownership check and BEFORE the pro gate — when the site is read-only for the user's tier, throw `AppException(403, "site_read_only", "This site is read-only on your current plan. Upgrade to work with it again.")`.
  - Shared helper in `sites/SiteRoutes.kt`: `fun allowedSiteIds(sites: List<Site>, max: Int): Set<ObjectId> = sites.sortedBy { it.createdAt }.take(max).map { it.id }.toSet()`.
  - Test helper `makeFree(db, email)` (direct collection update, mirror of `makePro`).

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/billing/DowngradeTest.kt`:
```kotlin
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.billing.DowngradeTest"`
Expected: FAIL — `readOnly` missing from the DTO; no read-only gate.

- [ ] **Step 3: Implement**

`sites/SiteRoutes.kt`: add `readOnly: Boolean` to `SiteDto`; change `fun Site.toDto(readOnly: Boolean)`; add the `allowedSiteIds` helper; in the list route compute `val allowed = allowedSiteIds(sites, deps.config.tierLimits.maxSitesFor(user.tier))` and map `it.toDto(readOnly = it.id !in allowed)`; in the create route respond `site.toDto(readOnly = false)`.

`assessment/AssessmentRoutes.kt`, after the site-ownership check and before the pro gate:
```kotlin
        val allowed = allowedSiteIds(deps.sites.listFor(user.id), deps.config.tierLimits.maxSitesFor(user.tier))
        if (site.id !in allowed) {
            throw AppException(HttpStatusCode.Forbidden, "site_read_only", "This site is read-only on your current plan. Upgrade to work with it again.")
        }
```
(Import `app.geostrategy.sites.allowedSiteIds`.)

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL (Plan 2 site tests updated only if the compiler requires the new `toDto` signature at call sites inside the routes — test JSON assertions are additive).

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): downgraded users keep extra sites read-only"
```

---

### Task 6: Race hardening — conditional queue updates + post-insert rechecks

**Files:**
- Modify: `jobs/Jobs.kt` (`complete`/`fail` conditional), `jobs/JobWorker.kt` (+ `leaseSeconds`), `Application.kt` (worker lease 900), `sites/SiteRoutes.kt` (cap recheck), `assessment/AssessmentRoutes.kt` (quota recheck), `sites/Site.kt` (+ `delete`), `assessment/Assessment.kt` (+ `delete`)
- Test: `backend/src/test/kotlin/app/geostrategy/jobs/JobQueueConditionalTest.kt` (+ small additions listed below)

**Interfaces:**
- Consumes: existing queue/routes.
- Produces:
  - `JobQueue.complete(id)` updates only when `status == "running"`. `JobQueue.fail(id, error)` becomes two conditional updates (no read): first `and(_id, gte("attempts", maxAttempts), ne("status", "done"))` → `failed`; if `modifiedCount == 0L`, then `and(_id, lt("attempts", maxAttempts), ne("status", "done"))` → `queued`. Both keep `unset(leasedUntil)` + `error` + `updatedAt`.
  - `JobWorker(queue, handlers, pollMillis, leaseSeconds: Long = 300)` — passes `leaseSeconds` to `claim`. `main()` uses `leaseSeconds = 900`.
  - `SiteRepository.delete(id)`, `AssessmentRepository.delete(id)`.
  - Site create route: after `insert`, recheck `countFor(user.id) > max` → `delete(site.id)` + throw 403 `site_limit_reached`.
  - Submission route: after `assessments.insert` and BEFORE `jobs.enqueue`, recheck `countNonFailedForUserSince(...) > limit` → `assessments.delete(a.id)` + throw 403 `quota_exceeded`.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/jobs/JobQueueConditionalTest.kt`:
```kotlin
package app.geostrategy.jobs

import app.geostrategy.TestMongo
import kotlinx.coroutines.runBlocking
import org.bson.Document
import kotlin.test.Test
import kotlin.test.assertEquals

class JobQueueConditionalTest {
    @Test
    fun `complete is a no-op unless the job is running`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb())
        val j = q.enqueue("t", Document())
        q.complete(j.id)                      // queued, not running -> no-op
        assertEquals("queued", q.findById(j.id)!!.status)
        q.claim()
        q.complete(j.id)
        assertEquals("done", q.findById(j.id)!!.status)
        q.fail(j.id, "late failure")          // done -> both conditional updates skip
        assertEquals("done", q.findById(j.id)!!.status)
    }

    @Test
    fun `fail still requeues below the cap and fails at the cap`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb(), maxAttempts = 2)
        val j = q.enqueue("t", Document())
        q.claim(); q.fail(j.id, "one")
        assertEquals("queued", q.findById(j.id)!!.status)
        q.claim(); q.fail(j.id, "two")
        assertEquals("failed", q.findById(j.id)!!.status)
        assertEquals("two", q.findById(j.id)!!.error)
    }
}
```

Additions to existing tests (same step): in `SiteRoutesTest`, add a test `cap recheck removes a raced insert` — with the free cap of 1: create one site via the route; insert a second directly via `SiteRepository` (the racer, "raced.example.com"); call a THIRD create via the route for "third.example.com" and assert 403 plus, afterward, that `countFor` is back to 2 (the route's own insert was removed, the racer stays). In `AssessmentRoutesTest`, add `quota recheck removes a raced insert`: verified free user with one route-created assessment (limit 1); insert a second assessment directly via the repo; a route submission must return 403 `quota_exceeded` and leave the direct+first counts intact (route insert deleted). Write both tests fully in the implementation, mirroring these descriptions — they are short.

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.jobs.JobQueueConditionalTest"`
Expected: FAIL — `complete` currently completes a queued job (unconditional update), so the first assertion breaks.

- [ ] **Step 3: Implement**

`jobs/Jobs.kt`:
```kotlin
    suspend fun complete(id: ObjectId) {
        col.updateOne(
            and(eq("_id", id), eq("status", "running")),
            combine(set("status", "done"), unset("leasedUntil"), set("updatedAt", Instant.now())),
        )
    }

    suspend fun fail(id: ObjectId, error: String) {
        val now = Instant.now()
        val toFailed = col.updateOne(
            and(eq("_id", id), gte("attempts", maxAttempts), ne("status", "done")),
            combine(set("status", "failed"), set("error", error), unset("leasedUntil"), set("updatedAt", now)),
        )
        if (toFailed.modifiedCount == 0L) {
            col.updateOne(
                and(eq("_id", id), lt("attempts", maxAttempts), ne("status", "done")),
                combine(set("status", "queued"), set("error", error), unset("leasedUntil"), set("updatedAt", now)),
            )
        }
    }
```
(Imports: `gte`, `ne` from Filters.) `findById` stays.

`jobs/JobWorker.kt`: constructor gains `private val leaseSeconds: Long = 300`; the loop calls `queue.claim(leaseSeconds)`. `main()`: `JobWorker(deps.jobs, mapOf("assessment" to pipeline::handle), leaseSeconds = 900)`.

Repos: `SiteRepository.delete(id)` / `AssessmentRepository.delete(id)` = `col.deleteOne(eq("_id", id))`.

Routes: add the two post-insert rechecks exactly as the Interfaces block describes (site route: recheck after insert, delete own insert on violation; assessment route: recheck between insert and enqueue, delete own insert on violation). The recheck uses `>` (strictly greater), so the row that fills the cap exactly survives.

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL — the Plan 2 `JobQueueTest` and `JobWorkerTest` must still pass (the conditional rewrite preserves their asserted behavior).

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "fix(backend): conditional queue updates and post-insert cap and quota rechecks"
```

---

### Task 7: Crawl, SSE and plans polish

**Files:**
- Modify: `config/AppConfig.kt` (+ `sseMaxMillis`), `assessment/AssessmentRoutes.kt` (SSE cap), `crawl/Crawler.kt` (robots-blocked fail + pacing), `plans/Plans.kt` (`markTasksVerified` sets `completedAt`), `plans/PlanRoutes.kt` (task-specific 404 message)
- Test: additions to `CrawlerTest`, `ReassessmentTest`, `PlanRoutesTest`, plus `backend/src/test/kotlin/app/geostrategy/assessment/SseCapTest.kt`

**Interfaces:**
- Consumes: existing modules.
- Produces:
  - `AppConfig.sseMaxMillis: Long` (`SSE_MAX_MILLIS`, default `900000`). The SSE loop breaks when the elapsed time passes the cap (connection closes; the client reconnects).
  - Crawler: throws `AppException(422 UnprocessableEntity, "robots_blocked", "Your site's robots.txt asks us not to read it. Allow GeoStrategyBot in robots.txt, then try again.")` when robots disallows the homepage path. Page-loop pacing: `delay(pacingMillis)` before every fetch except the homepage; constructor gains `pacingMillis: Long = 200`.
  - `markTasksVerified` sets `completedAt = now` on tasks it verifies.
  - PATCH task route: when the plan exists but the task id does not, the 404 message is "We couldn't find that task."

- [ ] **Step 1: Write the failing tests**

Add to `CrawlerTest`:
```kotlin
    @Test
    fun `robots disallowing the homepage fails honestly`() = runBlocking {
        val fetcher = MapFetcher(mapOf(
            "https://example.com" to home,
            "https://example.com/robots.txt" to "User-agent: *\nDisallow: /",
        ))
        val e = assertFailsWith<AppException> { Crawler(fetcher).crawl("https://example.com") }
        assertEquals("robots_blocked", e.code)
    }
```
Add to `ReassessmentTest` (in the auto-verify test, after the verified assertion): `assertNotNull(fixedTask.completedAt)` — adjust the fetch of `fixedTask` accordingly and import `assertNotNull`.
Add to `PlanRoutesTest`:
```kotlin
    @Test
    fun `unknown task id names the task in the 404`() = testApplication {
        // reuse the setup from the verified-rejection test up to obtaining `plan`
        // then: PATCH /v1/plans/{planId}/tasks/nope with {"status":"done"}
        // assert 404 and body contains "task"
    }
```
Write that test fully (copy the existing setup; the comment above states the intent).
New `SseCapTest.kt`:
```kotlin
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./gradlew test --tests "app.geostrategy.assessment.SseCapTest" --tests "app.geostrategy.crawl.CrawlerTest"`
Expected: SseCapTest hangs-then-times-out or fails (no cap yet — if it hangs, that IS the red evidence; abort after ~1 min); CrawlerTest new case FAILS (no robots_blocked).

- [ ] **Step 3: Implement**

`AppConfig`: `sseMaxMillis = env["SSE_MAX_MILLIS"]?.toLong() ?: 900_000L`.
SSE loop: record `val startedAt = System.currentTimeMillis()` before the loop; add `if (System.currentTimeMillis() - startedAt >= deps.config.sseMaxMillis) break` after the terminal-status break check.
Crawler: after `Robots.parse(robotsTxt)`, add:
```kotlin
            if (!robots.allows("/")) {
                throw AppException(HttpStatusCode.UnprocessableEntity, "robots_blocked", "Your site's robots.txt asks us not to read it. Allow GeoStrategyBot in robots.txt, then try again.")
            }
```
Pacing: constructor `private val pacingMillis: Long = 200`; in the page loop, before fetching any non-homepage URL: `delay(pacingMillis)` (import `kotlinx.coroutines.delay`).
`markTasksVerified`: `it.copy(status = "verified", completedAt = now)`.
`PlanRoutes` PATCH: replace the final `?: throw NOT_FOUND()` with `?: throw AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that task.")`.

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL (budget tests still pass: pacing 200 ms fits inside the 400 ms test budgets since the slow page is the only paced fetch... verify; if the partial-pages budget test becomes flaky, pass `pacingMillis = 0` in THAT test's `Crawler` construction only).

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "fix(backend): sse cap, robots-blocked honest fail, crawl pacing, verify timestamps"
```

---

### Task 8: Streaming Claude client + README

**Files:**
- Modify: `claude/RealClaudeClient.kt` (streaming), `README.md` (billing + ops sections, ASD-STE100)
- Test: none new (thin network adapter; compile-verified). Full suite must stay green.

**Interfaces:**
- Consumes: Task 8 of Plan 2.
- Produces:
  - `RealClaudeClient.complete` uses the SDK's streaming call instead of blocking `create`: `client.messages().createStreaming(params)` (a `StreamResponse<RawMessageStreamEvent>`); accumulate text from `contentBlockDelta` events' text deltas into a `StringBuilder`; capture usage — input tokens from the `messageStart` event's message usage, output tokens from the final `messageDelta` usage. Close the stream with `use { }`. Params are unchanged (same model, maxTokens, cached system, output_config schema). Implementer note: verify exact event-accessor names with `javap` on the SDK jar if a name does not compile; the observable contract (returned text + `ClaudeUsage`) must not change.
  - README additions (ASD-STE100 style):
    - "Billing" section: the three `FREEMIUS_*` env vars; the webhook URL path; this warning: "Verify the signature header name and the payload shapes against real Freemius webhooks before production. The test fixtures define the parser's current contract."
    - "Before production with a real Anthropic key" checklist: set `ANTHROPIC_API_KEY`; the client streams responses; the job lease is 900 s; implement a real `FreemiusClient` for license revalidation; review `SSE_MAX_MILLIS`.

- [ ] **Step 1: Implement the streaming change**

Rewrite `complete` in `RealClaudeClient.kt` (structure; adjust accessor names from compiler/javap if needed):
```kotlin
    private suspend fun complete(system: String, user: String, schema: Any): Pair<String, ClaudeUsage> =
        withContext(Dispatchers.IO) {
            val params = /* unchanged builder */
            val text = StringBuilder()
            var inputTokens = 0L
            var outputTokens = 0L
            client.messages().createStreaming(params).use { stream ->
                stream.stream().forEach { event ->
                    event.messageStart().ifPresent { start ->
                        inputTokens = start.message().usage().inputTokens()
                    }
                    event.contentBlockDelta().ifPresent { delta ->
                        delta.delta().text().ifPresent { text.append(it.text()) }
                    }
                    event.messageDelta().ifPresent { d ->
                        outputTokens = d.usage().outputTokens()
                    }
                }
            }
            text.toString() to ClaudeUsage(inputTokens, outputTokens)
        }
```

- [ ] **Step 2: Compile and run the full suite**

Run: `./gradlew build -x test` then `./gradlew test`
Expected: BUILD SUCCESSFUL both times (no test constructs `RealClaudeClient`; compilation is the verification).

- [ ] **Step 3: Write the README sections**

Append to `backend/README.md` (keep ASD-STE100: short sentences, active voice):
```markdown
## Billing (Freemius)

Set these environment variables to enable billing:

- `FREEMIUS_SECRET_KEY` — the store secret. Without it, the webhook answers 503.
- `FREEMIUS_PRO_PLAN_ID` — the Pro plan id. Events for other plans are ignored.
- `FREEMIUS_SIGNATURE_HEADER` — the signature header name. The default is `X-Signature`.

Point the Freemius webhook to `POST /v1/billing/freemius/webhook`.
The server verifies each call with HMAC-SHA256 over the raw body.

Warning: verify the signature header name and the payload shapes against real
Freemius webhooks before production. The test fixtures define the parser's
current contract.

## Before production with a real Anthropic key

1. Set `ANTHROPIC_API_KEY`. The client streams responses to avoid timeouts.
2. The assessment job lease is 900 seconds. Do not lower it for slow sites.
3. Implement a real `FreemiusClient` for license revalidation. The canned
   client only downgrades on expiry dates.
4. Review `SSE_MAX_MILLIS` (default 900000). Clients reconnect after the cap.
```

- [ ] **Step 4: Run all tests once more**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): streaming claude client and billing/ops runbook"
```

---

## Done criteria for Plan 3

- `./gradlew test` green: all prior suites plus the new billing/hardening tests.
- A signed Freemius upgrade webhook makes a user pro; refund/expiry downgrades; the daily revalidator downgrades expired pro users.
- A downgraded user sees extra sites as read-only and cannot assess them.
- Queue updates are conditional; cap and quota survive raced inserts; the worker lease is 900 s.
- SSE closes at the cap; robots-blocked sites fail honestly; page fetches are paced.
- `RealClaudeClient` streams. The README documents billing and the production checklist.

**Next:** Plan 4 (Angular frontend) follows after this plan is implemented.
