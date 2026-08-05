package app.geostrategy.assessment

import app.geostrategy.claude.AnalysisResult
import app.geostrategy.claude.ClaudeClient
import app.geostrategy.claude.ClaudeUsage
import app.geostrategy.crawl.Crawler
import app.geostrategy.email.EmailSender
import app.geostrategy.http.AppException
import app.geostrategy.jobs.Job
import app.geostrategy.plans.PlanRepository
import app.geostrategy.plans.buildPlanDoc
import app.geostrategy.sites.SiteRepository
import app.geostrategy.users.UserRepository
import kotlinx.coroutines.CancellationException
import org.slf4j.LoggerFactory

class AssessmentPipeline(
    private val assessments: AssessmentRepository,
    private val sites: SiteRepository,
    private val plans: PlanRepository,
    private val crawler: Crawler,
    private val claude: ClaudeClient,
    private val maxJobAttempts: Int = 2,
    private val emailSender: EmailSender? = null,
    private val users: UserRepository? = null,
) {
    private val log = LoggerFactory.getLogger(AssessmentPipeline::class.java)

    suspend fun handle(job: Job) {
        val id = job.payload.getObjectId("assessmentId")
        val assessment = assessments.findById(id) ?: return
        if (assessment.status in TERMINAL_STATUSES) return
        val site = sites.findById(assessment.siteId) ?: return

        try {
            val digest = assessment.crawlDigest ?: run {
                assessments.setStatus(id, "crawling")
                val d = crawler.crawl(site.url)
                assessments.saveCrawl(id, d)
                d
            }
            if (digest.looksJsOnly) {
                assessments.markFailed(id, "js_only_site", "Your site needs JavaScript to show its content, so we can't read it yet. If you use a website builder, make sure your pages contain real text.")
                return
            }
            val saved = assessments.findById(id) ?: return
            val analysis: AnalysisResult
            var usage = ClaudeUsage(0, 0)
            if (saved.scores != null) {
                analysis = AnalysisResult(saved.scores, saved.findings)
            } else {
                assessments.setStatus(id, "analyzing")
                val result = claude.analyze(digest)
                analysis = result.value
                usage += result.usage
                assessments.saveAnalysis(id, analysis)
            }

            val previousPlan = plans.latestFor(site.id)
            if (previousPlan != null) {
                val openFindingIds = analysis.findings.map { it.id }.toSet()
                val fixed = previousPlan.tasks
                    .filter { it.findingId != null && it.findingId !in openFindingIds && it.status != "verified" }
                    .map { it.taskId }
                plans.markTasksVerified(previousPlan.id, fixed)
            }

            assessments.setStatus(id, "planning")
            if (plans.findByAssessment(id) == null) {
                val planResult = claude.plan(analysis, digest.platform)
                plans.insert(buildPlanDoc(saved, planResult.value))
                usage += planResult.usage
            }

            sites.updateAfterAssessment(site.id, digest.platform, analysis.scores)
            assessments.markReady(id, usage)
            if (emailSender != null && users != null) {
                users.findById(assessment.userId)?.let { owner ->
                    emailSender.send(
                        owner.email,
                        "Your GeoStrategy plan is ready",
                        "<p>Good news! We finished checking your site.</p><p>Log in to see your scores and your step-by-step plan.</p>",
                    )
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: AppException) {
            assessments.markFailed(id, e.code, e.message)
        } catch (e: Exception) {
            log.warn("assessment {} attempt {} failed: {}", id, job.attempts, e.message)
            if (job.attempts >= maxJobAttempts) {
                assessments.markFailed(id, "assessment_failed", "Something went wrong while we checked your site. Please try again.")
            }
            throw e
        }
    }
}
