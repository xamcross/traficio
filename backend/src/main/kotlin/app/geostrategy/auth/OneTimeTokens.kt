package app.geostrategy.auth

import com.mongodb.client.model.Filters.and
import com.mongodb.client.model.Filters.eq
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import org.bson.codecs.pojo.annotations.BsonId
import org.bson.types.ObjectId
import java.time.Duration
import java.time.Instant

enum class TokenPurpose { VERIFY_EMAIL, PASSWORD_RESET }

data class OneTimeToken(
    @BsonId val id: ObjectId = ObjectId(),
    val tokenHash: String,
    val userId: ObjectId,
    val purpose: String,
    val expiresAt: Instant,
)

class OneTimeTokenService(db: MongoDatabase) {
    private val col = db.getCollection<OneTimeToken>("tokens")

    suspend fun issue(userId: ObjectId, purpose: TokenPurpose, ttl: Duration): String {
        val raw = randomToken()
        col.insertOne(
            OneTimeToken(
                tokenHash = sha256Hex(raw),
                userId = userId,
                purpose = purpose.name,
                expiresAt = Instant.now().plus(ttl),
            ),
        )
        return raw
    }

    suspend fun consume(raw: String, purpose: TokenPurpose): ObjectId? {
        val doc = col.findOneAndDelete(
            and(eq("tokenHash", sha256Hex(raw)), eq("purpose", purpose.name)),
        ) ?: return null
        return if (doc.expiresAt.isAfter(Instant.now())) doc.userId else null
    }
}
