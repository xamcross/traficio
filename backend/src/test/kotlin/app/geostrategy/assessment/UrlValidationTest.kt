package app.geostrategy.assessment

import app.geostrategy.http.AppException
import java.net.InetAddress
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class UrlValidationTest {
    @Test
    fun `normalizeUrl adds scheme, lowercases host, strips query and fragment`() {
        assertEquals("https://example.com", normalizeUrl("Example.COM"))
        assertEquals("https://example.com", normalizeUrl("https://example.com/?utm=1#top"))
        assertEquals("http://example.com/shop", normalizeUrl("http://EXAMPLE.com/shop"))
        assertEquals("https://example.com:8443", normalizeUrl("example.com:8443"))
    }

    @Test
    fun `normalizeUrl rejects garbage and non-http schemes`() {
        assertEquals("invalid_url", assertFailsWith<AppException> { normalizeUrl("not a url at all") }.code)
        assertEquals("invalid_url", assertFailsWith<AppException> { normalizeUrl("ftp://example.com") }.code)
    }

    @Test
    fun `ssrf guard rejects private, loopback, link-local, unique-local, multicast and cgnat addresses`() {
        for (ip in listOf("127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.9", "169.254.1.1", "::1", "fc00::1", "100.64.1.1", "224.0.0.1")) {
            val guard = SsrfGuard { listOf(InetAddress.getByName(ip)) }
            assertEquals("invalid_url", assertFailsWith<AppException> { guard.check("evil.example") }.code)
        }
    }

    @Test
    fun `ssrf guard passes public addresses and maps resolution failure`() {
        SsrfGuard { listOf(InetAddress.getByName("93.184.216.34")) }.check("example.com")
        val failing = SsrfGuard { throw java.net.UnknownHostException("nope") }
        assertEquals("site_unreachable", assertFailsWith<AppException> { failing.check("nope.example") }.code)
    }

    @Test
    fun `toObjectIdOr404 parses valid hex and rejects junk`() {
        assertEquals("507f1f77bcf86cd799439011", "507f1f77bcf86cd799439011".toObjectIdOr404().toHexString())
        assertEquals("not_found", assertFailsWith<AppException> { "zzz".toObjectIdOr404() }.code)
    }
}
