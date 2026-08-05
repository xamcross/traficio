package app.geostrategy

import app.geostrategy.assessment.AssessmentRepository
import app.geostrategy.assessment.SsrfGuard
import app.geostrategy.auth.GoogleIdentityClient
import app.geostrategy.auth.OneTimeTokenService
import app.geostrategy.auth.PasswordHasher
import app.geostrategy.auth.SessionService
import app.geostrategy.billing.BillingService
import app.geostrategy.config.AppConfig
import app.geostrategy.email.EmailSender
import app.geostrategy.jobs.JobQueue
import app.geostrategy.plans.PlanRepository
import app.geostrategy.sites.SiteRepository
import app.geostrategy.users.UserRepository

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
)
