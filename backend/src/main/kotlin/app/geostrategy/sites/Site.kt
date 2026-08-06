package app.geostrategy.sites

import app.geostrategy.claude.Scores
import app.geostrategy.http.AppException
import com.mongodb.MongoWriteException
import com.mongodb.client.model.Filters.and
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Updates.combine
import com.mongodb.client.model.Updates.set
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.toList
import org.bson.codecs.pojo.annotations.BsonId
import org.bson.types.ObjectId
import java.time.Instant

data class Site(
    @BsonId val id: ObjectId = ObjectId(),
    val userId: ObjectId,
    val domain: String,
    val url: String,
    val platform: String? = null,
    val latestScores: Scores? = null,
    val createdAt: Instant,
    val updatedAt: Instant,
)

open class SiteRepository(db: MongoDatabase) {
    private val col = db.getCollection<Site>("sites")

    open suspend fun insert(site: Site): Site {
        try {
            col.insertOne(site)
        } catch (e: MongoWriteException) {
            if (e.error.code == 11000) {
                throw AppException(HttpStatusCode.Conflict, "site_exists", "You've already added this site.")
            }
            throw e
        }
        return site
    }

    suspend fun findById(id: ObjectId): Site? = col.find(eq("_id", id)).firstOrNull()

    suspend fun listFor(userId: ObjectId): List<Site> = col.find(eq("userId", userId)).toList()

    suspend fun countFor(userId: ObjectId): Long = col.countDocuments(eq("userId", userId))

    suspend fun delete(id: ObjectId) {
        col.deleteOne(eq("_id", id))
    }

    suspend fun updateAfterAssessment(id: ObjectId, platform: String, scores: Scores) {
        col.updateOne(
            eq("_id", id),
            combine(set("platform", platform), set("latestScores", scores), set("updatedAt", Instant.now())),
        )
    }
}
