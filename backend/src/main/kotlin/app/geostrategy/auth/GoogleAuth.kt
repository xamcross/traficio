package app.geostrategy.auth

data class GoogleIdentity(val subject: String, val email: String, val emailVerified: Boolean)

interface GoogleIdentityClient {
    suspend fun exchange(code: String, redirectUri: String): GoogleIdentity
}
