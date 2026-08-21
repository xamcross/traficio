package app.geostrategy

import app.geostrategy.assessment.AssessmentRepository
import app.geostrategy.assessment.SsrfGuard
import app.geostrategy.auth.GoogleIdentityClient
import app.geostrategy.auth.OneTimeTokenService
import app.geostrategy.auth.PasswordHasher
import app.geostrategy.auth.SessionService
import app.geostrategy.billing.BillingService
import app.geostrategy.claude.ClaudeClient
import app.geostrategy.config.AppConfig
import app.geostrategy.crawl.Crawler
import app.geostrategy.email.EmailSender
import app.geostrategy.jobs.JobQueue
import app.geostrategy.plans.PlanRepository
import app.geostrategy.preview.PreviewRateLimiter
import app.geostrategy.sites.SiteRepository
import app.geostrategy.users.UserRepository
import kotlinx.coroutines.sync.Semaphore

class AppDeps(
    val config: AppConfig,
    val users: UserRepository,
    val tokens: OneTimeTokenService,
    val sessions: SessionService,
    val passwordHasher: PasswordHasher,
    val emailSender: EmailSender,
    val googleIdentity: GoogleIdentityClient?,
    val sites: SiteRepository,
    val jobs: JobQueue,
    val assessments: AssessmentRepository,
    val plans: PlanRepository,
    val ssrf: SsrfGuard,
    val billing: BillingService?,
    /** The full assessment's model client. The preview route never reads this field. */
    val claude: ClaudeClient,
    /** A crawler with a small page cap, for the anonymous preview only. */
    val previewCrawler: Crawler,
    val previewLimiter: PreviewRateLimiter,
    /**
     * Bounds concurrent preview crawls on this machine. The same machine runs JobWorker for
     * paying customers, so the free, unauthenticated preview must not be able to starve it.
     */
    val previewSemaphore: Semaphore = Semaphore(3),
)
