package app.geostrategy.preview

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CloudflareIpRangesTest {
    @Test
    fun `an IPv4 address inside a Cloudflare range is contained`() {
        // 104.16.1.1 sits inside 104.16.0.0/13.
        assertTrue(CloudflareIpRanges.contains("104.16.1.1"))
    }

    @Test
    fun `an IPv4 address outside every Cloudflare range is not contained`() {
        // A well-known public resolver address, not published by Cloudflare.
        assertFalse(CloudflareIpRanges.contains("8.8.8.8"))
    }

    @Test
    fun `an IPv6 address inside a Cloudflare range is contained`() {
        // 2606:4700:1234::1 sits inside 2606:4700::/32.
        assertTrue(CloudflareIpRanges.contains("2606:4700:1234::1"))
    }

    @Test
    fun `an IPv6 address outside every Cloudflare range is not contained`() {
        // A documentation-only range (RFC 3849), not published by Cloudflare.
        assertFalse(CloudflareIpRanges.contains("2001:db8::1"))
    }

    @Test
    fun `the first address of a range is contained`() {
        // 173.245.48.0 is the first address of 173.245.48.0/20.
        assertTrue(CloudflareIpRanges.contains("173.245.48.0"))
    }

    @Test
    fun `the last address of a range is contained`() {
        // 173.245.63.255 is the last address of 173.245.48.0/20.
        assertTrue(CloudflareIpRanges.contains("173.245.63.255"))
    }

    @Test
    fun `one address below the first address of a range is not contained`() {
        assertFalse(CloudflareIpRanges.contains("173.245.47.255"))
    }

    @Test
    fun `one address past the last address of a range is not contained`() {
        assertFalse(CloudflareIpRanges.contains("173.245.64.0"))
    }

    @Test
    fun `a malformed address returns false rather than throwing`() {
        assertFalse(CloudflareIpRanges.contains("not-an-ip"))
        assertFalse(CloudflareIpRanges.contains(""))
        assertFalse(CloudflareIpRanges.contains("999.999.999.999"))
        assertFalse(CloudflareIpRanges.contains("1.2.3.4.5"))
        assertFalse(CloudflareIpRanges.contains("gggg::1"))
    }
}
