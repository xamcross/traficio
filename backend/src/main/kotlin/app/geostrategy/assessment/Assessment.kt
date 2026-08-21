package app.geostrategy.assessment

import app.geostrategy.claude.AnalysisResult
import app.geostrategy.claude.ClaudeUsage
import app.geostrategy.claude.Finding
import app.geostrategy.claude.ScoreNotes
import app.geostrategy.claude.Scores
import app.geostrategy.crawl.CrawlDigest
import com.mongodb.client.model.Filters.and
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Filters.gte
import com.mongodb.client.model.Filters.ne
import com.mongodb.client.model.Sorts
import com.mongodb.client.model.Updates
import com.mongodb.client.model.Updates.combine
import com.mongodb.client.model.Updates.set
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.toList
import org.bson.codecs.pojo.annotations.BsonId
import org.bson.types.ObjectId
import java.time.Instant

data class Assessment(
    @BsonId val id: ObjectId = ObjectId(),
    val siteId: ObjectId,
    val userId: ObjectId,
    val status: String = "queued",
    val crawlDigest: CrawlDigest? = null,
    val scores: Scores? = null,
    val findings: List<Finding> = emptyList(),
    val summary: String? = null,
    val scoreNotes: ScoreNotes? = null,
    val errorCode: String? = null,
    val errorMessage: String? = null,
    val inputTokens: Long = 0,
    val outputTokens: Long = 0,
    val costUsd: Double = 0.0,
    val createdAt: Instant,
    val updatedAt: Instant,
    val completedAt: Instant? = null,
    /** Null means the result is private. A non-null value is the slug of its public page. */
    val publicSlug: String? = null,
)

val TERMINAL_STATUSES = setOf("ready", "failed")

open class AssessmentRepository(db: MongoDatabase) {
    private val col = db.getCollection<Assessment>("assessments")
    private val newestFirst = Sorts.orderBy(Sorts.descending("createdAt"), Sorts.descending("_id"))

    open suspend fun insert(a: Assessment): Assessment { col.insertOne(a); return a }

    suspend fun delete(id: ObjectId) {
        col.deleteOne(eq("_id", id))
    }

    suspend fun findById(id: ObjectId): Assessment? = col.find(eq("_id", id)).firstOrNull()

    suspend fun findByPublicSlug(slug: String): Assessment? = col.find(eq("publicSlug", slug)).firstOrNull()

    suspend fun listFor(siteId: ObjectId): List<Assessment> =
        col.find(eq("siteId", siteId)).sort(Sorts.descending("createdAt")).toList()

    suspend fun latestFor(siteId: ObjectId): Assessment? =
        col.find(eq("siteId", siteId)).sort(newestFirst).firstOrNull()

    suspend fun latestReadyFor(siteId: ObjectId): Assessment? =
        col.find(and(eq("siteId", siteId), eq("status", "ready"))).sort(newestFirst).firstOrNull()

    suspend fun countNonFailedForUserSince(userId: ObjectId, since: Instant): Long =
        col.countDocuments(and(eq("userId", userId), ne("status", "failed"), gte("createdAt", since)))

    /** The oldest assessment that the monthly quota counts. Mirrors countNonFailedForUserSince. */
    suspend fun oldestNonFailedForUserSince(userId: ObjectId, since: Instant): Assessment? =
        col.find(and(eq("userId", userId), ne("status", "failed"), gte("createdAt", since)))
            .sort(Sorts.orderBy(Sorts.ascending("createdAt"), Sorts.ascending("_id")))
            .firstOrNull()

    suspend fun anyNonFailedFor(siteId: ObjectId): Boolean =
        col.find(and(eq("siteId", siteId), ne("status", "failed"))).firstOrNull() != null

    suspend fun setStatus(id: ObjectId, status: String) {
        col.updateOne(eq("_id", id), combine(set("status", status), set("updatedAt", Instant.now())))
    }

    /** Stores the slug that makes a ready assessment public. Call is idempotent by slug value. */
    suspend fun setPublicSlug(id: ObjectId, slug: String) {
        col.updateOne(eq("_id", id), combine(set("publicSlug", slug), set("updatedAt", Instant.now())))
    }

    /** Clears the public slug, so the result goes private again. Safe to call more than once. */
    suspend fun clearPublicSlug(id: ObjectId) {
        col.updateOne(eq("_id", id), combine(set("publicSlug", null), set("updatedAt", Instant.now())))
    }

    suspend fun saveCrawl(id: ObjectId, digest: CrawlDigest) {
        col.updateOne(eq("_id", id), combine(set("crawlDigest", digest), set("updatedAt", Instant.now())))
    }

    suspend fun saveAnalysis(id: ObjectId, analysis: AnalysisResult, usage: ClaudeUsage) {
        col.updateOne(
            eq("_id", id),
            combine(
                set("scores", analysis.scores),
                set("findings", analysis.findings),
                set("summary", analysis.summary),
                set("scoreNotes", analysis.scoreNotes),
                Updates.inc("inputTokens", usage.inputTokens),
                Updates.inc("outputTokens", usage.outputTokens),
                set("updatedAt", Instant.now()),
            ),
        )
    }

    suspend fun addUsage(id: ObjectId, usage: ClaudeUsage) {
        col.updateOne(
            eq("_id", id),
            combine(
                Updates.inc("inputTokens", usage.inputTokens),
                Updates.inc("outputTokens", usage.outputTokens),
                set("updatedAt", Instant.now()),
            ),
        )
    }

    suspend fun markReady(id: ObjectId) {
        val now = Instant.now()
        val doc = findById(id) ?: return
        val costUsd = ClaudeUsage(doc.inputTokens, doc.outputTokens).costUsd()
        col.updateOne(
            eq("_id", id),
            combine(
                set("status", "ready"),
                set("costUsd", costUsd),
                set("completedAt", now),
                set("updatedAt", now),
            ),
        )
    }

    suspend fun markFailed(id: ObjectId, code: String, message: String) {
        val now = Instant.now()
        val doc = findById(id)
        val costUsd = ClaudeUsage(doc?.inputTokens ?: 0, doc?.outputTokens ?: 0).costUsd()
        col.updateOne(
            eq("_id", id),
            combine(
                set("status", "failed"),
                set("errorCode", code),
                set("errorMessage", message),
                set("costUsd", costUsd),
                set("completedAt", now),
                set("updatedAt", now),
            ),
        )
    }
}
