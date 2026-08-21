package app.geostrategy.preview

import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.FindOneAndUpdateOptions
import com.mongodb.client.model.ReturnDocument
import com.mongodb.client.model.Updates.combine
import com.mongodb.client.model.Updates.inc
import com.mongodb.client.model.Updates.setOnInsert
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import org.bson.codecs.pojo.annotations.BsonId
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
        val now = Instant.now()
        val windowStart = now.epochSecond - now.epochSecond % windowSeconds
        val windowEnd = windowStart + windowSeconds
        val bucket = col.findOneAndUpdate(
            eq("_id", "$address:$windowStart"),
            combine(inc("count", 1), setOnInsert("expiresAt", Instant.ofEpochSecond(windowEnd))),
            FindOneAndUpdateOptions().upsert(true).returnDocument(ReturnDocument.AFTER),
        )
        val count = bucket?.count ?: 1
        return if (count > limit) windowEnd - now.epochSecond else null
    }
}
