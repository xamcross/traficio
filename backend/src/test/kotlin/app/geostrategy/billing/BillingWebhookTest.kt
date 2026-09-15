package app.geostrategy.billing

import app.geostrategy.LogCapture
import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.auth.hmacSha256Hex
import app.geostrategy.http.WEBHOOK_BODY_LIMIT_BYTES
import app.geostrategy.registerAndLogin
import app.geostrategy.testDeps
import app.geostrategy.users.UserRepository
import ch.qos.logback.classic.Level
import com.mongodb.client.model.Filters.eq
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.request
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import io.ktor.utils.io.ByteWriteChannel
import io.ktor.utils.io.writeStringUtf8
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import org.bson.Document
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.atomic.AtomicLong
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class BillingWebhookTest {
    private val secret = "whsec-test"
    private val env = mapOf("FREEMIUS_SECRET_KEY" to secret, "FREEMIUS_PRO_PLAN_ID" to "plan-pro")

    // Each call returns a fresh, strictly-increasing (id, created) pair for a synthetic test
    // event. This stops two events in one test from sharing an id, or from sharing one
    // timestamp and landing out of order. The base year is 2020. Every real Freemius fixture
    // below is dated 2026, so a test that mixes the two still orders the real fixture last.
    private val eventSeq = AtomicLong(1_577_836_800L)
    private val eventCreatedFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneOffset.UTC)

    private fun withEventMeta(json: String): String {
        val n = eventSeq.getAndIncrement()
        val id = "test-evt-$n"
        val created = eventCreatedFormat.format(Instant.ofEpochSecond(n))
        return json.replaceFirst("{", "{\"id\":\"$id\",\"created\":\"$created\",")
    }

    private fun upgradeBody(email: String) = withEventMeta("""
        {"type":"license.created","objects":{"user":{"email":"$email"},
         "license":{"id":"lic-1","plan_id":"plan-pro","expiration":"2027-01-01T00:00:00Z"}}}
    """.trimIndent())

    // Not a captured payload: no subscription.created event has been captured for this product
    // yet (see the note on #38's original renewalBody, before it had a real fixture). Shaped
    // from the documented Subscription entity (https://freemius.com/help/api/subscriptions/),
    // whose own id field is "id" like every other Freemius entity. Confirm the field name
    // against a real event before trusting this in production.
    private fun subscriptionCreatedBody(email: String, subscriptionId: String, licenseId: String) = withEventMeta("""
        {"type":"subscription.created","objects":{"user":{"email":"$email"},
         "subscription":{"id":"$subscriptionId","plan_id":"plan-pro","license_id":"$licenseId","gateway":"stripe"}}}
    """.trimIndent())

    /** A validly-shaped, validly-signable upgrade event padded past the webhook body limit. */
    private fun oversizedUpgradeBody(email: String) = withEventMeta("""
        {"type":"license.created","objects":{"user":{"email":"$email"},
         "license":{"id":"lic-1","plan_id":"plan-pro","expiration":"2027-01-01T00:00:00Z"}},
         "padding":"${"x".repeat(WEBHOOK_BODY_LIMIT_BYTES.toInt())}"}
    """.trimIndent())

    // A real license.extended payload (event 1417447021, 2026-09-15). The user object has no
    // name, picture, IP, or public key, and the license object has no secret key. The test sets
    // the email, the license id, and the new expiration. All other values are from Freemius.
    private fun licenseExtendedBody(email: String, licenseId: String, expiration: String) = """
        {"type":"license.extended","developer_id":"38607","plugin_id":"39459","user_id":"10453125","install_id":null,
         "data":{"from":"2026-09-14 13:50:05","to":"$expiration","license_id":"$licenseId"},
         "event_trigger":"developer","process_time":null,"state":"processed","id":"1417447021",
         "created":"2026-09-15 06:16:29","updated":"2026-09-15 06:17:02",
         "objects":{"user":{"plugin_id":null,"user_id":null,"gross":0,"is_marketing_allowed":false,"source":0,
          "last_login_at":null,"email_status":"delivered","email":"$email","is_verified":true,"auth":"password",
          "id":"10453125","created":"2026-09-14 13:50:18","updated":null},
         "license":{"plugin_id":"39459","user_id":"10453125","plan_id":"67740","pricing_id":"89463","quota":1,
          "activated":0,"activated_local":0,"expiration":"$expiration","is_free_localhost":true,
          "is_block_features":true,"is_cancelled":false,"is_whitelabeled":false,"environment":1,"source":0,
          "id":"$licenseId","created":"2026-09-14 13:50:18","updated":"2026-09-15 06:16:29"}}}
    """.trimIndent()

    // A real payment.created payload from the sandbox refund (event 1417313124). The email and
    // the Stripe, card, and IP fields are removed. The payload has no license object.
    private fun paymentCreatedWithNoLicense(email: String) = withEventMeta("""
        {"type":"payment.created","objects":{"user":{"email":"$email"},
         "payment":{"id":"2131050","license_id":"2043610","gross":-9,"type":"refund"}}}
    """.trimIndent())

    // A real license.created payload (event 1417312989, 2026-09-14 13:50:18). The user object
    // has no name, picture, IP, or public key. The license object has no secret key. The test
    // sets the email, the license id, the plan id, the event id, and the event time. All other
    // values are from Freemius.
    private fun realLicenseCreatedBody(
        email: String,
        licenseId: String = "2043610",
        planId: String = "67740",
        eventId: String = "1417312989",
        createdAt: String = "2026-09-14 13:50:18",
        expiration: String = "2026-10-15 13:50:16",
    ) = """
        {"type":"license.created","developer_id":null,"plugin_id":"39459","user_id":"10453125","install_id":null,
         "data":{"expiration":"$expiration","license_id":"$licenseId"},
         "event_trigger":"user","process_time":null,"state":"processed","id":"$eventId",
         "created":"$createdAt","updated":"2026-09-14 13:51:02",
         "objects":{"user":{"plugin_id":null,"user_id":null,"gross":0,"is_marketing_allowed":false,"source":0,
          "last_login_at":null,"email_status":"delivered","email":"$email","is_verified":true,"auth":"password",
          "id":"10453125","created":"2026-09-14 13:50:18","updated":null},
         "license":{"plugin_id":"39459","user_id":"10453125","plan_id":"$planId","pricing_id":"89463","quota":1,
          "activated":0,"activated_local":0,"expiration":"$expiration","is_free_localhost":true,
          "is_block_features":true,"is_cancelled":false,"is_whitelabeled":false,"environment":1,"source":0,
          "id":"$licenseId","created":"2026-09-14 13:50:18","updated":"2026-09-15 06:16:29"}}}
    """.trimIndent()

    // A real payment.refund payload (event 1417313125, 2026-09-14 13:51:04). The user object
    // has no name, picture, IP, or public key. The payment object has no IP, card token, or
    // Stripe charge id. The test sets the email, the license id, the event id, and the event
    // time. All other values are from Freemius. This event has no license object. It has only
    // a user object and a payment object.
    private fun realPaymentRefundBody(
        email: String,
        licenseId: String = "2043610",
        eventId: String = "1417313125",
        createdAt: String = "2026-09-14 13:51:04",
    ) = """
        {"type":"payment.refund","developer_id":"38607","plugin_id":"39459","user_id":"10453125","install_id":null,
         "data":{"payment_id":"2131047","license_id":"$licenseId"},
         "event_trigger":"developer","process_time":null,"state":"processed","id":"$eventId",
         "created":"$createdAt","updated":null,
         "objects":{"user":{"plugin_id":null,"user_id":null,"gross":0,"is_marketing_allowed":false,"source":0,
          "last_login_at":null,"email_status":"delivered","email":"$email","is_verified":true,"auth":"password",
          "id":"10453125","created":"2026-09-14 13:50:18","updated":null},
         "payment":{"subscription_id":"827085","payment_presentment_id":null,"gross":9,"bound_payment_id":"2131050",
          "gateway_fee":0.76,"vat":1.8,"is_renewal":false,"type":"payment","user_id":"10453125","install_id":null,
          "plan_id":"67740","pricing_id":"89463","license_id":"$licenseId","country_code":"at",
          "zip_postal_code":"12345","vat_id":null,"coupon_id":null,"source":0,"plugin_id":"39459",
          "gateway":"stripe","environment":1,"id":"2131047","created":"2026-09-14 13:50:19",
          "updated":"2026-09-14 13:51:02","currency":"usd"}}}
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
    fun `a subscription created event stores the subscription id and a later license created event does not erase it`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val repo = UserRepository(db)

        val sub = subscriptionCreatedBody("ada@example.com", subscriptionId = "sub-1", licenseId = "lic-1")
        assertEquals(HttpStatusCode.OK, http.webhook(sub, hmacSha256Hex(secret, sub)).status)
        val afterSubscription = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("pro", afterSubscription.tier)
        assertEquals("sub-1", afterSubscription.freemius!!.subscriptionId)

        val license = upgradeBody("ada@example.com")
        assertEquals(HttpStatusCode.OK, http.webhook(license, hmacSha256Hex(secret, license)).status)
        val afterLicense = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("lic-1", afterLicense.freemius!!.licenseId)
        // license.created carries no subscription object. Its own event must not blank out
        // the subscription id that the earlier subscription.created event already stored.
        assertEquals("sub-1", afterLicense.freemius!!.subscriptionId)
    }

    @Test
    fun `a license created event before the subscription created event keeps the license id once the subscription id arrives`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val repo = UserRepository(db)

        val license = upgradeBody("ada@example.com")
        assertEquals(HttpStatusCode.OK, http.webhook(license, hmacSha256Hex(secret, license)).status)

        val sub = subscriptionCreatedBody("ada@example.com", subscriptionId = "sub-1", licenseId = "lic-1")
        assertEquals(HttpStatusCode.OK, http.webhook(sub, hmacSha256Hex(secret, sub)).status)
        val after = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("pro", after.tier)
        assertEquals("lic-1", after.freemius!!.licenseId)
        assertEquals("sub-1", after.freemius!!.subscriptionId)
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
    fun `unhandled event type is acked without a change to the pro user`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val up = upgradeBody("ada@example.com")
        assertEquals(HttpStatusCode.OK, http.webhook(up, hmacSha256Hex(secret, up)).status)
        val repo = UserRepository(db)
        val pro = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("pro", pro.tier)

        val installed = """{"type":"install.installed","objects":{"user":{"email":"ada@example.com"}}}"""
        val res = http.webhook(installed, hmacSha256Hex(secret, installed))
        assertEquals(HttpStatusCode.OK, res.status)
        val after = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("pro", after.tier)
        assertEquals(pro.freemius, after.freemius)
    }

    @Test
    fun `webhook without configured secret is 503`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }
        val res = client.post("/v1/billing/freemius/webhook") { setBody("{}") }
        assertEquals(HttpStatusCode.ServiceUnavailable, res.status)
        assertTrue(res.bodyAsText().contains("billing_not_configured"))
    }

    @Test
    fun `a webhook body over the limit with Content-Length is 413 and never applies billing`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        // A validly-signed body, so a 413 here proves the size cap runs before signature
        // verification and before BillingService.apply, not that the signature failed.
        val oversized = oversizedUpgradeBody("ada@example.com")
        val res = http.webhook(oversized, hmacSha256Hex(secret, oversized))
        assertEquals(HttpStatusCode.PayloadTooLarge, res.status)
        assertTrue(res.bodyAsText().contains("invalid_request"))

        val user = runBlocking { UserRepository(db).findByEmail("ada@example.com")!! }
        assertEquals("free", user.tier)
    }

    @Test
    fun `a webhook body over the limit with no Content-Length header is also 413`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb(), email = RecordingEmailSender(), env = env)) }
        val body = oversizedUpgradeBody("ada@example.com")

        val res = client.post("/v1/billing/freemius/webhook") {
            header("X-Signature", hmacSha256Hex(secret, body))
            setBody(object : OutgoingContent.WriteChannelContent() {
                override suspend fun writeTo(channel: ByteWriteChannel) {
                    channel.writeStringUtf8(body)
                }
            })
        }
        // Confirms this request truly carried no Content-Length header, so the assertion
        // below proves the streaming byte count, not the declared length, caught it.
        assertEquals(null, res.request.headers[HttpHeaders.ContentLength])
        assertEquals(HttpStatusCode.PayloadTooLarge, res.status)
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
    fun `an unhandled event type is acked without a user lookup and leaves a pro user unchanged`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val up = upgradeBody("ada@example.com")
        http.webhook(up, hmacSha256Hex(secret, up))
        val repo = UserRepository(db)
        val before = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("pro", before.tier)

        val installed = """{"type":"install.installed","objects":{"user":{"email":"ada@example.com"}}}"""
        val res = http.webhook(installed, hmacSha256Hex(secret, installed))
        assertEquals(HttpStatusCode.OK, res.status)

        val after = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("pro", after.tier)
        assertEquals(before.freemius, after.freemius)
    }

    @Test
    fun `an unknown email on a handled event type logs one ERROR line naming the type and the license id`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }

        val logs = LogCapture()
        try {
            val ghost = upgradeBody("ghost@example.com")
            assertEquals(HttpStatusCode.OK, client.webhook(ghost, hmacSha256Hex(secret, ghost)).status)

            val errors = logs.events().filter { it.level == Level.ERROR }
            assertEquals(1, errors.size)
            assertTrue(errors[0].formattedMessage.contains("license.created"))
            assertTrue(errors[0].formattedMessage.contains("lic-1"))
        } finally {
            logs.stop()
        }
    }

    @Test
    fun `an event type the server ignores logs no ERROR line`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }

        val logs = LogCapture()
        try {
            val installed = """{"type":"install.installed","objects":{"user":{"email":"ghost@example.com"}}}"""
            assertEquals(HttpStatusCode.OK, client.webhook(installed, hmacSha256Hex(secret, installed)).status)

            assertTrue(logs.events().none { it.level == Level.ERROR })
        } finally {
            logs.stop()
        }
    }

    @Test
    fun `a real license extended event with the matching license id sets the later expiresAt and the user stays pro`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val repo = UserRepository(db)

        val up = upgradeBody("ada@example.com")
        http.webhook(up, hmacSha256Hex(secret, up))
        val firstExpiry = runBlocking { repo.findByEmail("ada@example.com")!! }.freemius!!.expiresAt!!

        val renewal = licenseExtendedBody("ada@example.com", "lic-1", "2027-02-01 00:00:00")
        assertEquals(HttpStatusCode.OK, http.webhook(renewal, hmacSha256Hex(secret, renewal)).status)

        val downgraded = BillingRevalidator(repo, CannedFreemiusClient()).run(firstExpiry.plusSeconds(3600))
        assertEquals(0, downgraded)
        val after = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("pro", after.tier)
        assertEquals(Instant.parse("2027-02-01T00:00:00Z"), after.freemius!!.expiresAt)
    }

    @Test
    fun `a license extended event for a different license id changes nothing`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val repo = UserRepository(db)

        val up = upgradeBody("ada@example.com")
        http.webhook(up, hmacSha256Hex(secret, up))
        val before = runBlocking { repo.findByEmail("ada@example.com")!! }.freemius!!

        val renewal = licenseExtendedBody("ada@example.com", "lic-other", "2027-02-01 00:00:00")
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

    @Test
    fun `the same signed event delivered twice changes nothing on the second delivery`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val repo = UserRepository(db)

        val up = upgradeBody("ada@example.com")
        assertEquals(HttpStatusCode.OK, http.webhook(up, hmacSha256Hex(secret, up)).status)
        val afterFirst = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("pro", afterFirst.tier)

        // The second delivery answers 200, the same as the first. The equality check below
        // includes updatedAt, so it proves BillingService did not write the user a second time.
        assertEquals(HttpStatusCode.OK, http.webhook(up, hmacSha256Hex(secret, up)).status)
        val afterSecond = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals(afterFirst, afterSecond)
    }

    @Test
    fun `the same signed event delivered at the same time is recorded and applied only once`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val up = upgradeBody("ada@example.com")
        val sig = hmacSha256Hex(secret, up)
        val responses = coroutineScope {
            awaitAll(async { http.webhook(up, sig) }, async { http.webhook(up, sig) })
        }
        assertTrue(responses.all { it.status == HttpStatusCode.OK })

        val eventId = parseFreemiusEvent(up)!!.eventId!!
        val recorded = db.getCollection<Document>("billingEvents").countDocuments(eq("eventId", eventId))
        assertEquals(1L, recorded)
        assertEquals("pro", runBlocking { UserRepository(db).findByEmail("ada@example.com")!! }.tier)
    }

    @Test
    fun `two different events for the same user delivered at the same time settle on the newer one`() = testApplication {
        val db = TestMongo.freshDb()
        val realPlanEnv = mapOf("FREEMIUS_SECRET_KEY" to secret, "FREEMIUS_PRO_PLAN_ID" to "67740")
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = realPlanEnv)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val repo = UserRepository(db)

        // An older event and a newer event for the same account race each other. The final
        // state must reflect the newer event, no matter which write reaches Mongo first: a
        // plain read-then-write could let the older event's write land last and win instead.
        val olderRefund = realPaymentRefundBody("ada@example.com", eventId = "test-refund-race", createdAt = "2026-09-01 00:00:00")
        val newerUpgrade = realLicenseCreatedBody("ada@example.com")
        coroutineScope {
            awaitAll(
                async { http.webhook(olderRefund, hmacSha256Hex(secret, olderRefund)) },
                async { http.webhook(newerUpgrade, hmacSha256Hex(secret, newerUpgrade)) },
            )
        }

        val after = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("pro", after.tier)
        assertEquals(Instant.parse("2026-09-14T13:50:18Z"), after.freemius!!.lastEventAt)
    }

    @Test
    fun `an older license created event after a newer payment refund does not make a free user pro`() = testApplication {
        val db = TestMongo.freshDb()
        val realPlanEnv = mapOf("FREEMIUS_SECRET_KEY" to secret, "FREEMIUS_PRO_PLAN_ID" to "67740")
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = realPlanEnv)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val repo = UserRepository(db)

        // The real payment.refund (13:51:04) lands first. A replay of the real license.created
        // event then arrives late: that event actually happened earlier, at 13:50:18. Without
        // the event-time check, this replay would reinstate pro with no new payment.
        val refund = realPaymentRefundBody("ada@example.com")
        assertEquals(HttpStatusCode.OK, http.webhook(refund, hmacSha256Hex(secret, refund)).status)

        val staleUpgrade = realLicenseCreatedBody("ada@example.com")
        assertEquals(HttpStatusCode.OK, http.webhook(staleUpgrade, hmacSha256Hex(secret, staleUpgrade)).status)

        assertEquals("free", runBlocking { repo.findByEmail("ada@example.com")!! }.tier)
    }

    @Test
    fun `a newer license created event after an older payment refund makes the user pro`() = testApplication {
        val db = TestMongo.freshDb()
        val realPlanEnv = mapOf("FREEMIUS_SECRET_KEY" to secret, "FREEMIUS_PRO_PLAN_ID" to "67740")
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = realPlanEnv)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val repo = UserRepository(db)

        val earlyRefund = realPaymentRefundBody("ada@example.com", eventId = "test-refund-early", createdAt = "2026-09-01 00:00:00")
        assertEquals(HttpStatusCode.OK, http.webhook(earlyRefund, hmacSha256Hex(secret, earlyRefund)).status)

        val laterUpgrade = realLicenseCreatedBody("ada@example.com")
        assertEquals(HttpStatusCode.OK, http.webhook(laterUpgrade, hmacSha256Hex(secret, laterUpgrade)).status)

        assertEquals("pro", runBlocking { repo.findByEmail("ada@example.com")!! }.tier)
    }

    @Test
    fun `an event for an email that is not registered yet can still apply once retried after registration`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }

        // Freemius delivers the event before the account exists. The server acks it, but must
        // not treat the event id as spent: the account was never actually updated.
        val up = upgradeBody("ada@example.com")
        assertEquals(HttpStatusCode.OK, http.webhook(up, hmacSha256Hex(secret, up)).status)

        registerAndLogin(http, "ada@example.com")

        // A retry of the identical event, now that the account exists, must still apply.
        assertEquals(HttpStatusCode.OK, http.webhook(up, hmacSha256Hex(secret, up)).status)
        assertEquals("pro", runBlocking { UserRepository(db).findByEmail("ada@example.com")!! }.tier)
    }

    @Test
    fun `two different events for the same user with the identical event time both apply`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")
        val repo = UserRepository(db)

        // Freemius timestamps only have one-second resolution, so two distinct real events can
        // share one `created` value. Neither should lose to the other on that account alone.
        val sameCreated = "2026-09-15 06:16:29"
        val upgrade = """
            {"type":"license.created","id":"evt-same-time-a","created":"$sameCreated",
             "objects":{"user":{"email":"ada@example.com"},
             "license":{"id":"lic-1","plan_id":"plan-pro","expiration":"2027-01-01T00:00:00Z"}}}
        """.trimIndent()
        assertEquals(HttpStatusCode.OK, http.webhook(upgrade, hmacSha256Hex(secret, upgrade)).status)
        assertEquals("pro", runBlocking { repo.findByEmail("ada@example.com")!! }.tier)

        val cancel = """
            {"type":"subscription.cancelled","id":"evt-same-time-b","created":"$sameCreated",
             "objects":{"user":{"email":"ada@example.com"}}}
        """.trimIndent()
        assertEquals(HttpStatusCode.OK, http.webhook(cancel, hmacSha256Hex(secret, cancel)).status)

        val after = runBlocking { repo.findByEmail("ada@example.com")!! }
        assertEquals("pro", after.tier)
        assertEquals("cancelled", after.freemius!!.subscriptionStatus)
    }
}
