package app.geostrategy.users

import app.geostrategy.http.AppException
import com.mongodb.MongoWriteException
import com.mongodb.client.model.Filters.and
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Filters.lte
import com.mongodb.client.model.Filters.or
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
    // The `created` time of the last Freemius event that changed this record. BillingService
    // compares this time to a new event's own time. The check stops an older event from
    // overwriting a newer billing state.
    val lastEventAt: Instant? = null,
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

    /**
     * Sets the tier and the freemius info. The write applies only when the account's stored
     * `lastEventAt` is empty, or not after `eventTime`. The read of the old value and the
     * write happen in one atomic Mongo command.
     *
     * Two events for the same account can then not race past a stale read. The first write to
     * reach Mongo wins. The other write's filter then fails. The return value tells the
     * caller whether the write happened.
     */
    suspend fun setBillingIfNewer(id: ObjectId, tier: String, info: FreemiusInfo, eventTime: Instant?): Boolean {
        val filter = if (eventTime == null) {
            eq("_id", id)
        } else {
            and(eq("_id", id), or(eq("freemius.lastEventAt", null), lte("freemius.lastEventAt", eventTime)))
        }
        val update = combine(set("tier", tier), set("freemius", info), set("updatedAt", Instant.now()))
        return col.updateOne(filter, update).modifiedCount > 0
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
