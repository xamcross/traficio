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
