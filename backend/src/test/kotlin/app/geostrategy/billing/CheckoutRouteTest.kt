package app.geostrategy.billing

import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.auth.md5Hex
import app.geostrategy.registerAndLogin
import app.geostrategy.testDeps
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

class CheckoutRouteTest {
    private val secret = "whsec-test"
    private val publicKey = "pk_test"
    private val fullEnv = mapOf(
        "FREEMIUS_SECRET_KEY" to secret,
        "FREEMIUS_PUBLIC_KEY" to publicKey,
        "FREEMIUS_PRO_PLAN_ID" to "plan-pro",
        "FREEMIUS_SANDBOX_EMAILS" to "ada@example.com",
    )

    @Test
    fun `a signed-in email in the sandbox list gets a sandbox token matching the documented formula`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = fullEnv)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val res = http.get("/v1/billing/checkout")
        assertEquals(HttpStatusCode.OK, res.status)
        val body = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals("plan-pro", body["planId"]!!.jsonPrimitive.content)
        val sandbox = body["sandbox"]!!.jsonObject
        val ctx = sandbox["ctx"]!!.jsonPrimitive.content
        val expectedToken = md5Hex(ctx + FREEMIUS_PRODUCT_ID + secret + publicKey + "checkout")
        assertEquals(expectedToken, sandbox["token"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a signed-in email not in the sandbox list gets sandbox null`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = fullEnv)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "bob@example.com")

        val body = Json.parseToJsonElement(http.get("/v1/billing/checkout").bodyAsText()).jsonObject
        assertEquals("plan-pro", body["planId"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, body["sandbox"])
    }

    @Test
    fun `without FREEMIUS_SECRET_KEY the route gives sandbox null even for a listed email`() = testApplication {
        val db = TestMongo.freshDb()
        val env = fullEnv - "FREEMIUS_SECRET_KEY"
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val body = Json.parseToJsonElement(http.get("/v1/billing/checkout").bodyAsText()).jsonObject
        assertEquals(JsonNull, body["sandbox"])
    }

    @Test
    fun `without FREEMIUS_PUBLIC_KEY the route gives sandbox null even for a listed email`() = testApplication {
        val db = TestMongo.freshDb()
        val env = fullEnv - "FREEMIUS_PUBLIC_KEY"
        application { appModule(testDeps(db, email = RecordingEmailSender(), env = env)) }
        val http = createClient { install(HttpCookies) }
        registerAndLogin(http, "ada@example.com")

        val body = Json.parseToJsonElement(http.get("/v1/billing/checkout").bodyAsText()).jsonObject
        assertEquals(JsonNull, body["sandbox"])
    }

    @Test
    fun `a signed-out request is 401`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, env = fullEnv)) }
        val http = createClient { install(HttpCookies) }

        assertEquals(HttpStatusCode.Unauthorized, http.get("/v1/billing/checkout").status)
    }
}
