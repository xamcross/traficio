package app.geostrategy.config

data class AppConfig(
    val port: Int,
    val mongoUri: String,
    val mongoDatabase: String,
    val baseUrl: String,          // public API origin, e.g. https://api.geostrategy.app
    val appUrl: String,           // SPA origin, e.g. https://app.geostrategy.app
    val cookieDomain: String?,    // e.g. .geostrategy.app; null in dev
    val secureCookies: Boolean,
    val resendApiKey: String?,
    val emailFrom: String,
    val googleClientId: String?,
    val googleClientSecret: String?,
) {
    companion object {
        fun fromEnv(env: Map<String, String> = System.getenv()): AppConfig {
            val baseUrl = env["BASE_URL"] ?: "http://localhost:8080"
            return AppConfig(
                port = env["PORT"]?.toInt() ?: 8080,
                mongoUri = env["MONGODB_URI"] ?: "mongodb://localhost:27017",
                mongoDatabase = env["MONGODB_DB"] ?: "geostrategy",
                baseUrl = baseUrl,
                appUrl = env["APP_URL"] ?: "http://localhost:4200",
                cookieDomain = env["COOKIE_DOMAIN"],
                secureCookies = baseUrl.startsWith("https://"),
                resendApiKey = env["RESEND_API_KEY"],
                emailFrom = env["EMAIL_FROM"] ?: "GeoStrategy <noreply@geostrategy.app>",
                googleClientId = env["GOOGLE_CLIENT_ID"],
                googleClientSecret = env["GOOGLE_CLIENT_SECRET"],
            )
        }
    }
}
