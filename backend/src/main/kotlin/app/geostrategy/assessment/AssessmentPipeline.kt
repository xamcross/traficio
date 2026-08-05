package app.geostrategy.assessment

import app.geostrategy.claude.ClaudeClient
import app.geostrategy.crawl.Crawler
import app.geostrategy.http.AppException
import app.geostrategy.jobs.Job
import app.geostrategy.plans.PlanRepository
import app.geostrategy.plans.buildPlanDoc
import app.geostrategy.sites.SiteRepository
import kotlinx.coroutines.CancellationException
import org.slf4j.LoggerFactory

class AssessmentPipeline(
    private val assessments: AssessmentRepository,
    private val sites: SiteRepository,
    private val plans: PlanRepository,
    private val crawler: Crawler,
    private val claude: ClaudeClient,
    private val maxJobAttempts: Int = 2,
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
            assessments.setStatus(id, "analyzing")
            val analysis = claude.analyze(digest)
            assessments.saveAnalysis(id, analysis.value)

            assessments.setStatus(id, "planning")
            val planResult = claude.plan(analysis.value, digest.platform)
            plans.insert(buildPlanDoc(assessment, planResult.value))

            sites.updateAfterAssessment(site.id, digest.platform, analysis.value.scores)
            assessments.markReady(id, analysis.usage + planResult.usage)
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
