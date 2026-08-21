package app.geostrategy.preview

import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.FindOneAndUpdateOptions
import com.mongodb.client.model.ReturnDocument
import com.mongodb.client.model.Updates.combine
import com.mongodb.client.model.Updates.inc
import com.mongodb.client.model.Updates.setOnInsert
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import org.bson.codecs.pojo.annotations.BsonId
import java.net.InetAddress
import java.time.Instant

/**
 * One counter for one caller address, in one fixed time window. The id field packs the
 * address and the window's start second, so one atomic upsert both creates and increments
 * the counter. The TTL index in ensureIndexes drops the document once its window ends, so
 * no cleanup job is needed.
 */
data class PreviewLimitBucket(
    @BsonId val id: String,
    val count: Int = 0,
    val expiresAt: Instant,
)

/**
 * Counts anonymous preview requests per caller address, backed by Mongo. It keeps no state
 * in memory, so every app instance behind the load balancer shares the same count.
 */
class PreviewRateLimiter(
    db: MongoDatabase,
    private val limit: Int = 3,
    private val windowSeconds: Long = 3600,
) {
    private val col = db.getCollection<PreviewLimitBucket>("previewLimits")

    /**
     * Records one request from [address]. Returns null when the caller stays within the
     * limit for the current window. Returns the number of seconds until the window ends,
     * when the caller has gone over the limit.
     */
    suspend fun recordAttempt(address: String): Long? {
        val key = rateLimitKey(address)
        val now = Instant.now()
        val windowStart = now.epochSecond - now.epochSecond % windowSeconds
        val windowEnd = windowStart + windowSeconds
        val bucket = col.findOneAndUpdate(
            eq("_id", "$key:$windowStart"),
            combine(inc("count", 1), setOnInsert("expiresAt", Instant.ofEpochSecond(windowEnd))),
            FindOneAndUpdateOptions().upsert(true).returnDocument(ReturnDocument.AFTER),
        )
        val count = bucket?.count ?: 1
        return if (count > limit) windowEnd - now.epochSecond else null
    }
}

/**
 * Turns a caller address into the key the rate limiter counts against. An IPv4 address
 * stays whole. An IPv6 address is masked down to its /64 network prefix: a caller who goes
 * straight to the Fly hostname, past Cloudflare, can pick any source address inside their
 * own /64, so a bare per-address key would give that one caller about 2^64 keys. Masking to
 * /64 puts every address from one visitor's network back into one bucket.
 *
 * The parse never touches the network. A string that is not a plain IPv6 literal, such as
 * an IPv4 address or a malformed header value, passes through unchanged.
 */
fun rateLimitKey(address: String): String {
    val groups = parseIpv6Groups(address.trim()) ?: return address
    val masked = ByteArray(16)
    for (i in 0 until 4) {
        masked[2 * i] = (groups[i] shr 8).toByte()
        masked[2 * i + 1] = (groups[i] and 0xFF).toByte()
    }
    // The last four groups (bytes 8..15) stay zero: that is the /64 mask. getByAddress
    // never performs a DNS lookup; it only wraps the given bytes.
    return InetAddress.getByAddress(masked).hostAddress
}

/** Parses a plain IPv6 literal, such as "2001:db8::1", into its eight 16-bit groups. */
private fun parseIpv6Groups(text: String): IntArray? {
    val body = text.removePrefix("[").removeSuffix("]")
    if (':' !in body || '.' in body) return null // not IPv6, or an IPv4-mapped form we don't handle

    val halves = body.split("::", limit = 3)
    if (halves.size > 2) return null // more than one "::" is never valid

    val result = IntArray(8)
    if (halves.size == 2) {
        val head = parseHexGroups(halves[0]) ?: return null
        val tail = parseHexGroups(halves[1]) ?: return null
        if (head.size + tail.size > 8) return null
        head.forEachIndexed { i, v -> result[i] = v }
        tail.forEachIndexed { i, v -> result[8 - tail.size + i] = v }
    } else {
        val all = parseHexGroups(body) ?: return null
        if (all.size != 8) return null
        all.forEachIndexed { i, v -> result[i] = v }
    }
    return result
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
