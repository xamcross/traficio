package app.geostrategy

import app.geostrategy.assessment.AssessmentPipeline
import app.geostrategy.assessment.AssessmentRepository
import app.geostrategy.assessment.SsrfGuard
import app.geostrategy.assessment.assessmentRoutes
import app.geostrategy.auth.OneTimeTokenService
import app.geostrategy.auth.PasswordHasher
import app.geostrategy.auth.RealGoogleIdentityClient
import app.geostrategy.auth.SessionService
import app.geostrategy.auth.authRoutes
import app.geostrategy.auth.googleAuthRoutes
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.claude.ClaudeClient
import app.geostrategy.claude.RealClaudeClient
import app.geostrategy.config.AppConfig
import app.geostrategy.crawl.Crawler
import app.geostrategy.crawl.HttpFetcher
import app.geostrategy.email.LoggingEmailSender
import app.geostrategy.email.ResendEmailSender
import app.geostrategy.http.installCors
import app.geostrategy.http.installErrorHandling
import app.geostrategy.jobs.JobQueue
import app.geostrategy.jobs.JobWorker
import app.geostrategy.persistence.ensureIndexes
import app.geostrategy.plans.PlanRepository
import app.geostrategy.sites.SiteRepository
import app.geostrategy.sites.siteRoutes
import app.geostrategy.users.UserRepository
import com.mongodb.kotlin.client.coroutine.MongoClient
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.calllogging.CallLogging
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation as ClientContentNegotiation

fun main() {
    val config = AppConfig.fromEnv()
    val mongo = MongoClient.create(config.mongoUri)
    val db = mongo.getDatabase(config.mongoDatabase)
    runBlocking { ensureIndexes(db) }

    val httpClient = HttpClient(CIO) {
        install(ClientContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
    }
    val deps = AppDeps(
        config = config,
        users = UserRepository(db),
        tokens = OneTimeTokenService(db),
        sessions = SessionService(db),
        passwordHasher = PasswordHasher(),
        emailSender = config.resendApiKey?.let { ResendEmailSender(it, config.emailFrom, httpClient) } ?: LoggingEmailSender(),
        googleIdentity = if (config.googleClientId != null && config.googleClientSecret != null) {
            RealGoogleIdentityClient(config.googleClientId, config.googleClientSecret, httpClient)
        } else null,
        sites = SiteRepository(db),
        jobs = JobQueue(db),
        assessments = AssessmentRepository(db),
        plans = PlanRepository(db),
        ssrf = SsrfGuard(),
    )

    val claudeLog = LoggerFactory.getLogger("app.geostrategy.claude")
    val claude: ClaudeClient = config.anthropicApiKey
        ?.let { RealClaudeClient(it, config.claudeModel) }
        ?: CannedClaudeClient().also {
            claudeLog.warn("ANTHROPIC_API_KEY is not set. Assessments use the canned Claude client.")
        }
    val crawler = Crawler(HttpFetcher(httpClient))
    val pipeline = AssessmentPipeline(deps.assessments, deps.sites, deps.plans, crawler, claude)
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    JobWorker(deps.jobs, mapOf("assessment" to pipeline::handle)).start(appScope)

    embeddedServer(Netty, port = config.port) { appModule(deps) }.start(wait = true)
}

fun Application.appModule(deps: AppDeps) {
    install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true; encodeDefaults = true }) }
    install(CallLogging)
    installErrorHandling()
    installCors(deps.config)
    routing {
        get("/healthz") { call.respondText("ok") }
        authRoutes(deps)
        googleAuthRoutes(deps)
        siteRoutes(deps)
        assessmentRoutes(deps)
    }
}
