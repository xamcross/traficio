package app.geostrategy.auth

import app.geostrategy.AppDeps
import app.geostrategy.config.AppConfig
import app.geostrategy.http.AppException
import app.geostrategy.users.User
import com.mongodb.client.model.Filters.and
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Filters.gt
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import io.ktor.http.Cookie
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import kotlinx.coroutines.flow.firstOrNull
import org.bson.codecs.pojo.annotations.BsonId
import org.bson.types.ObjectId
import java.time.Duration
import java.time.Instant

const val SESSION_COOKIE = "gs_session"
private val SESSION_TTL: Duration = Duration.ofDays(30)

data class Session(
    @BsonId val id: ObjectId = ObjectId(),
    val tokenHash: String,
    val userId: ObjectId,
    val expiresAt: Instant,
    val createdAt: Instant,
)

class SessionService(db: MongoDatabase) {
    private val col = db.getCollection<Session>("sessions")

    suspend fun create(userId: ObjectId): String {
        val raw = randomToken()
        val now = Instant.now()
        col.insertOne(Session(tokenHash = sha256Hex(raw), userId = userId, expiresAt = now.plus(SESSION_TTL), createdAt = now))
        return raw
    }

    suspend fun userIdFor(raw: String): ObjectId? =
        col.find(and(eq("tokenHash", sha256Hex(raw)), gt("expiresAt", Instant.now())))
            .firstOrNull()?.userId

    suspend fun revoke(raw: String) {
        col.deleteOne(eq("tokenHash", sha256Hex(raw)))
    }

    suspend fun revokeAllFor(userId: ObjectId) {
        col.deleteMany(eq("userId", userId))
    }
}

fun ApplicationCall.setSessionCookie(raw: String, config: AppConfig) {
    response.cookies.append(
        Cookie(
            name = SESSION_COOKIE, value = raw, path = "/",
            httpOnly = true, secure = config.secureCookies, domain = config.cookieDomain,
            maxAge = SESSION_TTL.seconds.toInt(),
            extensions = mapOf("SameSite" to "Lax"),
        ),
    )
}

fun ApplicationCall.clearSessionCookie(config: AppConfig) {
    response.cookies.append(
        Cookie(
            name = SESSION_COOKIE, value = "", path = "/",
            httpOnly = true, secure = config.secureCookies, domain = config.cookieDomain,
            maxAge = 0,
            extensions = mapOf("SameSite" to "Lax"),
        ),
    )
}

suspend fun ApplicationCall.requireUser(deps: AppDeps): User {
    val unauthenticated = AppException(
        HttpStatusCode.Unauthorized, "unauthenticated", "Please log in.",
    )
    val raw = request.cookies[SESSION_COOKIE] ?: throw unauthenticated
    val userId = deps.sessions.userIdFor(raw) ?: throw unauthenticated
    return deps.users.findById(userId) ?: throw unauthenticated
}
