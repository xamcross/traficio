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
}
