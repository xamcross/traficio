package app.geostrategy

import app.geostrategy.config.AppConfig
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AppConfigTest {
    @Test
    fun `defaults apply when env is empty`() {
        val c = AppConfig.fromEnv(emptyMap())
        assertEquals(8080, c.port)
        assertEquals("mongodb://localhost:27017", c.mongoUri)
        assertEquals("geostrategy", c.mongoDatabase)
        assertFalse(c.secureCookies)
    }

    @Test
    fun `the default sender names Traficio`() {
        assertEquals("Traficio <noreply@traficio.com>", AppConfig.fromEnv(emptyMap()).emailFrom)
    }

    // A guard, not a new behaviour. The rename leaves the live database alone. Fly holds
    // every user and every assessment under this name, so a change here would start the
    // API on an empty database.
    @Test
    fun `the rename leaves the mongo database name alone`() {
        assertEquals("geostrategy", AppConfig.fromEnv(emptyMap()).mongoDatabase)
    }

    @Test
    fun `env values override defaults and https enables secure cookies`() {
        val c = AppConfig.fromEnv(mapOf("PORT" to "9999", "BASE_URL" to "https://api.traficio.com"))
        assertEquals(9999, c.port)
        assertTrue(c.secureCookies)
    }

    @Test
    fun `freemius public key and sandbox emails are absent by default`() {
        val c = AppConfig.fromEnv(emptyMap())
        assertEquals(null, c.freemiusPublicKey)
        assertEquals(emptyList(), c.freemiusSandboxEmails)
    }

    @Test
    fun `freemius sandbox emails split on commas, trim, lowercase, and drop empty entries`() {
        val c = AppConfig.fromEnv(
            mapOf(
                "FREEMIUS_PUBLIC_KEY" to "pk_test",
                "FREEMIUS_SANDBOX_EMAILS" to " Ada@Example.com, ,bob@example.com ",
            ),
        )
        assertEquals("pk_test", c.freemiusPublicKey)
        assertEquals(listOf("ada@example.com", "bob@example.com"), c.freemiusSandboxEmails)
    }

    @Test
    fun `freemius api token is absent by default and reads FREEMIUS_API_TOKEN`() {
        assertEquals(null, AppConfig.fromEnv(emptyMap()).freemiusApiToken)
        assertEquals("tok_123", AppConfig.fromEnv(mapOf("FREEMIUS_API_TOKEN" to "tok_123")).freemiusApiToken)
    }
}
