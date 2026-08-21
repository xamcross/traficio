package app.geostrategy

import app.geostrategy.assessment.AssessmentRepository
import app.geostrategy.assessment.SsrfGuard
import app.geostrategy.auth.GoogleIdentityClient
import app.geostrategy.auth.OneTimeTokenService
import app.geostrategy.auth.PasswordHasher
import app.geostrategy.auth.SessionService
import app.geostrategy.billing.BillingService
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.claude.ClaudeClient
import app.geostrategy.config.AppConfig
import app.geostrategy.crawl.Crawler
import app.geostrategy.email.EmailSender
import app.geostrategy.jobs.JobQueue
import app.geostrategy.persistence.ensureIndexes
import app.geostrategy.plans.PlanRepository
import app.geostrategy.preview.PreviewRateLimiter
import app.geostrategy.sites.SiteRepository
import app.geostrategy.users.UserRepository
import com.mongodb.kotlin.client.coroutine.MongoClient
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import io.ktor.client.HttpClient
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.coroutines.runBlocking
import org.testcontainers.containers.MongoDBContainer
import java.util.UUID

/**
 * Test database. Local runs start one shared Testcontainers Mongo. CI sets
 * MONGODB_TEST_URI to the workflow's Mongo service container. Each test class
 * gets its own database name, so the two modes isolate tests the same way.
 */
object TestMongo {
    private val container: MongoDBContainer by lazy {
        MongoDBContainer("mongo:7.0").also { it.start() }
    }
    private val connectionString: String by lazy {
        System.getenv("MONGODB_TEST_URI")?.takeIf { it.isNotBlank() } ?: container.connectionString
    }
    private val client: MongoClient by lazy { MongoClient.create(connectionString) }

    fun freshDb(): MongoDatabase {
        val db = client.getDatabase("t" + UUID.randomUUID().toString().replace("-", ""))
        runBlocking { ensureIndexes(db) }
        return db
    }
}

class RecordingEmailSender : app.geostrategy.email.EmailSender {
    data class Sent(val to: String, val subject: String, val html: String)
    val sent = mutableListOf<Sent>()
    override suspend fun send(to: String, subject: String, html: String) {
        sent.add(Sent(to, subject, html))
    }
}

fun extractToken(html: String): String =
    Regex("token=([A-Za-z0-9_-]+)").find(html)?.groupValues?.get(1)
        ?: error("no token found in email html")

fun testDeps(
    db: MongoDatabase,
    email: EmailSender = RecordingEmailSender(),
    google: GoogleIdentityClient? = null,
    env: Map<String, String> = emptyMap(),
    sites: SiteRepository = SiteRepository(db),
    assessments: AssessmentRepository = AssessmentRepository(db),
    ssrf: SsrfGuard = SsrfGuard { listOf(java.net.InetAddress.getByName("93.184.216.34")) },
    claude: ClaudeClient = CannedClaudeClient(),
    // No pages by default: only a test that exercises the preview endpoint needs a
    // crawler with real page content, and it supplies its own.
    previewCrawler: Crawler = Crawler(MapFetcher(emptyMap()), pageCap = 5),
    previewLimiter: PreviewRateLimiter = PreviewRateLimiter(db),
): AppDeps {
    val config = AppConfig.fromEnv(env)
    val users = UserRepository(db)
    return AppDeps(
        config = config,
        users = users,
        tokens = OneTimeTokenService(db),
        sessions = SessionService(db),
        passwordHasher = PasswordHasher(),
        emailSender = email,
        googleIdentity = google,
        sites = sites,
        jobs = JobQueue(db),
        assessments = assessments,
        plans = PlanRepository(db),
        ssrf = ssrf,
        billing = config.freemiusSecretKey?.let { BillingService(users, config.freemiusProPlanId) },
        claude = claude,
        previewCrawler = previewCrawler,
        previewLimiter = previewLimiter,
    )
}

suspend fun registerAndLogin(
    http: HttpClient,
    email: String,
    password: String = "correct-horse",
) {
    http.post("/v1/auth/register") {
        contentType(ContentType.Application.Json)
        setBody("""{"email":"$email","password":"$password"}""")
    }
    http.post("/v1/auth/login") {
        contentType(ContentType.Application.Json)
        setBody("""{"email":"$email","password":"$password"}""")
    }
}

suspend fun registerVerifyLogin(
    http: HttpClient,
    emails: RecordingEmailSender,
    email: String,
    password: String = "correct-horse",
) {
    registerAndLogin(http, email, password)
    val token = extractToken(emails.sent.last().html)
    http.post("/v1/auth/verify-email") {
        contentType(ContentType.Application.Json)
        setBody("""{"token":"$token"}""")
    }
}

class MapFetcher(private val pages: Map<String, String>) : app.geostrategy.crawl.Fetcher {
    override suspend fun fetch(url: String): app.geostrategy.crawl.FetchResult? =
        pages[url]?.let { app.geostrategy.crawl.FetchResult(url, 200, "text/html", it) }
}

/** Sets the user's tier to pro directly in the database. Billing is out of scope for these tests. */
suspend fun makePro(db: MongoDatabase, email: String) {
    db.getCollection<app.geostrategy.users.User>("users")
        .updateOne(com.mongodb.client.model.Filters.eq("email", email), com.mongodb.client.model.Updates.set("tier", "pro"))
}
