package app.geostrategy.preview

/**
 * Cloudflare's published edge address ranges.
 *
 * Fly's proxy sets `Fly-Client-IP` to the address of the peer it sees. Through Cloudflare,
 * that peer is a Cloudflare edge server. So a request that arrives through Cloudflare
 * carries a `Fly-Client-IP` address inside one of these ranges. The preview route uses
 * [contains] to reject a caller who instead reaches the Fly hostname directly.
 */
object CloudflareIpRanges {

    // Source: https://www.cloudflare.com/ips-v4, fetched 2026-08-22.
    private val IPV4_CIDRS = listOf(
        "173.245.48.0/20",
        "103.21.244.0/22",
        "103.22.200.0/22",
        "103.31.4.0/22",
        "141.101.64.0/18",
        "108.162.192.0/18",
        "190.93.240.0/20",
        "188.114.96.0/20",
        "197.234.240.0/22",
        "198.41.128.0/17",
        "162.158.0.0/15",
        "104.16.0.0/13",
        "104.24.0.0/14",
        "172.64.0.0/13",
        "131.0.72.0/22",
    )

    // Source: https://www.cloudflare.com/ips-v6, fetched 2026-08-22.
    private val IPV6_CIDRS = listOf(
        "2400:cb00::/32",
        "2606:4700::/32",
        "2803:f800::/32",
        "2405:b500::/32",
        "2405:8100::/32",
        "2a06:98c0::/29",
        "2c0f:f248::/32",
    )

    private class Range(val network: ByteArray, val prefixLength: Int)

    private val ranges: List<Range> = (IPV4_CIDRS + IPV6_CIDRS).map { cidr ->
        val (host, prefix) = cidr.split("/", limit = 2)
        // A parse failure here is a defect in the constant list above, not in caller
        // input. So this fails fast at class load, instead of returning a wrong answer.
        val network = parseLiteralAddress(host) ?: error("bad constant CIDR: $cidr")
        Range(network, prefix.toInt())
    }

    /**
     * True when [address] falls inside a published Cloudflare range.
     *
     * The parser reads [address] as plain digits, dots and colons only. It never asks the
     * network to resolve a name. A malformed value returns false. A value that is not a
     * plain IPv4 or IPv6 literal also returns false.
     */
    fun contains(address: String): Boolean {
        val candidate = parseLiteralAddress(address) ?: return false
        return ranges.any { range ->
            candidate.size == range.network.size && sharesPrefix(candidate, range.network, range.prefixLength)
        }
    }
}

/** True when the top [prefixLength] bits of [a] and [b] are equal. [a] and [b] have equal length. */
private fun sharesPrefix(a: ByteArray, b: ByteArray, prefixLength: Int): Boolean {
    val fullBytes = prefixLength / 8
    for (i in 0 until fullBytes) {
        if (a[i] != b[i]) return false
    }
    val remainingBits = prefixLength % 8
    if (remainingBits == 0) return true
    val mask = (0xFF shl (8 - remainingBits)) and 0xFF
    return (a[fullBytes].toInt() and mask) == (b[fullBytes].toInt() and mask)
}

/**
 * Parses a plain IPv4 or IPv6 literal into its raw bytes: 4 bytes for IPv4, 16 for IPv6.
 * It returns null for anything else, including a hostname. So a caller of this function
 * never triggers a DNS lookup.
 */
private fun parseLiteralAddress(text: String): ByteArray? =
    parseIpv4(text) ?: parseIpv6(text)

private fun parseIpv4(text: String): ByteArray? {
    val parts = text.split(".")
    if (parts.size != 4) return null
    val bytes = ByteArray(4)
    for (i in 0 until 4) {
        val part = parts[i]
        if (part.isEmpty() || part.length > 3 || !part.all { it.isDigit() }) return null
        val value = part.toIntOrNull() ?: return null
        if (value !in 0..255) return null
        bytes[i] = value.toByte()
    }
    return bytes
}

/** Parses a plain IPv6 literal, such as "2001:db8::1", into its 16 raw bytes. */
private fun parseIpv6(text: String): ByteArray? {
    val body = text.removePrefix("[").removeSuffix("]")
    // A dot marks an IPv4-mapped form. This parser skips that rare form.
    if (':' !in body || '.' in body) return null

    val halves = body.split("::", limit = 3)
    if (halves.size > 2) return null // A valid literal has at most one "::" run.

    val groups = IntArray(8)
    if (halves.size == 2) {
        val head = parseHexGroups(halves[0]) ?: return null
        val tail = parseHexGroups(halves[1]) ?: return null
        if (head.size + tail.size > 8) return null
        head.forEachIndexed { i, v -> groups[i] = v }
        tail.forEachIndexed { i, v -> groups[8 - tail.size + i] = v }
    } else {
        val all = parseHexGroups(body) ?: return null
        if (all.size != 8) return null
        all.forEachIndexed { i, v -> groups[i] = v }
    }

    val bytes = ByteArray(16)
    for (i in 0 until 8) {
        bytes[2 * i] = (groups[i] shr 8).toByte()
        bytes[2 * i + 1] = (groups[i] and 0xFF).toByte()
    }
    return bytes
}

private fun parseHexGroups(part: String): List<Int>? {
    if (part.isEmpty()) return emptyList()
    val out = mutableListOf<Int>()
    for (group in part.split(":")) {
        if (group.isEmpty() || group.length > 4) return null
        val value = try { group.toInt(16) } catch (e: NumberFormatException) { return null }
        out.add(value)
    }
    return out
}
