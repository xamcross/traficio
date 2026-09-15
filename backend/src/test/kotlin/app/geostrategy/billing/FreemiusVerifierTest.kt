package app.geostrategy.billing

import app.geostrategy.auth.hmacSha256Hex
import java.time.Instant
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
        val body = """{"type":"license.created"}""".toByteArray(Charsets.UTF_8)
        val good = hmacSha256Hex("secret-1", body)
        assertTrue(v.verify(body, good))
        assertFalse(v.verify(body, good.dropLast(1) + "0"))
        assertFalse(v.verify(body, null))
        assertFalse(v.verify(body, ""))
    }

    @Test
    fun `verifier rejects a body with one changed byte`() {
        val v = FreemiusWebhookVerifier("secret-1")
        val body = """{"type":"license.created"}""".toByteArray(Charsets.UTF_8)
        val signature = hmacSha256Hex("secret-1", body)
        val tampered = body.copyOf()
        tampered[0] = (tampered[0] + 1).toByte()
        assertFalse(v.verify(tampered, signature))
    }

    @Test
    fun `verifier checks the exact bytes, not a UTF-8 decode and re-encode of them`() {
        val v = FreemiusWebhookVerifier("secret-1")
        val body = """{"type":"license.created","note":"Müller"}""".toByteArray(Charsets.UTF_8)
        val signature = hmacSha256Hex("secret-1", body)
        val roundTripped = String(body, Charsets.ISO_8859_1).toByteArray(Charsets.UTF_8)
        assertFalse(v.verify(roundTripped, signature))
        assertTrue(v.verify(body, signature))
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

    @Test
    fun `parser accepts MySQL-style expiration timestamps as UTC`() {
        val mysql = """{"type":"license.created","user":{"email":"a@x.co"},"license":{"id":"L1","expiration":"2027-01-01 10:00:00"}}"""
        val e = parseFreemiusEvent(mysql)!!
        assertEquals(Instant.parse("2027-01-01T10:00:00Z"), e.expiresAt)
    }

    @Test
    fun `parser reads the event id and the event time from the top-level id and created fields`() {
        // A real Freemius webhook payload confirms these field names (event 1417312989). The
        // event id is the top-level "id" field. The event time is the top-level "created"
        // field, in the same MySQL-style UTC format Freemius uses for `license.expiration`.
        val real = """{"type":"license.created","id":"1417312989","created":"2026-09-14 13:50:18",
             "user":{"email":"a@x.co"},"license":{"id":"L1","expiration":"2027-01-01 10:00:00"}}"""
        val e = parseFreemiusEvent(real)!!
        assertEquals("1417312989", e.eventId)
        assertEquals(Instant.parse("2026-09-14T13:50:18Z"), e.eventTime)
    }

    @Test
    fun `parser leaves the event id and the event time null when the payload has neither`() {
        val e = parseFreemiusEvent("""{"type":"license.created","user":{"email":"a@x.co"}}""")!!
        assertEquals(null, e.eventId)
        assertEquals(null, e.eventTime)
    }

    @Test
    fun `an explicit JSON null expiration means a lifetime license, not an unparseable date`() {
        // A lifetime license's `expiration` field comes back as an explicit JSON null, not a
        // missing key (confirmed in the licenses.retrieve API response schema). That must read
        // as "no expiration", the same as a missing key, not as a malformed date string.
        val e = parseFreemiusEvent("""{"type":"license.created","user":{"email":"a@x.co"},"license":{"id":"L1","expiration":null}}""")!!
        assertNull(e.expiresAt)
    }
}
