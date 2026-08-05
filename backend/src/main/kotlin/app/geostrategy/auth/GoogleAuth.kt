package app.geostrategy.auth

import app.geostrategy.AppDeps
import app.geostrategy.http.AppException
import app.geostrategy.users.User
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.forms.submitForm
import io.ktor.http.Cookie
import io.ktor.http.HttpStatusCode
import io.ktor.http.URLBuilder
import io.ktor.http.isSuccess
import io.ktor.http.parameters
import io.ktor.server.response.respondRedirect
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import java.util.Base64

data class GoogleIdentity(val subject: String, val email: String, val emailVerified: Boolean)

interface GoogleIdentityClient {
    suspend fun exchange(code: String, redirectUri: String): GoogleIdentity
}

@Serializable
private data class GoogleTokenResponse(@SerialName("id_token") val idToken: String)

/**
 * Exchanges the OAuth code at Google's token endpoint and reads the id_token payload.
 * The payload is trusted without signature verification because it is received
 * directly from Google's token endpoint over TLS (per OIDC Core 3.1.3.7 note).
 */
class RealGoogleIdentityClient(
    private val clientId: String,
    private val clientSecret: String,
    private val http: HttpClient,
) : GoogleIdentityClient {
    override suspend fun exchange(code: String, redirectUri: String): GoogleIdentity {
        val res = http.submitForm(
            url = "https://oauth2.googleapis.com/token",
            formParameters = parameters {
                append("code", code)
                append("client_id", clientId)
                append("client_secret", clientSecret)
                append("redirect_uri", redirectUri)
                append("grant_type", "authorization_code")
            },
        )
        check(res.status.isSuccess()) { "Google token exchange failed: HTTP ${res.status.value}" }
        val idToken = res.body<GoogleTokenResponse>().idToken
        val payloadJson = String(Base64.getUrlDecoder().decode(idToken.split(".")[1]))
        val payload = Json.parseToJsonElement(payloadJson).jsonObject
        return GoogleIdentity(
            subject = payload["sub"]!!.jsonPrimitive.content,
            email = payload["email"]!!.jsonPrimitive.content.lowercase(),
            emailVerified = payload["email_verified"]?.jsonPrimitive?.content == "true",
        )
    }
}

private const val STATE_COOKIE = "gs_oauth_state"

fun Route.googleAuthRoutes(deps: AppDeps) {
    val google = deps.googleIdentity
    val redirectUri = "${deps.config.baseUrl}/v1/auth/google/callback"

    get("/v1/auth/google/start") {
        if (google == null) throw AppException(HttpStatusCode.NotFound, "google_disabled", "Google sign-in is not available.")
        val state = randomToken()
        call.response.cookies.append(
            Cookie(
                name = STATE_COOKIE, value = state, path = "/", httpOnly = true,
                secure = deps.config.secureCookies, maxAge = 600, extensions = mapOf("SameSite" to "Lax"),
            ),
        )
        val url = URLBuilder("https://accounts.google.com/o/oauth2/v2/auth").apply {
            parameters.append("client_id", deps.config.googleClientId ?: "test-client-id")
            parameters.append("redirect_uri", redirectUri)
            parameters.append("response_type", "code")
            parameters.append("scope", "openid email")
            parameters.append("state", state)
        }.buildString()
        call.respondRedirect(url)
    }

    get("/v1/auth/google/callback") {
        if (google == null) throw AppException(HttpStatusCode.NotFound, "google_disabled", "Google sign-in is not available.")
        val state = call.request.queryParameters["state"]
        val cookieState = call.request.cookies[STATE_COOKIE]
        if (state == null || state != cookieState) {
            throw AppException(HttpStatusCode.BadRequest, "oauth_state_mismatch", "Sign-in session expired. Please try again.")
        }
        val code = call.request.queryParameters["code"]
            ?: throw AppException(HttpStatusCode.BadRequest, "oauth_missing_code", "Google didn't complete sign-in. Please try again.")

        val identity = google.exchange(code, redirectUri)
        val existing = deps.users.findByEmail(identity.email)
        if (existing != null && !identity.emailVerified) {
            throw AppException(
                HttpStatusCode.Forbidden,
                "google_email_unverified",
                "Google hasn't verified this email address. Please verify it with Google first, or log in with your password.",
            )
        }
        val user = if (existing != null) {
            if (existing.googleId == null) deps.users.linkGoogle(existing.id, identity.subject)
            existing
        } else {
            val now = Instant.now()
            deps.users.insert(
                User(
                    email = identity.email, googleId = identity.subject,
                    emailVerified = identity.emailVerified, createdAt = now, updatedAt = now,
                ),
            )
        }
        val raw = deps.sessions.create(user.id)
        call.setSessionCookie(raw, deps.config)
        call.respondRedirect("${deps.config.appUrl}/auth/complete")
    }
}
