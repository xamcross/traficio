package app.geostrategy.preview

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class PreviewRateLimiterTest {
    @Test
    fun `two addresses in the same slash-64 mask to the same key`() {
        val a = rateLimitKey("2001:db8:abcd:1234:aaaa:bbbb:cccc:dddd")
        val b = rateLimitKey("2001:db8:abcd:1234::1")
        assertEquals(a, b)
    }

    @Test
    fun `a different slash-64 masks to a different key`() {
        val a = rateLimitKey("2001:db8:abcd:1234::1")
        val b = rateLimitKey("2001:db8:abcd:9999::1")
        assertNotEquals(a, b)
    }

    @Test
    fun `an ipv4 address passes through unmasked`() {
        assertEquals("203.0.113.5", rateLimitKey("203.0.113.5"))
    }

    @Test
    fun `a value that is not a plain ipv6 literal passes through unchanged`() {
        assertEquals("not-an-address", rateLimitKey("not-an-address"))
        assertEquals("2001:db8::1::2", rateLimitKey("2001:db8::1::2")) // two "::" is invalid
    }

    @Test
    fun `hex case does not change the masked key`() {
        assertEquals(rateLimitKey("2001:DB8:ABCD:1234::1"), rateLimitKey("2001:db8:abcd:1234::2"))
    }
}
