package app.geostrategy.users

import app.geostrategy.http.AppException
import com.mongodb.MongoWriteException
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Updates.combine
import com.mongodb.client.model.Updates.set
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.firstOrNull
import org.bson.codecs.pojo.annotations.BsonId
import org.bson.types.ObjectId
import java.time.Instant

data class User(
    @BsonId val id: ObjectId = ObjectId(),
    val email: String,
    val passwordHash: String? = null,
    val googleId: String? = null,
    val emailVerified: Boolean = false,
    val tier: String = "free",
    val createdAt: Instant,
    val updatedAt: Instant,
)

class UserRepository(db: MongoDatabase) {
    private val col = db.getCollection<User>("users")

    suspend fun insert(user: User): User {
        try {
            col.insertOne(user)
        } catch (e: MongoWriteException) {
            if (e.error.code == 11000) {
                throw AppException(HttpStatusCode.Conflict, "email_taken", "An account with this email already exists.")
            }
            throw e
        }
        return user
    }

    suspend fun findByEmail(email: String): User? = col.find(eq("email", email)).firstOrNull()

    suspend fun findById(id: ObjectId): User? = col.find(eq("_id", id)).firstOrNull()

    suspend fun setEmailVerified(id: ObjectId) {
        col.updateOne(eq("_id", id), combine(set("emailVerified", true), set("updatedAt", Instant.now())))
    }

    suspend fun setPasswordHash(id: ObjectId, hash: String) {
        col.updateOne(eq("_id", id), combine(set("passwordHash", hash), set("updatedAt", Instant.now())))
    }

    suspend fun linkGoogle(id: ObjectId, googleId: String) {
        col.updateOne(eq("_id", id), combine(set("googleId", googleId), set("updatedAt", Instant.now())))
    }
}
