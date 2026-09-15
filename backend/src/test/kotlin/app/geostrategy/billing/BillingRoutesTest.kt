package app.geostrategy.billing

import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.registerAndLogin
import app.geostrategy.testDeps
import app.geostrategy.users.FreemiusInfo
import app.geostrategy.users.UserRepository
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class BillingRoutesTest {
    private class FixedFreemiusClient(
        private val cancelResult: Boolean = true,
        private val portalLink: String? = "https://users.freemius.com/login/magic-token",
    ) : FreemiusClient {
        var lastCancelledSubscriptionId: String? = null
        override suspend fun checkLicense(licenseId: String): LicenseState? = null
        override suspend fun cancelSubscription(subscriptionId: String): Boolean {
            lastCancelledSubscriptionId = subscriptionId
            return cancelResult
        }
        override suspend fun portalLoginLink(email: String): String? = portalLink
    }

    /** Registers, verifies nothing (billing routes don't require it), and marks the user pro with the given billing info. */
    private suspend fun proUserWith(db: com.mongodb.kotlin.client.coroutine.MongoDatabase, email: String, info: FreemiusInfo) {
        val repo = UserRepository(db)
        val user = repo.findByEmail(email)!!
        repo.setBilling(user.id, "pro", info)
    }

    @Test
    fun `GET subscription answers null fields for a free user with no billing info`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender())) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val res = http.get("/v1/billing/subscription")
        assertEquals(HttpStatusCode.OK, res.status)
        val body = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals("free", body["tier"]!!.jsonPrimitive.content)
        assertTrue(body["status"] is kotlinx.serialization.json.JsonNull)
    }

    @Test
    fun `GET subscription answers the stored plan, status, and period end for a pro user`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender())) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val expiresAt = Instant.parse("2027-01-01T00:00:00Z")
        runBlocking { proUserWith(db, "ada@example.com", FreemiusInfo(licenseId = "lic-1", subscriptionId = "sub-1", planId = "plan-pro", subscriptionStatus = "active", expiresAt = expiresAt)) }

        val res = http.get("/v1/billing/subscription")
        assertEquals(HttpStatusCode.OK, res.status)
        val body = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals("pro", body["tier"]!!.jsonPrimitive.content)
        assertEquals("active", body["status"]!!.jsonPrimitive.content)
        assertEquals("plan-pro", body["planId"]!!.jsonPrimitive.content)
        assertEquals(expiresAt.toString(), body["currentPeriodEnd"]!!.jsonPrimitive.content)
    }

    @Test
    fun `cancel calls the fake client with the stored subscription id, sets status cancelled, and keeps tier pro`() = testApplication {
        val db = TestMongo.freshDb()
        val client = FixedFreemiusClient(cancelResult = true)
        application { appModule(testDeps(db, email = RecordingEmailSender(), freemiusClient = client)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        runBlocking { proUserWith(db, "ada@example.com", FreemiusInfo(licenseId = "lic-1", subscriptionId = "sub-1", planId = "plan-pro", subscriptionStatus = "active", expiresAt = Instant.parse("2027-01-01T00:00:00Z"))) }

        val res = http.post("/v1/billing/subscription/cancel")
        assertEquals(HttpStatusCode.OK, res.status)
        assertEquals("sub-1", client.lastCancelledSubscriptionId)
        val body = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals("pro", body["tier"]!!.jsonPrimitive.content)
        assertEquals("cancelled", body["status"]!!.jsonPrimitive.content)

        val stored = runBlocking { UserRepository(db).findByEmail("ada@example.com")!! }
        assertEquals("pro", stored.tier)
        assertEquals("cancelled", stored.freemius!!.subscriptionStatus)
    }

    @Test
    fun `cancel for a user without a subscription id answers 409 and calls the client with nothing`() = testApplication {
        val db = TestMongo.freshDb()
        val client = FixedFreemiusClient()
        application { appModule(testDeps(db, email = RecordingEmailSender(), freemiusClient = client)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        runBlocking { proUserWith(db, "ada@example.com", FreemiusInfo(licenseId = "lic-1", planId = "plan-pro", subscriptionStatus = "active")) }

        val res = http.post("/v1/billing/subscription/cancel")
        assertEquals(HttpStatusCode.Conflict, res.status)
        assertTrue(res.bodyAsText().contains("no_subscription"))
        assertEquals(null, client.lastCancelledSubscriptionId)
    }

    @Test
    fun `cancel for a signed-out visitor is 401`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb(), email = RecordingEmailSender())) }
        val res = client.post("/v1/billing/subscription/cancel")
        assertEquals(HttpStatusCode.Unauthorized, res.status)
    }

    @Test
    fun `a new-subscription webhook landing during the Freemius call wins, so the response reports the new subscription instead of a stale cancelled`() = testApplication {
        val db = TestMongo.freshDb()
        val repo = UserRepository(db)
        // Simulates a webhook for a brand new subscription landing while the Freemius API call
        // is in flight: the stored subscriptionId moves to "sub-2" before this route's write.
        val client = object : FreemiusClient {
            override suspend fun checkLicense(licenseId: String): LicenseState? = null
            override suspend fun cancelSubscription(subscriptionId: String): Boolean {
                val user = repo.findByEmail("ada@example.com")!!
                repo.setBilling(user.id, "pro", user.freemius!!.copy(subscriptionId = "sub-2", subscriptionStatus = "active"))
                return true
            }
            override suspend fun portalLoginLink(email: String): String? = null
        }
        application { appModule(testDeps(db, email = RecordingEmailSender(), freemiusClient = client)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        runBlocking { proUserWith(db, "ada@example.com", FreemiusInfo(licenseId = "lic-1", subscriptionId = "sub-1", planId = "plan-pro", subscriptionStatus = "active")) }

        val res = http.post("/v1/billing/subscription/cancel")
        assertEquals(HttpStatusCode.OK, res.status)
        val body = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        // Not "cancelled": the account has since moved to a different subscription.
        assertEquals("active", body["status"]!!.jsonPrimitive.content)

        val stored = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("sub-2", stored.freemius!!.subscriptionId)
        assertEquals("active", stored.freemius!!.subscriptionStatus)
    }

    @Test
    fun `a failed cancel at Freemius is 502 and does not change the stored status`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), freemiusClient = FixedFreemiusClient(cancelResult = false))) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        runBlocking { proUserWith(db, "ada@example.com", FreemiusInfo(licenseId = "lic-1", subscriptionId = "sub-1", planId = "plan-pro", subscriptionStatus = "active")) }

        val res = http.post("/v1/billing/subscription/cancel")
        assertEquals(HttpStatusCode.BadGateway, res.status)
        assertTrue(res.bodyAsText().contains("cancel_failed"))
        assertEquals("active", runBlocking { UserRepository(db).findByEmail("ada@example.com")!! }.freemius!!.subscriptionStatus)
    }

    @Test
    fun `portal link answers the fake client's link`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), freemiusClient = FixedFreemiusClient())) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val res = http.post("/v1/billing/portal-link")
        assertEquals(HttpStatusCode.OK, res.status)
        val body = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals("https://users.freemius.com/login/magic-token", body["url"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a failed portal link request is 502`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), freemiusClient = FixedFreemiusClient(portalLink = null))) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val res = http.post("/v1/billing/portal-link")
        assertEquals(HttpStatusCode.BadGateway, res.status)
        assertTrue(res.bodyAsText().contains("portal_link_failed"))
    }
}
