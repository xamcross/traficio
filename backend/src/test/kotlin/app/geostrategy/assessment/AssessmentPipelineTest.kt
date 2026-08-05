package app.geostrategy.assessment

import app.geostrategy.MapFetcher
import app.geostrategy.TestMongo
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.claude.AnalysisResult
import app.geostrategy.claude.ClaudeClient
import app.geostrategy.claude.ClaudeResponse
import app.geostrategy.claude.PlanResult
import app.geostrategy.crawl.Crawler
import app.geostrategy.crawl.CrawlDigest
import app.geostrategy.jobs.JobQueue
import app.geostrategy.plans.PlanDoc
import app.geostrategy.plans.PlanRepository
import app.geostrategy.plans.buildPlanDoc
import app.geostrategy.sites.Site
import app.geostrategy.sites.SiteRepository
import com.mongodb.client.model.Filters
import kotlinx.coroutines.runBlocking
import org.bson.Document
import org.bson.types.ObjectId
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class AssessmentPipelineTest {
    private val homeHtml = """
        <html><head><title>Ada's</title></head>
        <body><h1>Hi</h1><p>${"bread ".repeat(60)}</p></body></html>
    """

    private fun fixtures(db: com.mongodb.kotlin.client.coroutine.MongoDatabase) = object {
        val sites = SiteRepository(db)
        val assessments = AssessmentRepository(db)
        val plans = PlanRepository(db)
        val jobs = JobQueue(db)
        val now: Instant = Instant.now()
        val site = runBlocking {
            sites.insert(Site(userId = ObjectId(), domain = "example.com", url = "https://example.com", createdAt = now, updatedAt = now))
        }
        val assessment = runBlocking {
            assessments.insert(Assessment(siteId = site.id, userId = site.userId, createdAt = now, updatedAt = now))
        }
    }

    @Test
    fun `happy path produces ready assessment, plan and site scores`() = runBlocking {
        val db = TestMongo.freshDb()
        val f = fixtures(db)
        val crawler = Crawler(MapFetcher(mapOf("https://example.com" to homeHtml)))
        val pipeline = AssessmentPipeline(f.assessments, f.sites, f.plans, crawler, CannedClaudeClient())
        f.jobs.enqueue("assessment", Document("assessmentId", f.assessment.id))
        pipeline.handle(f.jobs.claim()!!)

        val done = f.assessments.findById(f.assessment.id)!!
        assertEquals("ready", done.status)
        assertNotNull(done.scores)
        assertNotNull(done.completedAt)
        val plan = f.plans.findByAssessment(f.assessment.id)!!
        assertTrue(plan.tasks.isNotEmpty())
        assertTrue(plan.tasks.all { it.status == "todo" && it.taskId.isNotBlank() })
        assertEquals(done.scores, f.sites.findById(f.site.id)!!.latestScores)
    }

    @Test
    fun `retry after analyze crash resumes from saved crawl digest`() = runBlocking {
        val db = TestMongo.freshDb()
        val f = fixtures(db)
        var fetches = 0
        val countingFetcher = object : app.geostrategy.crawl.Fetcher {
            val inner = MapFetcher(mapOf("https://example.com" to homeHtml))
            override suspend fun fetch(url: String): app.geostrategy.crawl.FetchResult? {
                if (url == "https://example.com") fetches++
                return inner.fetch(url)
            }
        }
        var analyzeCalls = 0
        val flakyClaude = object : ClaudeClient {
            val real = CannedClaudeClient()
            override suspend fun analyze(digest: CrawlDigest): ClaudeResponse<AnalysisResult> {
                analyzeCalls++
                if (analyzeCalls == 1) error("transient claude outage")
                return real.analyze(digest)
            }
            override suspend fun plan(analysis: AnalysisResult, platform: String) = real.plan(analysis, platform)
        }
        val pipeline = AssessmentPipeline(f.assessments, f.sites, f.plans, Crawler(countingFetcher), flakyClaude)
        f.jobs.enqueue("assessment", Document("assessmentId", f.assessment.id))

        assertFailsWith<IllegalStateException> { pipeline.handle(f.jobs.claim()!!) }
        // the queue-level retry is covered by JobWorker tests; here we hand the pipeline a fresh job
        f.jobs.enqueue("assessment", Document("assessmentId", f.assessment.id))
        pipeline.handle(f.jobs.claim()!!)

        assertEquals("ready", f.assessments.findById(f.assessment.id)!!.status)
        assertEquals(1, fetches)  // crawl checkpoint prevented a second homepage fetch
    }

    @Test
    fun `js-only site fails with a friendly reason and does not retry`() = runBlocking {
        val db = TestMongo.freshDb()
        val f = fixtures(db)
        val shell = """<html><body><div id="root"></div><script src="a.js"></script></body></html>"""
        val pipeline = AssessmentPipeline(
            f.assessments, f.sites, f.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to shell))), CannedClaudeClient(),
        )
        f.jobs.enqueue("assessment", Document("assessmentId", f.assessment.id))
        pipeline.handle(f.jobs.claim()!!)  // must not throw
        val failed = f.assessments.findById(f.assessment.id)!!
        assertEquals("failed", failed.status)
        assertEquals("js_only_site", failed.errorCode)
    }

    @Test
    fun `retry after saved analysis and inserted plan calls claude zero times`() = runBlocking {
        val db = TestMongo.freshDb()
        val f = fixtures(db)
        // seed all checkpoints as a prior attempt would have left them
        val canned = CannedClaudeClient()
        val crawler = Crawler(MapFetcher(mapOf("https://example.com" to homeHtml)))
        val digest = crawler.crawl("https://example.com")
        f.assessments.saveCrawl(f.assessment.id, digest)
        val analysis = canned.analyze(digest).value
        f.assessments.saveAnalysis(f.assessment.id, analysis)
        f.plans.insert(buildPlanDoc(f.assessment, canned.plan(analysis, digest.platform).value))

        val throwingClaude = object : ClaudeClient {
            override suspend fun analyze(digest: CrawlDigest) = error("analyze must not be called")
            override suspend fun plan(analysis: AnalysisResult, platform: String) = error("plan must not be called")
        }
        val pipeline = AssessmentPipeline(f.assessments, f.sites, f.plans, crawler, throwingClaude)
        f.jobs.enqueue("assessment", Document("assessmentId", f.assessment.id))
        pipeline.handle(f.jobs.claim()!!)

        assertEquals("ready", f.assessments.findById(f.assessment.id)!!.status)
        val planCount = db.getCollection<PlanDoc>("plans")
            .countDocuments(Filters.eq("assessmentId", f.assessment.id))
        assertEquals(1L, planCount)
    }
}
