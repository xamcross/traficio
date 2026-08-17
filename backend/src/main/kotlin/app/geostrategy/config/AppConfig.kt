package app.geostrategy.config

data class TierLimits(
    val freeMaxSites: Int,
    val freeAssessmentsPerMonth: Int,
    val proMaxSites: Int,
    val proAssessmentsPerMonth: Int,
) {
    fun maxSitesFor(tier: String) = if (tier == "pro") proMaxSites else freeMaxSites
    fun assessmentsPerMonthFor(tier: String) = if (tier == "pro") proAssessmentsPerMonth else freeAssessmentsPerMonth
}

data class AppConfig(
    val port: Int,
    val mongoUri: String,
    val mongoDatabase: String,
    val baseUrl: String,          // public API origin, e.g. https://api.geostrategy.app
    val appUrl: String,           // SPA origin, e.g. https://app.geostrategy.app
    val cookieDomain: String?,    // e.g. geostrategy.app, with no leading dot; null in dev
    val secureCookies: Boolean,
    val resendApiKey: String?,
    val emailFrom: String,
    val googleClientId: String?,
    val googleClientSecret: String?,
    val anthropicApiKey: String?,
    val claudeModel: String,
    val tierLimits: TierLimits,
    val freemiusSecretKey: String?,
    val freemiusProPlanId: String?,
    val freemiusSignatureHeader: String,
    val sseMaxMillis: Long,
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
                anthropicApiKey = env["ANTHROPIC_API_KEY"],
                claudeModel = env["CLAUDE_MODEL"] ?: "claude-opus-5",
                tierLimits = TierLimits(
                    freeMaxSites = env["FREE_MAX_SITES"]?.toInt() ?: 1,
                    freeAssessmentsPerMonth = env["FREE_ASSESSMENTS_PER_MONTH"]?.toInt() ?: 1,
                    proMaxSites = env["PRO_MAX_SITES"]?.toInt() ?: 5,
                    proAssessmentsPerMonth = env["PRO_ASSESSMENTS_PER_MONTH"]?.toInt() ?: 10,
                ),
                freemiusSecretKey = env["FREEMIUS_SECRET_KEY"],
                freemiusProPlanId = env["FREEMIUS_PRO_PLAN_ID"],
                freemiusSignatureHeader = env["FREEMIUS_SIGNATURE_HEADER"] ?: "X-Signature",
                sseMaxMillis = env["SSE_MAX_MILLIS"]?.toLong() ?: 900_000L,
            )
        }
    }
}
