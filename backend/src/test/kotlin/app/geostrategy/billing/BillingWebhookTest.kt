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

    // These two shapes were checked on 2026-09-14 against the real Freemius API, for the
    // sandbox purchase (developer 38607, store 18651, product 39459, events 1417312989 and
    // 1417313124). A payment.created payload has "objects": {"user", "payment"}. It has no
    // license object, so it cannot carry a renewal expiration. A license.created payload has
    // "objects": {"user", "license"}, with the expiration as a MySQL-style timestamp (no zone).
    // No renewal event ever fired for the sandbox account: it was refunded and cancelled about
    // a minute after the purchase. So renewalBody below is not a captured payload. It follows
    // the license.created shape above, per the "resource.event carries objects.resource"
    // pattern that Freemius documents for its other license.* events.

    private fun renewalBody(email: String, licenseId: String, expiration: String) = """
        {"type":"license.updated","objects":{"user":{"email":"$email"},
         "license":{"id":"$licenseId","plan_id":"plan-pro","expiration":"$expiration"}}}
    """.trimIndent()

    // Real payment.created payload for the sandbox refund (event 1417313124), with the email
    // and the Stripe, card, and IP fields removed.
    private fun paymentCreatedWithNoLicense(email: String) = """
        {"type":"payment.created","objects":{"user":{"email":"$email"},
         "payment":{"id":"2131050","license_id":"2043610","gross":-9,"type":"refund"}}}
    """.trimIndent()

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

    @Test
    fun `renewal event with the matching license id extends expiresAt and the user stays pro`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val repo = UserRepository(db)

        val up = upgradeBody("ada@example.com")
        http.webhook(up, hmacSha256Hex(secret, up))
        val firstExpiry = runBlocking { repo.findByEmail("ada@example.com")!! }.freemius!!.expiresAt!!

        val renewal = renewalBody("ada@example.com", "lic-1", "2027-02-01 00:00:00")
        assertEquals(HttpStatusCode.OK, http.webhook(renewal, hmacSha256Hex(secret, renewal)).status)
        val renewed = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("pro", renewed.tier)
        assertTrue(renewed.freemius!!.expiresAt!!.isAfter(firstExpiry))

        val downgraded = BillingRevalidator(repo, CannedFreemiusClient()).run(firstExpiry.plusSeconds(3600))
        assertEquals(0, downgraded)
        val after = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("pro", after.tier)
        assertEquals(renewed.freemius!!.expiresAt, after.freemius!!.expiresAt)
    }

    @Test
    fun `renewal event for a different license id changes nothing`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val repo = UserRepository(db)

        val up = upgradeBody("ada@example.com")
        http.webhook(up, hmacSha256Hex(secret, up))
        val before = runBlocking { repo.findByEmail("ada@example.com")!! }.freemius!!

        val renewal = renewalBody("ada@example.com", "lic-other", "2027-02-01 00:00:00")
        assertEquals(HttpStatusCode.OK, http.webhook(renewal, hmacSha256Hex(secret, renewal)).status)
        val after = runBlocking { repo.findByEmail("ada@example.com")!! }.freemius!!
        assertEquals(before, after)
    }

    @Test
    fun `payment created without a license object changes nothing`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val repo = UserRepository(db)

        val up = upgradeBody("ada@example.com")
        http.webhook(up, hmacSha256Hex(secret, up))
        val before = runBlocking { repo.findByEmail("ada@example.com")!! }.freemius!!

        val payment = paymentCreatedWithNoLicense("ada@example.com")
        assertEquals(HttpStatusCode.OK, http.webhook(payment, hmacSha256Hex(secret, payment)).status)
        val after = runBlocking { repo.findByEmail("ada@example.com")!! }.freemius!!
        assertEquals(before, after)
    }
}
