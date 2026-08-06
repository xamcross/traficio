package app.geostrategy.users

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

data class FreemiusInfo(
    val userId: String? = null,
    val licenseId: String? = null,
    val planId: String? = null,
    val subscriptionStatus: String? = null,
    val expiresAt: Instant? = null,
)

data class User(
    @BsonId val id: ObjectId = ObjectId(),
    val email: String,
    val passwordHash: String? = null,
    val googleId: String? = null,
    val emailVerified: Boolean = false,
    val tier: String = "free",
    val freemius: FreemiusInfo? = null,
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

    suspend fun setBilling(id: ObjectId, tier: String, info: FreemiusInfo?) {
        col.updateOne(
            eq("_id", id),
            combine(set("tier", tier), set("freemius", info), set("updatedAt", Instant.now())),
        )
    }

    suspend fun listByTier(tier: String): List<User> = col.find(eq("tier", tier)).toList()

    /**
     * Downgrades a pro user to free, but only if the stored billing state still matches what
     * the caller last observed (licenseId and expiresAt). This closes the race where a
     * renewal webhook lands between the revalidator's read and its write: the conditional
     * filter fails, the write is a no-op, and the renewal survives. Only tier and
     * subscriptionStatus are set, so other freemius fields written concurrently (and matched
     * by the filter) are left untouched. Returns whether a document was actually modified.
     */
    suspend fun downgradeProIfMatches(id: ObjectId, expectedLicenseId: String?, expectedExpiresAt: Instant?): Boolean {
        val filter = and(
            eq("_id", id),
            eq("tier", "pro"),
            eq("freemius.licenseId", expectedLicenseId),
            eq("freemius.expiresAt", expectedExpiresAt),
        )
        val update = combine(
            set("tier", "free"),
            set("freemius.subscriptionStatus", "expired"),
            set("updatedAt", Instant.now()),
        )
        val result = col.updateOne(filter, update)
        return result.modifiedCount > 0
    }
}
