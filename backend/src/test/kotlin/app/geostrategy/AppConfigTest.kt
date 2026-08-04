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
    fun `env values override defaults and https enables secure cookies`() {
        val c = AppConfig.fromEnv(mapOf("PORT" to "9999", "BASE_URL" to "https://api.geostrategy.app"))
        assertEquals(9999, c.port)
        assertTrue(c.secureCookies)
    }
}
