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
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class BillingWebhookTest {
    private val secret = "whsec-test"
    private val env = mapOf("FREEMIUS_SECRET_KEY" to secret, "FREEMIUS_PRO_PLAN_ID" to "plan-pro")
    private val renewalTypes = listOf("license.updated")

    private fun upgradeBody(email: String) = """
        {"type":"license.created","objects":{"user":{"email":"$email"},
         "license":{"id":"lic-1","plan_id":"plan-pro","expiration":"2027-01-01T00:00:00Z"}}}
    """.trimIndent()

    // No renewal has occurred for this product yet. So this body is not a captured payload.
    // It uses the license object of a real license.created payload (event 1417312989), with a
    // MySQL-style expiration. Freemius documents the same license object for its other
    // license.* events.
    private fun renewalBody(type: String, email: String, licenseId: String, expiration: String) = """
        {"type":"$type","objects":{"user":{"email":"$email"},
         "license":{"id":"$licenseId","plan_id":"plan-pro","expiration":"$expiration"}}}
    """.trimIndent()

    // A real payment.created payload from the sandbox refund (event 1417313124). The email and
    // the Stripe, card, and IP fields are removed. The payload has no license object.
    private fun paymentCreatedWithNoLicense(email: String) = """
        {"type":"payment.created","objects":{"user":{"email":"$email"},
         "payment":{"id":"2131050","license_id":"2043610","gross":-9,"type":"refund"}}}
    """.trimIndent()

    private suspend fun io.ktor.client.HttpClient.webhook(body: String, sig: String?) =
        post("/v1/billing/freemius/webhook") {
            contentType(ContentType.Application.Json)
            if (sig != null) header("X-Signature", sig)
            setBody(body)
        }

    private suspend fun io.ktor.client.HttpClient.webhookBytes(body: ByteArray, contentType: String, sig: String?) =
        post("/v1/billing/freemius/webhook") {
            contentType(ContentType.parse(contentType))
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

    @Test
    fun `signature check uses the raw bytes, ignoring a mismatched charset in Content-Type`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val up = """
            {"type":"license.created","note":"Müller","objects":{"user":{"email":"ada@example.com"},
             "license":{"id":"lic-1","plan_id":"plan-pro","expiration":"2027-01-01T00:00:00Z"}}}
        """.trimIndent()
        val bytes = up.toByteArray(Charsets.UTF_8)
        val sig = hmacSha256Hex(secret, bytes)

        val res = http.webhookBytes(bytes, "application/json; charset=ISO-8859-1", sig)
        assertEquals(HttpStatusCode.OK, res.status)
        assertEquals("pro", runBlocking { UserRepository(db).findByEmail("ada@example.com")!! }.tier)
    }

    @Test
    fun `tampering with one byte of the body is 401 and changes no user`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val bytes = upgradeBody("ada@example.com").toByteArray(Charsets.UTF_8)
        val sig = hmacSha256Hex(secret, bytes)
        val tampered = bytes.copyOf()
        tampered[10] = (tampered[10] + 1).toByte()

        val res = http.webhookBytes(tampered, "application/json", sig)
        assertEquals(HttpStatusCode.Unauthorized, res.status)
        assertEquals("free", runBlocking { UserRepository(db).findByEmail("ada@example.com")!! }.tier)
    }

    @Test
    fun `missing signature header is 401`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val res = http.webhook(upgradeBody("ada@example.com"), null)
        assertEquals(HttpStatusCode.Unauthorized, res.status)
    }

    @Test
    fun `renewal event with the matching license id sets the later expiresAt and the user stays pro`() {
        for (type in renewalTypes) testApplication {
            val db = TestMongo.freshDb()
            application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
            val http = createClient { install(HttpCookies) }
            registerAndLogin(http, "ada@example.com")
            val repo = UserRepository(db)

            val up = upgradeBody("ada@example.com")
            http.webhook(up, hmacSha256Hex(secret, up))
            val firstExpiry = runBlocking { repo.findByEmail("ada@example.com")!! }.freemius!!.expiresAt!!

            val renewal = renewalBody(type, "ada@example.com", "lic-1", "2027-02-01 00:00:00")
            assertEquals(HttpStatusCode.OK, http.webhook(renewal, hmacSha256Hex(secret, renewal)).status, type)

            val downgraded = BillingRevalidator(repo, CannedFreemiusClient()).run(firstExpiry.plusSeconds(3600))
            assertEquals(0, downgraded, type)
            val after = runBlocking { repo.findByEmail("ada@example.com")!! }
            assertEquals("pro", after.tier, type)
            assertEquals(Instant.parse("2027-02-01T00:00:00Z"), after.freemius!!.expiresAt, type)
        }
    }

    @Test
    fun `renewal event for a different license id changes nothing`() {
        for (type in renewalTypes) testApplication {
            val db = TestMongo.freshDb()
            application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
            val http = createClient { install(HttpCookies) }
            registerAndLogin(http, "ada@example.com")
            val repo = UserRepository(db)

            val up = upgradeBody("ada@example.com")
            http.webhook(up, hmacSha256Hex(secret, up))
            val before = runBlocking { repo.findByEmail("ada@example.com")!! }.freemius!!

            val renewal = renewalBody(type, "ada@example.com", "lic-other", "2027-02-01 00:00:00")
            assertEquals(HttpStatusCode.OK, http.webhook(renewal, hmacSha256Hex(secret, renewal)).status, type)
            val after = runBlocking { repo.findByEmail("ada@example.com")!! }.freemius!!
            assertEquals(before, after, type)
        }
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
