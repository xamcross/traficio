package app.geostrategy.auth

import app.geostrategy.AppDeps
import app.geostrategy.email.verifyEmailHtml
import app.geostrategy.http.AppException
import app.geostrategy.users.User
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import kotlinx.serialization.Serializable
import java.time.Duration
import java.time.Instant

private val EMAIL_REGEX = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")

@Serializable data class OkResponse(val ok: Boolean = true)
@Serializable data class UserDto(val id: String, val email: String, val emailVerified: Boolean, val tier: String)
@Serializable data class RegisterRequest(val email: String, val password: String)

fun User.toDto() = UserDto(id = id.toHexString(), email = email, emailVerified = emailVerified, tier = tier)

fun Route.authRoutes(deps: AppDeps) {
    post("/v1/auth/register") {
        val body = call.receive<RegisterRequest>()
        val email = body.email.trim().lowercase()
        if (!EMAIL_REGEX.matches(email)) {
            throw AppException(HttpStatusCode.BadRequest, "invalid_email", "That doesn't look like an email address.")
        }
        if (body.password.length < 8) {
            throw AppException(HttpStatusCode.BadRequest, "weak_password", "Your password must be at least 8 characters.")
        }
        val now = Instant.now()
        val user = deps.users.insert(
            User(email = email, passwordHash = deps.passwordHasher.hash(body.password), createdAt = now, updatedAt = now),
        )
        val token = deps.tokens.issue(user.id, TokenPurpose.VERIFY_EMAIL, Duration.ofHours(24))
        deps.emailSender.send(email, "Confirm your GeoStrategy email", verifyEmailHtml(deps.config.appUrl, token))
        call.respond(HttpStatusCode.Created, OkResponse())
    }
}
