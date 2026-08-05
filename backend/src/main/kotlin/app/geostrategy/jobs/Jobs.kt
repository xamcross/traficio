package app.geostrategy.jobs

import com.mongodb.client.model.Filters.and
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Filters.gte
import com.mongodb.client.model.Filters.lt
import com.mongodb.client.model.Filters.ne
import com.mongodb.client.model.Filters.or
import com.mongodb.client.model.FindOneAndUpdateOptions
import com.mongodb.client.model.ReturnDocument
import com.mongodb.client.model.Sorts
import com.mongodb.client.model.Updates.combine
import com.mongodb.client.model.Updates.inc
import com.mongodb.client.model.Updates.set
import com.mongodb.client.model.Updates.unset
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import kotlinx.coroutines.flow.firstOrNull
import org.bson.Document
import org.bson.codecs.pojo.annotations.BsonId
import org.bson.types.ObjectId
import java.time.Instant

data class Job(
    @BsonId val id: ObjectId = ObjectId(),
    val type: String,
    val payload: Document,
    val status: String = "queued",
    val attempts: Int = 0,
    val leasedUntil: Instant? = null,
    val error: String? = null,
    val createdAt: Instant,
    val updatedAt: Instant,
)

class JobQueue(db: MongoDatabase, private val maxAttempts: Int = 2) {
    private val col = db.getCollection<Job>("jobs")

    suspend fun enqueue(type: String, payload: Document): Job {
        val now = Instant.now()
        val job = Job(type = type, payload = payload, createdAt = now, updatedAt = now)
        col.insertOne(job)
        return job
    }

    suspend fun claim(leaseSeconds: Long = 300): Job? {
        val now = Instant.now()
        return col.findOneAndUpdate(
            or(
                eq("status", "queued"),
                and(eq("status", "running"), lt("leasedUntil", now)),
            ),
            combine(
                set("status", "running"),
                set("leasedUntil", now.plusSeconds(leaseSeconds)),
                inc("attempts", 1),
                set("updatedAt", now),
            ),
            FindOneAndUpdateOptions().sort(Sorts.ascending("createdAt")).returnDocument(ReturnDocument.AFTER),
        )
    }

    suspend fun complete(id: ObjectId) {
        col.updateOne(
            and(eq("_id", id), eq("status", "running")),
            combine(set("status", "done"), unset("leasedUntil"), set("updatedAt", Instant.now())),
        )
    }

    suspend fun fail(id: ObjectId, error: String) {
        val now = Instant.now()
        val toFailed = col.updateOne(
            and(eq("_id", id), gte("attempts", maxAttempts), ne("status", "done")),
            combine(set("status", "failed"), set("error", error), unset("leasedUntil"), set("updatedAt", now)),
        )
        if (toFailed.modifiedCount == 0L) {
            col.updateOne(
                and(eq("_id", id), lt("attempts", maxAttempts), ne("status", "done")),
                combine(set("status", "queued"), set("error", error), unset("leasedUntil"), set("updatedAt", now)),
            )
        }
    }

    suspend fun findById(id: ObjectId): Job? = col.find(eq("_id", id)).firstOrNull()
}
