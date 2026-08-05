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
