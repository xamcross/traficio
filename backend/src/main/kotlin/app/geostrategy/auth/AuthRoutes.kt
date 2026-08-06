package app.geostrategy.auth

import app.geostrategy.AppDeps
import app.geostrategy.email.resetEmailHtml
import app.geostrategy.email.verifyEmailHtml
import app.geostrategy.http.AppException
import app.geostrategy.users.User
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import kotlinx.serialization.Serializable
import java.time.Duration
import java.time.Instant

private val EMAIL_REGEX = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")

@Serializable data class OkResponse(val ok: Boolean = true)
@Serializable data class UserDto(val id: String, val email: String, val emailVerified: Boolean, val tier: String)
@Serializable data class UsageResponse(val assessmentsUsed: Int, val assessmentsLimit: Int, val sitesUsed: Int, val sitesLimit: Int)
@Serializable data class RegisterRequest(val email: String, val password: String)
@Serializable data class VerifyEmailRequest(val token: String)
@Serializable data class LoginRequest(val email: String, val password: String)
@Serializable data class ResetRequest(val email: String)
@Serializable data class ResetConfirmRequest(val token: String, val newPassword: String)

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

    post("/v1/auth/verify-email") {
        val body = call.receive<VerifyEmailRequest>()
        val userId = deps.tokens.consume(body.token, TokenPurpose.VERIFY_EMAIL)
            ?: throw AppException(HttpStatusCode.BadRequest, "invalid_token", "This link is invalid or has expired. Please request a new one.")
        deps.users.setEmailVerified(userId)
        call.respond(OkResponse())
    }

    post("/v1/auth/login") {
        val body = call.receive<LoginRequest>()
        val invalid = AppException(HttpStatusCode.Unauthorized, "invalid_credentials", "Email or password is incorrect.")
        val user = deps.users.findByEmail(body.email.trim().lowercase()) ?: throw invalid
        val hash = user.passwordHash ?: throw invalid
        if (!deps.passwordHasher.verify(hash, body.password)) throw invalid
        val raw = deps.sessions.create(user.id)
        call.setSessionCookie(raw, deps.config)
        call.respond(user.toDto())
    }

    get("/v1/me") {
        call.respond(call.requireUser(deps).toDto())
    }

    get("/v1/me/usage") {
        val user = call.requireUser(deps)
        // Mirrors the gates exactly, so the meter always matches enforcement:
        // assessment quota gate in AssessmentRoutes.kt, site cap gate in SiteRoutes.kt.
        val assessmentsUsed = deps.assessments.countNonFailedForUserSince(user.id, Instant.now().minus(Duration.ofDays(30)))
        val assessmentsLimit = deps.config.tierLimits.assessmentsPerMonthFor(user.tier)
        val sitesUsed = deps.sites.countFor(user.id)
        val sitesLimit = deps.config.tierLimits.maxSitesFor(user.tier)
        call.respond(UsageResponse(assessmentsUsed.toInt(), assessmentsLimit, sitesUsed.toInt(), sitesLimit))
    }

    post("/v1/auth/logout") {
        call.request.cookies[SESSION_COOKIE]?.let { deps.sessions.revoke(it) }
        call.clearSessionCookie(deps.config)
        call.respond(HttpStatusCode.NoContent)
    }

    post("/v1/auth/resend-verification") {
        val user = call.requireUser(deps)
        if (!user.emailVerified) {
            val token = deps.tokens.issue(user.id, TokenPurpose.VERIFY_EMAIL, Duration.ofHours(24))
            deps.emailSender.send(user.email, "Confirm your GeoStrategy email", verifyEmailHtml(deps.config.appUrl, token))
        }
        call.respond(HttpStatusCode.Accepted, OkResponse())
    }

    post("/v1/auth/password-reset/request") {
        val body = call.receive<ResetRequest>()
        val user = deps.users.findByEmail(body.email.trim().lowercase())
        if (user != null) {
            val token = deps.tokens.issue(user.id, TokenPurpose.PASSWORD_RESET, Duration.ofHours(1))
            deps.emailSender.send(user.email, "Reset your GeoStrategy password", resetEmailHtml(deps.config.appUrl, token))
        }
        call.respond(HttpStatusCode.Accepted, OkResponse())
    }

    post("/v1/auth/password-reset/confirm") {
        val body = call.receive<ResetConfirmRequest>()
        if (body.newPassword.length < 8) {
            throw AppException(HttpStatusCode.BadRequest, "weak_password", "Your password must be at least 8 characters.")
        }
        val userId = deps.tokens.consume(body.token, TokenPurpose.PASSWORD_RESET)
            ?: throw AppException(HttpStatusCode.BadRequest, "invalid_token", "This link is invalid or has expired. Please request a new one.")
        deps.users.setPasswordHash(userId, deps.passwordHasher.hash(body.newPassword))
        deps.sessions.revokeAllFor(userId)
        call.respond(OkResponse())
    }
}
