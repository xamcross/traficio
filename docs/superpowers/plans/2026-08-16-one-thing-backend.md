# One Thing — Backend Contract (Plan 5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the backend API so that the Free tier gets a real result and a locked plan preview, and so that the frontend has every field the "One Thing" screens need.

**Architecture:** The Ktor monolith keeps its module layout. The changes are contract-level: a derived `overall` score, two new analysis fields and a `good` severity, a tier-aware plan DTO with redaction for Free, richer site and usage DTOs, and a derived "what changed" list on the history endpoint. No new collections, no data migration.

**Tech Stack:** Kotlin 2.2, Ktor 3.2, kotlinx.serialization, MongoDB Kotlin coroutine driver 5.5 (bson-kotlin data class codec), Testcontainers Mongo, JUnit 5 with kotlin.test.

**Spec:** `docs/superpowers/specs/2026-08-16-one-thing-design.md` (sections 2, 3, 7, 8, 10). Read it before you start.

## Global Constraints

- All prose you write (comments, README, commit bodies) follows ASD-STE100: short sentences, active voice, one instruction per sentence. Code identifiers and test names are exempt.
- Commit subject lines use the conventional-commit form: `feat(backend): …`, `fix(backend): …`, `test(backend): …`, `docs: …`.
- Run tests from `backend/`: `./gradlew test --tests "<fully.qualified.ClassName>"`. Docker Desktop must run (Testcontainers Mongo). The full suite is `./gradlew test`.
- Never change the SSE contract, the six assessment status values, the quota rules, or the Freemius code.
- The stored Mongo documents keep their shape. New stored fields are nullable with a `null` default. `overall` is never stored.
- User-facing message strings come from the spec verbatim: PATCH gate message "The step-by-step plan is part of Pro. Upgrade to unlock it."
- The canned Claude client stays deterministic and makes no network calls.
- Every task ends with the named test class green and a commit. Run the full suite in Task 8.

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `backend/src/main/kotlin/app/geostrategy/claude/Model.kt` | `Scores.overall`, `ScoreNotes`, `AnalysisResult` new fields | 1, 2 |
| `backend/src/main/resources/schemas/analysis.json` | Structured-output schema for the analysis call | 2 |
| `backend/src/main/resources/prompts/analyze-system.txt`, `plan-system.txt` | Prompts | 2 |
| `backend/src/main/kotlin/app/geostrategy/claude/CannedClaudeClient.kt` | Deterministic fixtures with the new fields | 2 |
| `backend/src/main/kotlin/app/geostrategy/assessment/Assessment.kt` | Storage model + repository queries | 3, 5, 7 |
| `backend/src/main/kotlin/app/geostrategy/assessment/AssessmentPipeline.kt` | Filters `good` findings out of the plan input; resumes with the new fields | 3 |
| `backend/src/main/kotlin/app/geostrategy/assessment/AssessmentRoutes.kt` | `AssessmentDto` new fields; history `changes` | 3, 6 |
| `backend/src/main/kotlin/app/geostrategy/assessment/History.kt` (new) | Pure function: "what changed" per assessment | 6 |
| `backend/src/main/kotlin/app/geostrategy/plans/PlanRoutes.kt` | Tier-aware DTO, redaction, PATCH gate | 4 |
| `backend/src/main/kotlin/app/geostrategy/plans/Plans.kt` | `PlanRepository.listFor(siteId)` | 6 |
| `backend/src/main/kotlin/app/geostrategy/sites/SiteRoutes.kt` | `SiteDto.latestAssessment`, `latestReadyAssessmentId` | 5 |
| `backend/src/main/kotlin/app/geostrategy/auth/AuthRoutes.kt` | `UsageResponse.nextCheckAt` | 7 |
| `backend/src/test/kotlin/app/geostrategy/TestSupport.kt` | `makePro` helper | 4 |
| `backend/README.md`, `docs/launch-checklist.md` | Docs | 8 |

---

### Task 1: Derived `overall` score on `Scores`

**Files:**
- Modify: `backend/src/main/kotlin/app/geostrategy/claude/Model.kt:7-8`
- Test: `backend/src/test/kotlin/app/geostrategy/claude/ScoresTest.kt` (new)

**Interfaces:**
- Produces: `Scores.overall: Int` — derived, round half up of the mean of `seo`, `aeo`, `geo`. Serialized in every JSON `scores` object. Not a constructor parameter, so the Mongo data class codec does not store it and `equals` ignores it.

- [ ] **Step 1: Write the failing test**

Create `backend/src/test/kotlin/app/geostrategy/claude/ScoresTest.kt`:

```kotlin
package app.geostrategy.claude

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ScoresTest {
    @Test
    fun `overall is the rounded mean, half up`() {
        assertEquals(41, Scores(62, 34, 28).overall)   // 41.33 -> 41
        assertEquals(50, Scores(50, 50, 49).overall)   // 49.67 -> 50
        assertEquals(51, Scores(51, 51, 50).overall)   // 50.67 -> 51
        assertEquals(1, Scores(1, 1, 2).overall)       // 1.33 -> 1
        assertEquals(2, Scores(1, 2, 2).overall)       // 1.67 -> 2
        assertEquals(0, Scores(0, 0, 0).overall)
        assertEquals(100, Scores(100, 100, 100).overall)
    }

    @Test
    fun `overall is encoded to json and derived again on decode`() {
        val json = Json { encodeDefaults = true }
        val encoded = json.encodeToString(Scores.serializer(), Scores(62, 34, 28))
        assertTrue(encoded.contains("\"overall\":41"), encoded)
        val decoded = json.decodeFromString(Scores.serializer(), """{"seo":62,"aeo":34,"geo":28}""")
        assertEquals(41, decoded.overall)
        // equality ignores the derived value: two Scores with the same inputs are equal
        assertEquals(Scores(62, 34, 28), decoded)
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.claude.ScoresTest"`
Expected: compilation error, `overall` is an unresolved reference.

- [ ] **Step 3: Implement `overall`**

In `Model.kt`, replace the `Scores` declaration:

```kotlin
@Serializable
data class Scores(val seo: Int, val aeo: Int, val geo: Int) {
    /**
     * Derived visibility score. Round half up of the mean of the three areas.
     * It is a body property, so the Mongo codec does not store it and `equals` ignores it.
     * kotlinx.serialization writes it to JSON and treats it as optional on decode.
     */
    val overall: Int = Math.round((seo + aeo + geo) / 3.0).toInt()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./gradlew test --tests "app.geostrategy.claude.ScoresTest"`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the pipeline and site tests to confirm storage still works**

Run: `./gradlew test --tests "app.geostrategy.assessment.AssessmentPipelineTest" --tests "app.geostrategy.sites.SiteRoutesTest"`
Expected: PASS. The `assertEquals(done.scores, latestScores)` assertion in the pipeline test still holds because `equals` uses constructor parameters only.

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/kotlin/app/geostrategy/claude/Model.kt backend/src/test/kotlin/app/geostrategy/claude/ScoresTest.kt
git commit -m "feat(backend): derived overall score on Scores"
```

---

### Task 2: Analysis schema, prompts, and canned client — `summary`, `scoreNotes`, severity `good`

**Files:**
- Modify: `backend/src/main/kotlin/app/geostrategy/claude/Model.kt` (add `ScoreNotes`, extend `AnalysisResult`)
- Modify: `backend/src/main/resources/schemas/analysis.json`
- Modify: `backend/src/main/resources/prompts/analyze-system.txt`
- Modify: `backend/src/main/resources/prompts/plan-system.txt`
- Modify: `backend/src/main/kotlin/app/geostrategy/claude/CannedClaudeClient.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/claude/CannedClaudeClientTest.kt`

**Interfaces:**
- Produces:
  - `@Serializable data class ScoreNotes(val seo: String, val aeo: String, val geo: String)`
  - `AnalysisResult(scores: Scores, findings: List<Finding>, summary: String? = null, scoreNotes: ScoreNotes? = null)`
  - `Finding.severity` may be `"good"`. Constant `GOOD_SEVERITY = "good"` in `Model.kt`.
  - `CannedClaudeClient.analyze` returns `summary`, `scoreNotes`, and at most two `good` findings. `CannedClaudeClient.plan` creates no task for a `good` finding.

- [ ] **Step 1: Write the failing tests**

In `CannedClaudeClientTest.kt`, replace the test `plan links tasks to findings and uses platform steps` and add two tests. The `digest` fixture in that file has `https = true` and `robotsTxtPresent = true`, so the canned client emits two `good` findings for it.

```kotlin
    @Test
    fun `plan links tasks to findings, skips good findings, and uses platform steps`() = runBlocking {
        val client = CannedClaudeClient()
        val analysis = client.analyze(digest).value
        val plan = client.plan(analysis, "wordpress").value
        val problems = analysis.findings.filter { it.severity != GOOD_SEVERITY }
        assertEquals(problems.size, plan.tasks.size)
        assertTrue(plan.tasks.all { it.findingId != null && problems.any { f -> f.id == it.findingId } })
        assertTrue(plan.tasks.all { it.steps.isNotEmpty() && it.whyItMatters.isNotBlank() && it.doneCheck.isNotBlank() })
        assertTrue(plan.tasks.any { task -> task.steps.first().contains("WordPress") })
    }

    @Test
    fun `analyze returns a summary, one note per area, and at most two good findings`() = runBlocking {
        val a = CannedClaudeClient().analyze(digest).value
        val summary = assertNotNull(a.summary)
        assertTrue(summary.isNotBlank())
        val notes = assertNotNull(a.scoreNotes)
        assertTrue(notes.seo.isNotBlank() && notes.aeo.isNotBlank() && notes.geo.isNotBlank())
        val good = a.findings.filter { it.severity == GOOD_SEVERITY }
        assertEquals(2, good.size)
        assertTrue(good.all { it.evidence.endsWith("Nothing to do here.") })
        // good findings come after every problem
        val firstGood = a.findings.indexOfFirst { it.severity == GOOD_SEVERITY }
        assertTrue(a.findings.drop(firstGood).all { it.severity == GOOD_SEVERITY })
    }

    @Test
    fun `analysis schema requires summary and scoreNotes and allows severity good`() {
        val schema = Json.parseToJsonElement(object {}.javaClass.getResource("/schemas/analysis.json")!!.readText()).jsonObject
        val required = schema["required"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertTrue("summary" in required && "scoreNotes" in required, required.toString())
        val severity = schema["properties"]!!.jsonObject["findings"]!!.jsonObject["items"]!!.jsonObject["properties"]!!.jsonObject["severity"]!!.jsonObject
        val allowed = severity["enum"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertEquals(listOf("high", "medium", "low", "good"), allowed)
        // the canned output only uses values the schema allows
        val canned = runBlocking { CannedClaudeClient().analyze(digest).value }
        assertTrue(canned.findings.all { it.severity in allowed })
        val notesProps = schema["properties"]!!.jsonObject["scoreNotes"]!!.jsonObject["required"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertEquals(listOf("seo", "aeo", "geo"), notesProps)
    }
```

Add these imports at the top of the test file:

```kotlin
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.assertNotNull
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./gradlew test --tests "app.geostrategy.claude.CannedClaudeClientTest"`
Expected: compilation error (`GOOD_SEVERITY`, `summary`, `scoreNotes` unresolved).

- [ ] **Step 3: Extend the model**

In `Model.kt`, replace `AnalysisResult` and add `ScoreNotes` and the constant:

```kotlin
const val GOOD_SEVERITY = "good"

@Serializable
data class ScoreNotes(val seo: String, val aeo: String, val geo: String)

@Serializable
data class AnalysisResult(
    val scores: Scores,
    val findings: List<Finding>,
    val summary: String? = null,
    val scoreNotes: ScoreNotes? = null,
)
```

The two new fields are nullable with a `null` default. The schema requires them from Claude. Old stored assessments have no values, so the storage side (Task 3) stays nullable too.

- [ ] **Step 4: Update the schema**

Replace the full content of `backend/src/main/resources/schemas/analysis.json`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["scores", "summary", "scoreNotes", "findings"],
  "properties": {
    "scores": {
      "type": "object",
      "additionalProperties": false,
      "required": ["seo", "aeo", "geo"],
      "properties": {
        "seo": { "type": "integer" },
        "aeo": { "type": "integer" },
        "geo": { "type": "integer" }
      }
    },
    "summary": { "type": "string" },
    "scoreNotes": {
      "type": "object",
      "additionalProperties": false,
      "required": ["seo", "aeo", "geo"],
      "properties": {
        "seo": { "type": "string" },
        "aeo": { "type": "string" },
        "geo": { "type": "string" }
      }
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "category", "severity", "evidence", "affectedPages"],
        "properties": {
          "id": { "type": "string" },
          "category": { "type": "string", "enum": ["seo", "aeo", "geo"] },
          "severity": { "type": "string", "enum": ["high", "medium", "low", "good"] },
          "evidence": { "type": "string" },
          "affectedPages": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  }
}
```

- [ ] **Step 5: Update the prompts**

Replace the full content of `prompts/analyze-system.txt`:

```
You are the assessment engine of GeoStrategy. You examine a website crawl digest.
You score the site for SEO (search engines), AEO (answer engines), and GEO (generative AI engines).
You return JSON that matches the given schema. Do not return anything else.

Rules:
- Score each area from 0 to 100. Be honest. A site with many problems must get a low score.
- Write summary for the site owner. One or two short sentences. Say what the scores mean for this site. Name the strongest area and the weakest area.
- Write one short sentence for each area in scoreNotes. Say what the score means in plain words.
- Create one finding for each real problem you see in the digest.
- Give each finding a stable id in kebab-case. Format: "<problem>:<page-path>" for page problems, "<problem>" for site problems. Use the same id for the same problem every time.
- Set category to seo, aeo, or geo. Set severity to high, medium, or low.
- Add at most two findings with severity good for things that are already right. Their evidence says what is right and ends with "Nothing to do here."
- Write the evidence for a person with no technical skill. Use short sentences. Explain each term you use.
- List the affected page URLs in affectedPages.
```

Replace the full content of `prompts/plan-system.txt`:

```
You are the plan writer of GeoStrategy. You turn findings into a step-by-step action plan.
The reader is a site owner with no software skill. Think of a smart 10-year-old.
You return JSON that matches the given schema. Do not return anything else.

Rules:
- Create one task for each finding. Copy the finding id into findingId.
- Do not create a task for a finding with severity good.
- Order tasks from the highest impact to the lowest impact.
- Write a short title that starts with a verb.
- In whyItMatters, explain the benefit in plain words. Use short sentences. No jargon.
- In steps, give one action per step. Tell the reader where to click for their platform.
- The platform is given in the user message. Use its real menu names.
- In doneCheck, tell the reader how they can see that the fix worked.
- Set effortMinutes to a realistic estimate.
```

- [ ] **Step 6: Update the canned client**

Replace the full content of `CannedClaudeClient.kt`:

```kotlin
package app.geostrategy.claude

import app.geostrategy.crawl.CrawlDigest
import java.net.URI

/**
 * Deterministic stand-in for the real Claude client. The app uses it when
 * ANTHROPIC_API_KEY is not set. Tests always use it.
 */
class CannedClaudeClient : ClaudeClient {
    private val zero = ClaudeUsage(0, 0)
    private val severityOrder = mapOf("high" to 0, "medium" to 1, "low" to 2)
    private val areaNames = mapOf("seo" to "Google search", "aeo" to "answer boxes", "geo" to "AI assistants")

    override suspend fun analyze(digest: CrawlDigest): ClaudeResponse<AnalysisResult> {
        val findings = mutableListOf<Finding>()
        fun path(url: String) = URI(url).rawPath?.takeIf { it.isNotEmpty() } ?: "/"

        for (p in digest.pages) {
            if (p.metaDescription == null) findings.add(Finding("missing-meta-description:${path(p.url)}", "seo", "high", "The page ${path(p.url)} has no meta description. Search engines show this text under your link.", listOf(p.url)))
            if (p.title == null) findings.add(Finding("missing-title:${path(p.url)}", "seo", "high", "The page ${path(p.url)} has no title tag.", listOf(p.url)))
            if (p.h1Count == 0) findings.add(Finding("missing-h1:${path(p.url)}", "seo", "medium", "The page ${path(p.url)} has no main heading (H1).", listOf(p.url)))
        }
        if (!digest.facts.sitemapPresent) findings.add(Finding("missing-sitemap", "seo", "medium", "Your site has no sitemap.xml. A sitemap helps search engines find your pages.", listOf(digest.startUrl)))
        if (!digest.facts.llmsTxtPresent) findings.add(Finding("missing-llms-txt", "geo", "low", "Your site has no llms.txt. This file tells AI assistants what your site is about.", listOf(digest.startUrl)))
        if (digest.pages.none { it.jsonLdTypes.isNotEmpty() }) findings.add(Finding("missing-structured-data", "aeo", "high", "No page has structured data (schema.org). Answer engines use it to understand your business.", listOf(digest.startUrl)))
        val totalImgs = digest.pages.sumOf { it.imgCount }
        if (totalImgs > 0 && digest.pages.sumOf { it.imgWithAltCount } * 2 < totalImgs) {
            findings.add(Finding("missing-alt-text", "seo", "low", "More than half of your images have no alt text.", digest.pages.filter { it.imgCount > it.imgWithAltCount }.map { it.url }))
        }

        // Scores count problems only. Good findings come after them and do not change the score.
        fun clamp(v: Int) = v.coerceIn(5, 100)
        val scores = Scores(
            seo = clamp(95 - 12 * findings.count { it.category == "seo" }),
            aeo = clamp(90 - 15 * findings.count { it.category == "aeo" }),
            geo = clamp(90 - 20 * findings.count { it.category == "geo" }),
        )

        if (digest.facts.https) findings.add(Finding("https-ok", "seo", GOOD_SEVERITY, "Your site uses HTTPS. Visitors get a secure connection. Nothing to do here.", listOf(digest.startUrl)))
        if (digest.facts.robotsTxtPresent) findings.add(Finding("robots-ok", "geo", GOOD_SEVERITY, "Your robots.txt lets crawlers read your site. Nothing to do here.", listOf(digest.startUrl)))

        val byArea = mapOf("seo" to scores.seo, "aeo" to scores.aeo, "geo" to scores.geo)
        val strongest = byArea.maxBy { it.value }.key
        val weakest = byArea.minBy { it.value }.key
        val summary = if (strongest == weakest) {
            "All three areas score about the same. Start with the first finding below."
        } else {
            "Your strongest area is ${areaNames[strongest]}. Your weakest area is ${areaNames[weakest]}."
        }
        val notes = ScoreNotes(
            seo = if (scores.seo >= 50) "Search engines can read your pages." else "Search engines miss basic details on your pages.",
            aeo = if (scores.aeo >= 50) "Answer boxes can pick up your content." else "Answer boxes rarely pick up your content.",
            geo = if (scores.geo >= 50) "AI assistants can find out what your site is about." else "AI assistants have little to go on.",
        )
        return ClaudeResponse(AnalysisResult(scores, findings, summary, notes), zero)
    }

    override suspend fun plan(analysis: AnalysisResult, platform: String): ClaudeResponse<PlanResult> {
        val firstStep = when (platform) {
            "wordpress" -> "Log in to your WordPress admin (usually yoursite.com/wp-admin)."
            "wix" -> "Log in to Wix and open your site's dashboard."
            "squarespace" -> "Log in to Squarespace and open your site."
            "shopify" -> "Log in to your Shopify admin."
            "webflow" -> "Log in to Webflow and open your project."
            else -> "Open the folder or tool you use to edit your website."
        }
        val tasks = analysis.findings
            .filter { it.severity != GOOD_SEVERITY }
            .sortedBy { severityOrder[it.severity] ?: 3 }
            .take(20)
            .map { f ->
                PlanTaskGen(
                    title = "Fix: ${f.id.substringBefore(':').replace('-', ' ')}",
                    category = f.category,
                    impact = f.severity,
                    effortMinutes = if (f.severity == "high") 30 else 15,
                    whyItMatters = f.evidence,
                    steps = listOf(firstStep, "Make this change: ${f.evidence}", "Save and publish your site."),
                    doneCheck = "Run a new assessment. This item should disappear from the list.",
                    findingId = f.id,
                )
            }
        return ClaudeResponse(PlanResult(tasks), zero)
    }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `./gradlew test --tests "app.geostrategy.claude.CannedClaudeClientTest"`
Expected: PASS (5 tests). The first test `analyze derives stable findings and clamped scores` still passes: the ids it checks still exist and the result is still deterministic.

- [ ] **Step 8: Run the reassessment and pipeline tests**

Run: `./gradlew test --tests "app.geostrategy.assessment.ReassessmentTest" --tests "app.geostrategy.assessment.AssessmentPipelineTest"`
Expected: PASS. Auto-verification compares finding ids; the two `good` ids never match a task `findingId`.

- [ ] **Step 9: Commit**

```bash
git add backend/src/main/kotlin/app/geostrategy/claude backend/src/main/resources backend/src/test/kotlin/app/geostrategy/claude/CannedClaudeClientTest.kt
git commit -m "feat(backend): analysis summary, score notes and good findings"
```

---

### Task 3: Store the new analysis fields, expose them on the assessment DTO, keep `good` findings out of the plan

**Files:**
- Modify: `backend/src/main/kotlin/app/geostrategy/assessment/Assessment.kt` (model + `saveAnalysis`)
- Modify: `backend/src/main/kotlin/app/geostrategy/assessment/AssessmentPipeline.kt:44-52,70-74`
- Modify: `backend/src/main/kotlin/app/geostrategy/assessment/AssessmentRoutes.kt:26-45`
- Test: `backend/src/test/kotlin/app/geostrategy/assessment/AssessmentPipelineTest.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/assessment/AssessmentRoutesTest.kt`

**Interfaces:**
- Consumes: `AnalysisResult.summary`, `AnalysisResult.scoreNotes`, `GOOD_SEVERITY` (Task 2).
- Produces:
  - `Assessment.summary: String? = null`, `Assessment.scoreNotes: ScoreNotes? = null` (stored).
  - `AssessmentDto` gains `summary: String?`, `scoreNotes: ScoreNotes?`, `pageCount: Int?` (`crawlDigest?.pages?.size`).
  - The pipeline calls `claude.plan` with `analysis.findings` minus `good` findings.

- [ ] **Step 1: Write the failing pipeline test**

Add to `AssessmentPipelineTest.kt`:

```kotlin
    @Test
    fun `happy path stores summary and notes and writes no task for a good finding`() = runBlocking {
        val db = TestMongo.freshDb()
        val f = fixtures(db)
        val crawler = Crawler(MapFetcher(mapOf("https://example.com" to homeHtml)))
        val canned = CannedClaudeClient()
        var planInputSeverities: List<String> = emptyList()
        val spyingClaude = object : ClaudeClient {
            override suspend fun analyze(digest: CrawlDigest) = canned.analyze(digest)
            override suspend fun plan(analysis: AnalysisResult, platform: String): ClaudeResponse<PlanResult> {
                planInputSeverities = analysis.findings.map { it.severity }
                return canned.plan(analysis, platform)
            }
        }
        val pipeline = AssessmentPipeline(f.assessments, f.sites, f.plans, crawler, spyingClaude)
        f.jobs.enqueue("assessment", Document("assessmentId", f.assessment.id))
        pipeline.handle(f.jobs.claim()!!)

        val done = f.assessments.findById(f.assessment.id)!!
        assertNotNull(done.summary)
        assertNotNull(done.scoreNotes)
        // the stored findings keep the good ones (the report shows them) ...
        assertTrue(done.findings.any { it.severity == GOOD_SEVERITY })
        // ... but the plan call never sees them
        assertTrue(planInputSeverities.isNotEmpty() && planInputSeverities.none { it == GOOD_SEVERITY })
        val goodIds = done.findings.filter { it.severity == GOOD_SEVERITY }.map { it.id }.toSet()
        val plan = f.plans.findByAssessment(f.assessment.id)!!
        assertTrue(plan.tasks.none { it.findingId in goodIds })
    }
```

Add the import `import app.geostrategy.claude.GOOD_SEVERITY` to the test file.

- [ ] **Step 2: Write the failing routes test**

Add to `AssessmentRoutesTest.kt` (it already imports `testApplication`, `HttpCookies`, `registerVerifyLogin`, `Json`, `jsonObject`, `jsonPrimitive`; add the imports listed after the code):

```kotlin
    @Test
    fun `assessment dto carries summary, score notes, overall and page count after the pipeline`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        val assessmentId = Json.parseToJsonElement(http.post("/v1/sites/$siteId/assessments").bodyAsText())
            .jsonObject["id"]!!.jsonPrimitive.content

        val queued = Json.parseToJsonElement(http.get("/v1/assessments/$assessmentId").bodyAsText()).jsonObject
        assertEquals(JsonNull, queued["summary"])
        assertEquals(JsonNull, queued["pageCount"])

        val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to html))), CannedClaudeClient(),
        )
        runBlocking { pipeline.handle(deps.jobs.claim()!!) }

        val ready = Json.parseToJsonElement(http.get("/v1/assessments/$assessmentId").bodyAsText()).jsonObject
        assertEquals("ready", ready["status"]!!.jsonPrimitive.content)
        assertTrue(ready["summary"]!!.jsonPrimitive.content.isNotBlank())
        assertTrue(ready["scoreNotes"]!!.jsonObject["geo"]!!.jsonPrimitive.content.isNotBlank())
        assertEquals(1, ready["pageCount"]!!.jsonPrimitive.content.toInt())
        val scores = ready["scores"]!!.jsonObject
        val expectedOverall = Math.round((scores["seo"]!!.jsonPrimitive.content.toInt() + scores["aeo"]!!.jsonPrimitive.content.toInt() + scores["geo"]!!.jsonPrimitive.content.toInt()) / 3.0).toInt()
        assertEquals(expectedOverall, scores["overall"]!!.jsonPrimitive.content.toInt())
    }
```

Imports to add if missing in `AssessmentRoutesTest.kt`:

```kotlin
import app.geostrategy.MapFetcher
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.crawl.Crawler
import io.ktor.client.request.get
import kotlinx.serialization.json.JsonNull
import kotlinx.coroutines.runBlocking
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `./gradlew test --tests "app.geostrategy.assessment.AssessmentPipelineTest" --tests "app.geostrategy.assessment.AssessmentRoutesTest"`
Expected: compilation errors (`done.summary`, `pageCount` missing) or assertion failures.

- [ ] **Step 4: Extend the storage model and `saveAnalysis`**

In `Assessment.kt`, add two fields to the `Assessment` data class after `findings`:

```kotlin
    val summary: String? = null,
    val scoreNotes: ScoreNotes? = null,
```

Add the import `import app.geostrategy.claude.ScoreNotes`.

Replace `saveAnalysis`:

```kotlin
    suspend fun saveAnalysis(id: ObjectId, analysis: AnalysisResult, usage: ClaudeUsage) {
        col.updateOne(
            eq("_id", id),
            combine(
                set("scores", analysis.scores),
                set("findings", analysis.findings),
                set("summary", analysis.summary),
                set("scoreNotes", analysis.scoreNotes),
                Updates.inc("inputTokens", usage.inputTokens),
                Updates.inc("outputTokens", usage.outputTokens),
                set("updatedAt", Instant.now()),
            ),
        )
    }
```

- [ ] **Step 5: Update the pipeline**

In `AssessmentPipeline.kt`, change the resume branch (line 48):

```kotlin
            if (saved.scores != null) {
                analysis = AnalysisResult(saved.scores, saved.findings, saved.summary, saved.scoreNotes)
            } else {
```

Change the plan call (lines 70–74):

```kotlin
            assessments.setStatus(id, "planning")
            if (plans.findByAssessment(id) == null) {
                // Good findings describe what is already right. They get no task.
                val planInput = analysis.copy(findings = analysis.findings.filter { it.severity != GOOD_SEVERITY })
                val planResult = claude.plan(planInput, digest.platform)
                plans.insert(buildPlanDoc(saved, planResult.value))
                assessments.addUsage(id, planResult.usage)
            }
```

Add the import `import app.geostrategy.claude.GOOD_SEVERITY`.

- [ ] **Step 6: Extend the DTO**

In `AssessmentRoutes.kt`, replace `AssessmentDto` and `toDto()`:

```kotlin
@Serializable
data class AssessmentDto(
    val id: String,
    val siteId: String,
    val status: String,
    val scores: Scores?,
    val summary: String?,
    val scoreNotes: ScoreNotes?,
    val findings: List<Finding>,
    val pageCount: Int?,
    val errorCode: String?,
    val errorMessage: String?,
    val createdAt: String,
    val completedAt: String?,
)

fun Assessment.toDto() = AssessmentDto(
    id = id.toHexString(), siteId = siteId.toHexString(), status = status, scores = scores,
    summary = summary, scoreNotes = scoreNotes, findings = findings,
    pageCount = crawlDigest?.pages?.size,
    errorCode = errorCode, errorMessage = errorMessage,
    createdAt = createdAt.toString(), completedAt = completedAt?.toString(),
)
```

Add the import `import app.geostrategy.claude.ScoreNotes`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `./gradlew test --tests "app.geostrategy.assessment.AssessmentPipelineTest" --tests "app.geostrategy.assessment.AssessmentRoutesTest"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/main/kotlin/app/geostrategy/assessment backend/src/test/kotlin/app/geostrategy/assessment
git commit -m "feat(backend): store analysis summary and notes, expose page count, keep good findings out of the plan"
```

---

### Task 4: Tier-aware plan DTO — redaction for Free and the PATCH gate

**Files:**
- Modify: `backend/src/main/kotlin/app/geostrategy/plans/PlanRoutes.kt` (full rewrite)
- Modify: `backend/src/test/kotlin/app/geostrategy/TestSupport.kt` (add `makePro`)
- Test: `backend/src/test/kotlin/app/geostrategy/plans/PlanRoutesTest.kt`

**Interfaces:**
- Produces:
  - `PlanTaskDto(taskId, title, category, impact, effortMinutes, stepCount: Int, whyItMatters: String?, steps: List<String>?, doneCheck: String?, status)`
  - `PlanDto(id, assessmentId, siteId, locked: Boolean, tasks, progress)`
  - `fun PlanDoc.toDto(locked: Boolean): PlanDto`
  - `fun planLockedFor(user: User): Boolean = user.tier != "pro"`
  - `suspend fun makePro(db: MongoDatabase, email: String)` in `TestSupport.kt`
  - PATCH check order: ownership (404) → tier (403 `upgrade_required`) → body (400 `invalid_status`) → task (404).

- [ ] **Step 1: Add the shared test helper**

Append to `TestSupport.kt`:

```kotlin
/** Sets the user's tier to pro directly in the database. Billing is out of scope for these tests. */
suspend fun makePro(db: MongoDatabase, email: String) {
    db.getCollection<app.geostrategy.users.User>("users")
        .updateOne(com.mongodb.client.model.Filters.eq("email", email), com.mongodb.client.model.Updates.set("tier", "pro"))
}
```

- [ ] **Step 2: Rewrite the plan route tests**

Replace the full content of `PlanRoutesTest.kt`:

```kotlin
package app.geostrategy.plans

import app.geostrategy.MapFetcher
import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.assessment.AssessmentPipeline
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.crawl.Crawler
import app.geostrategy.makePro
import app.geostrategy.registerVerifyLogin
import app.geostrategy.testDeps
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import io.ktor.client.HttpClient
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PlanRoutesTest {
    private val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""

    /** Registers a verified user, creates a site, submits one assessment, and runs the pipeline. */
    private class Ready(val db: MongoDatabase, val emails: RecordingEmailSender, val http: HttpClient, val siteId: String, val assessmentId: String)

    private suspend fun ApplicationTestBuilder.readyAssessment(email: String = "ada@example.com"): Ready {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, email)
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        val assessmentId = Json.parseToJsonElement(http.post("/v1/sites/$siteId/assessments").bodyAsText())
            .jsonObject["id"]!!.jsonPrimitive.content
        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to html))), CannedClaudeClient(),
        )
        runBlocking { pipeline.handle(deps.jobs.claim()!!) }
        return Ready(db, emails, http, siteId, assessmentId)
    }

    @Test
    fun `free user gets a locked plan without steps and cannot patch a task`() = testApplication {
        val r = readyAssessment()
        val plan = Json.parseToJsonElement(r.http.get("/v1/assessments/${r.assessmentId}/plan").bodyAsText()).jsonObject
        assertEquals(true, plan["locked"]!!.jsonPrimitive.content.toBoolean())
        val first = plan["tasks"]!!.jsonArray.first().jsonObject
        assertTrue(first["title"]!!.jsonPrimitive.content.isNotBlank())
        assertEquals(3, first["stepCount"]!!.jsonPrimitive.content.toInt())
        assertEquals(JsonNull, first["steps"])
        assertEquals(JsonNull, first["whyItMatters"])
        assertEquals(JsonNull, first["doneCheck"])
        assertEquals("todo", first["status"]!!.jsonPrimitive.content)
        assertEquals(0, plan["progress"]!!.jsonObject["done"]!!.jsonPrimitive.content.toInt())

        // by-site variant is redacted the same way
        val bySite = Json.parseToJsonElement(r.http.get("/v1/sites/${r.siteId}/plan").bodyAsText()).jsonObject
        assertEquals(true, bySite["locked"]!!.jsonPrimitive.content.toBoolean())
        assertEquals(JsonNull, bySite["tasks"]!!.jsonArray.first().jsonObject["steps"])

        val planId = plan["id"]!!.jsonPrimitive.content
        val taskId = first["taskId"]!!.jsonPrimitive.content
        val patched = r.http.patch("/v1/plans/$planId/tasks/$taskId") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"done"}""")
        }
        assertEquals(HttpStatusCode.Forbidden, patched.status)
        assertTrue(patched.bodyAsText().contains("upgrade_required"))
        assertTrue(patched.bodyAsText().contains("The step-by-step plan is part of Pro. Upgrade to unlock it."))
    }

    @Test
    fun `pro user gets the full plan and can check off a task`() = testApplication {
        val r = readyAssessment()
        runBlocking { makePro(r.db, "ada@example.com") }

        val plan = Json.parseToJsonElement(r.http.get("/v1/assessments/${r.assessmentId}/plan").bodyAsText()).jsonObject
        assertFalse(plan["locked"]!!.jsonPrimitive.content.toBoolean())
        val first = plan["tasks"]!!.jsonArray.first().jsonObject
        assertEquals(3, first["steps"]!!.jsonArray.size)
        assertEquals(3, first["stepCount"]!!.jsonPrimitive.content.toInt())
        assertTrue(first["whyItMatters"]!!.jsonPrimitive.content.isNotBlank())
        assertTrue(first["doneCheck"]!!.jsonPrimitive.content.isNotBlank())

        val planId = plan["id"]!!.jsonPrimitive.content
        val taskId = first["taskId"]!!.jsonPrimitive.content
        val patched = r.http.patch("/v1/plans/$planId/tasks/$taskId") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"done"}""")
        }
        assertEquals(HttpStatusCode.OK, patched.status)
        val body = Json.parseToJsonElement(patched.bodyAsText()).jsonObject
        assertEquals(1, body["progress"]!!.jsonObject["done"]!!.jsonPrimitive.content.toInt())
        assertFalse(body["locked"]!!.jsonPrimitive.content.toBoolean())

        // latest plan by site works too
        assertTrue(r.http.get("/v1/sites/${r.siteId}/plan").bodyAsText().contains(planId))
    }

    @Test
    fun `a downgraded user keeps stored statuses inside the locked plan`() = testApplication {
        val r = readyAssessment()
        runBlocking { makePro(r.db, "ada@example.com") }
        val plan = Json.parseToJsonElement(r.http.get("/v1/assessments/${r.assessmentId}/plan").bodyAsText()).jsonObject
        val planId = plan["id"]!!.jsonPrimitive.content
        val taskId = plan["tasks"]!!.jsonArray.first().jsonObject["taskId"]!!.jsonPrimitive.content
        r.http.patch("/v1/plans/$planId/tasks/$taskId") { contentType(ContentType.Application.Json); setBody("""{"status":"done"}""") }

        // downgrade
        runBlocking {
            r.db.getCollection<app.geostrategy.users.User>("users")
                .updateOne(com.mongodb.client.model.Filters.eq("email", "ada@example.com"), com.mongodb.client.model.Updates.set("tier", "free"))
        }
        val locked = Json.parseToJsonElement(r.http.get("/v1/assessments/${r.assessmentId}/plan").bodyAsText()).jsonObject
        assertTrue(locked["locked"]!!.jsonPrimitive.content.toBoolean())
        assertEquals("done", locked["tasks"]!!.jsonArray.first().jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals(1, locked["progress"]!!.jsonObject["done"]!!.jsonPrimitive.content.toInt())
    }

    @Test
    fun `verified is not settable by users`() = testApplication {
        val r = readyAssessment()
        runBlocking { makePro(r.db, "ada@example.com") }
        val plan = runBlocking { PlanRepository(r.db).latestFor(org.bson.types.ObjectId(r.siteId))!! }
        val res = r.http.patch("/v1/plans/${plan.id.toHexString()}/tasks/${plan.tasks.first().taskId}") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"verified"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertTrue(res.bodyAsText().contains("invalid_status"))
    }

    @Test
    fun `unknown task id names the task in the 404`() = testApplication {
        val r = readyAssessment()
        runBlocking { makePro(r.db, "ada@example.com") }
        val plan = runBlocking { PlanRepository(r.db).latestFor(org.bson.types.ObjectId(r.siteId))!! }
        val res = r.http.patch("/v1/plans/${plan.id.toHexString()}/tasks/nope") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"done"}""")
        }
        assertEquals(HttpStatusCode.NotFound, res.status)
        assertTrue(res.bodyAsText().contains("task"))
    }

    @Test
    fun `another user's plan is 404 for free and pro alike`() = testApplication {
        val r = readyAssessment()
        val plan = runBlocking { PlanRepository(r.db).latestFor(org.bson.types.ObjectId(r.siteId))!! }
        // a second user on the same app; the app's recording sender delivers bob's token
        val http2 = createClient { install(HttpCookies) }
        registerVerifyLogin(http2, r.emails, "bob@example.com")
        assertEquals(HttpStatusCode.NotFound, http2.get("/v1/assessments/${r.assessmentId}/plan").status)
        val patched = http2.patch("/v1/plans/${plan.id.toHexString()}/tasks/${plan.tasks.first().taskId}") {
            contentType(ContentType.Application.Json)
            setBody("""{"status":"done"}""")
        }
        assertEquals(HttpStatusCode.NotFound, patched.status)
        runBlocking { makePro(r.db, "bob@example.com") }
        assertEquals(HttpStatusCode.NotFound, http2.get("/v1/assessments/${r.assessmentId}/plan").status)
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `./gradlew test --tests "app.geostrategy.plans.PlanRoutesTest"`
Expected: FAIL. `locked` and `stepCount` are absent from the JSON, and the Free PATCH returns 200.

- [ ] **Step 4: Rewrite `PlanRoutes.kt`**

Replace the full content:

```kotlin
package app.geostrategy.plans

import app.geostrategy.AppDeps
import app.geostrategy.assessment.toObjectIdOr404
import app.geostrategy.auth.requireUser
import app.geostrategy.http.AppException
import app.geostrategy.users.User
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.patch
import kotlinx.serialization.Serializable

@Serializable
data class PlanTaskDto(
    val taskId: String,
    val title: String,
    val category: String,
    val impact: String,
    val effortMinutes: Int,
    val stepCount: Int,
    val whyItMatters: String?,
    val steps: List<String>?,
    val doneCheck: String?,
    val status: String,
)
@Serializable data class PlanProgressDto(val done: Int, val verified: Int, val total: Int)
@Serializable data class PlanDto(val id: String, val assessmentId: String, val siteId: String, val locked: Boolean, val tasks: List<PlanTaskDto>, val progress: PlanProgressDto)
@Serializable data class TaskStatusRequest(val status: String)

/** The plan is Pro. A Free user sees a locked preview: no steps, no reason, no done-check. */
fun planLockedFor(user: User): Boolean = user.tier != "pro"

fun PlanDoc.toDto(locked: Boolean): PlanDto = PlanDto(
    id = id.toHexString(),
    assessmentId = assessmentId.toHexString(),
    siteId = siteId.toHexString(),
    locked = locked,
    tasks = tasks.map {
        PlanTaskDto(
            taskId = it.taskId, title = it.title, category = it.category, impact = it.impact,
            effortMinutes = it.effortMinutes, stepCount = it.steps.size,
            whyItMatters = if (locked) null else it.whyItMatters,
            steps = if (locked) null else it.steps,
            doneCheck = if (locked) null else it.doneCheck,
            status = it.status,
        )
    },
    progress = PlanProgressDto(
        done = tasks.count { it.status == "done" },
        verified = tasks.count { it.status == "verified" },
        total = tasks.size,
    ),
)

private val NOT_FOUND = { AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that plan.") }
private val UPGRADE_REQUIRED = { AppException(HttpStatusCode.Forbidden, "upgrade_required", "The step-by-step plan is part of Pro. Upgrade to unlock it.") }

fun Route.planRoutes(deps: AppDeps) {
    get("/v1/assessments/{id}/plan") {
        val user = call.requireUser(deps)
        val plan = deps.plans.findByAssessment(call.parameters["id"]!!.toObjectIdOr404())
            ?.takeIf { it.userId == user.id } ?: throw NOT_FOUND()
        call.respond(plan.toDto(locked = planLockedFor(user)))
    }

    get("/v1/sites/{siteId}/plan") {
        val user = call.requireUser(deps)
        val plan = deps.plans.latestFor(call.parameters["siteId"]!!.toObjectIdOr404())
            ?.takeIf { it.userId == user.id } ?: throw NOT_FOUND()
        call.respond(plan.toDto(locked = planLockedFor(user)))
    }

    patch("/v1/plans/{planId}/tasks/{taskId}") {
        val user = call.requireUser(deps)
        // Order: ownership, then tier, then body. Another user's plan is 404 for every tier.
        val planId = call.parameters["planId"]!!.toObjectIdOr404()
        deps.plans.findById(planId)?.takeIf { it.userId == user.id } ?: throw NOT_FOUND()
        if (planLockedFor(user)) throw UPGRADE_REQUIRED()
        val body = call.receive<TaskStatusRequest>()
        if (body.status !in setOf("todo", "done")) {
            throw AppException(HttpStatusCode.BadRequest, "invalid_status", "A task can only be marked as done or todo.")
        }
        val updated = deps.plans.updateTaskStatus(planId, call.parameters["taskId"]!!, body.status)
            ?: throw AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that task.")
        call.respond(updated.toDto(locked = false))
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./gradlew test --tests "app.geostrategy.plans.PlanRoutesTest"`
Expected: PASS (6 tests).

- [ ] **Step 6: Run every test that touches plans**

Run: `./gradlew test --tests "app.geostrategy.assessment.ReassessmentTest" --tests "app.geostrategy.billing.DowngradeTest"`
Expected: PASS. If a test in these classes reads `/plan` as a Free user and asserts on `steps`, add `makePro` before the read.

- [ ] **Step 7: Commit**

```bash
git add backend/src/main/kotlin/app/geostrategy/plans/PlanRoutes.kt backend/src/test/kotlin/app/geostrategy/TestSupport.kt backend/src/test/kotlin/app/geostrategy/plans/PlanRoutesTest.kt
git commit -m "feat(backend): lock the plan for the free tier and gate task updates"
```

---

### Task 5: `latestAssessment` and `latestReadyAssessmentId` on the site DTO

**Files:**
- Modify: `backend/src/main/kotlin/app/geostrategy/assessment/Assessment.kt` (repository: `latestFor`, `latestReadyFor`)
- Modify: `backend/src/main/kotlin/app/geostrategy/sites/SiteRoutes.kt:20-24,50,56`
- Test: `backend/src/test/kotlin/app/geostrategy/sites/SiteRoutesTest.kt`

**Interfaces:**
- Produces:
  - `AssessmentRepository.latestFor(siteId: ObjectId): Assessment?` — newest by `createdAt`, then `_id`, any status.
  - `AssessmentRepository.latestReadyFor(siteId: ObjectId): Assessment?` — same order, status `ready` only.
  - `@Serializable data class LatestAssessmentDto(val id: String, val status: String, val createdAt: String, val completedAt: String?)`
  - `SiteDto(id, domain, url, platform, latestScores, readOnly, latestAssessment: LatestAssessmentDto?, latestReadyAssessmentId: String?)`
  - `fun Site.toDto(readOnly: Boolean, latest: Assessment? = null, latestReady: Assessment? = null): SiteDto`

- [ ] **Step 1: Write the failing test**

Add to `SiteRoutesTest.kt` (add the imports listed after the code):

```kotlin
    @Test
    fun `site list carries the latest assessment and the latest ready assessment id`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val created = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject
        assertEquals(JsonNull, created["latestAssessment"])
        assertEquals(JsonNull, created["latestReadyAssessmentId"])
        val siteId = created["id"]!!.jsonPrimitive.content

        fun firstSite() = Json.parseToJsonElement(runBlocking { http.get("/v1/sites").bodyAsText() }).jsonObject["sites"]!!.jsonArray.first().jsonObject
        assertEquals(JsonNull, firstSite()["latestAssessment"])

        val firstId = Json.parseToJsonElement(http.post("/v1/sites/$siteId/assessments").bodyAsText()).jsonObject["id"]!!.jsonPrimitive.content
        val queued = firstSite()
        assertEquals(firstId, queued["latestAssessment"]!!.jsonObject["id"]!!.jsonPrimitive.content)
        assertEquals("queued", queued["latestAssessment"]!!.jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, queued["latestReadyAssessmentId"])

        val html = """<html><head><title>T</title></head><body><h1>H</h1><p>${"w ".repeat(60)}</p></body></html>"""
        val pipeline = AssessmentPipeline(
            deps.assessments, deps.sites, deps.plans,
            Crawler(MapFetcher(mapOf("https://example.com" to html))), CannedClaudeClient(),
        )
        runBlocking { pipeline.handle(deps.jobs.claim()!!) }
        val ready = firstSite()
        assertEquals("ready", ready["latestAssessment"]!!.jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals(firstId, ready["latestReadyAssessmentId"]!!.jsonPrimitive.content)
        assertTrue(ready["latestAssessment"]!!.jsonObject["completedAt"]!!.jsonPrimitive.content.isNotBlank())
        assertTrue(ready["latestScores"]!!.jsonObject.containsKey("overall"))

        // a second (pro) submission becomes the latest; the ready id stays on the first
        runBlocking { makePro(db, "ada@example.com") }
        val secondId = Json.parseToJsonElement(http.post("/v1/sites/$siteId/assessments").bodyAsText()).jsonObject["id"]!!.jsonPrimitive.content
        val again = firstSite()
        assertEquals(secondId, again["latestAssessment"]!!.jsonObject["id"]!!.jsonPrimitive.content)
        assertEquals(firstId, again["latestReadyAssessmentId"]!!.jsonPrimitive.content)
    }
```

Imports to add to `SiteRoutesTest.kt`:

```kotlin
import app.geostrategy.MapFetcher
import app.geostrategy.RecordingEmailSender
import app.geostrategy.assessment.AssessmentPipeline
import app.geostrategy.claude.CannedClaudeClient
import app.geostrategy.crawl.Crawler
import app.geostrategy.makePro
import app.geostrategy.registerVerifyLogin
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.sites.SiteRoutesTest"`
Expected: FAIL — `latestAssessment` is not in the JSON (`assertEquals(JsonNull, null)` fails).

- [ ] **Step 3: Add the repository queries**

In `Assessment.kt`, add to `AssessmentRepository` after `listFor`:

```kotlin
    private val newestFirst = Sorts.orderBy(Sorts.descending("createdAt"), Sorts.descending("_id"))

    suspend fun latestFor(siteId: ObjectId): Assessment? =
        col.find(eq("siteId", siteId)).sort(newestFirst).firstOrNull()

    suspend fun latestReadyFor(siteId: ObjectId): Assessment? =
        col.find(and(eq("siteId", siteId), eq("status", "ready"))).sort(newestFirst).firstOrNull()
```

- [ ] **Step 4: Extend the site DTO and routes**

In `SiteRoutes.kt`, replace the DTO declarations and `toDto`:

```kotlin
@Serializable data class CreateSiteRequest(val url: String)
@Serializable data class LatestAssessmentDto(val id: String, val status: String, val createdAt: String, val completedAt: String?)
@Serializable data class SiteDto(
    val id: String,
    val domain: String,
    val url: String,
    val platform: String?,
    val latestScores: Scores?,
    val readOnly: Boolean,
    val latestAssessment: LatestAssessmentDto?,
    val latestReadyAssessmentId: String?,
)
@Serializable data class SiteListResponse(val sites: List<SiteDto>)

fun Site.toDto(readOnly: Boolean, latest: Assessment? = null, latestReady: Assessment? = null) = SiteDto(
    id = id.toHexString(), domain = domain, url = url, platform = platform, latestScores = latestScores, readOnly = readOnly,
    latestAssessment = latest?.let { LatestAssessmentDto(it.id.toHexString(), it.status, it.createdAt.toString(), it.completedAt?.toString()) },
    latestReadyAssessmentId = latestReady?.id?.toHexString(),
)
```

Add the import `import app.geostrategy.assessment.Assessment`.

Replace the `GET /v1/sites` handler body:

```kotlin
    get("/v1/sites") {
        val user = call.requireUser(deps)
        val sites = deps.sites.listFor(user.id)
        val allowed = allowedSiteIds(sites, deps.config.tierLimits.maxSitesFor(user.tier))
        val dtos = sites.map { site ->
            site.toDto(
                readOnly = site.id !in allowed,
                latest = deps.assessments.latestFor(site.id),
                latestReady = deps.assessments.latestReadyFor(site.id),
            )
        }
        call.respond(SiteListResponse(dtos))
    }
```

The `POST /v1/sites` handler keeps `site.toDto(readOnly = false)`; the defaults give `null` for both new fields.

- [ ] **Step 5: Run the test to verify it passes**

Run: `./gradlew test --tests "app.geostrategy.sites.SiteRoutesTest"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/kotlin/app/geostrategy/assessment/Assessment.kt backend/src/main/kotlin/app/geostrategy/sites/SiteRoutes.kt backend/src/test/kotlin/app/geostrategy/sites/SiteRoutesTest.kt
git commit -m "feat(backend): latest assessment fields on the site dto"
```

---

### Task 6: History "what changed" (`changes` on the assessment list)

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/assessment/History.kt`
- Modify: `backend/src/main/kotlin/app/geostrategy/plans/Plans.kt` (add `listFor(siteId)`)
- Modify: `backend/src/main/kotlin/app/geostrategy/assessment/AssessmentRoutes.kt` (DTO `changes`, list route)
- Test: `backend/src/test/kotlin/app/geostrategy/assessment/HistoryTest.kt` (new, pure)
- Test: `backend/src/test/kotlin/app/geostrategy/assessment/ReassessmentTest.kt` (route-level)

**Interfaces:**
- Produces:
  - `@Serializable data class TaskChangeDto(val title: String, val kind: String)` — `kind` is `"done"` or `"verified"`.
  - `fun changesFor(assessments: List<Assessment>, plans: List<PlanDoc>): Map<ObjectId, List<TaskChangeDto>>` — pure. Input order does not matter.
  - `PlanRepository.listFor(siteId: ObjectId): List<PlanDoc>`
  - `AssessmentDto.changes: List<TaskChangeDto> = emptyList()` — filled by the list route only.

- [ ] **Step 1: Write the failing pure test**

Create `backend/src/test/kotlin/app/geostrategy/assessment/HistoryTest.kt`:

```kotlin
package app.geostrategy.assessment

import app.geostrategy.plans.PlanDoc
import app.geostrategy.plans.PlanTask
import org.bson.types.ObjectId
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals

class HistoryTest {
    private val siteId = ObjectId()
    private val userId = ObjectId()
    private val t0: Instant = Instant.parse("2026-03-02T10:00:00Z")

    private fun assessment(status: String, createdAt: Instant, completedAt: Instant?) =
        Assessment(siteId = siteId, userId = userId, status = status, createdAt = createdAt, updatedAt = createdAt, completedAt = completedAt)

    private fun task(title: String, status: String, completedAt: Instant?) =
        PlanTask(taskId = ObjectId().toHexString(), title = title, category = "seo", impact = "high", effortMinutes = 10,
            whyItMatters = "w", steps = listOf("s"), doneCheck = "d", findingId = null, status = status, completedAt = completedAt)

    private fun plan(assessmentId: ObjectId, tasks: List<PlanTask>) =
        PlanDoc(assessmentId = assessmentId, siteId = siteId, userId = userId, tasks = tasks, createdAt = t0, updatedAt = t0)

    @Test
    fun `first ready check has no changes, later checks list tasks completed inside their window`() {
        val a1 = assessment("ready", t0, t0.plusSeconds(120))
        val failed = assessment("failed", t0.plusSeconds(3600), t0.plusSeconds(3660))
        val a2 = assessment("ready", t0.plusSeconds(7200), t0.plusSeconds(7320))
        val a3 = assessment("ready", t0.plusSeconds(14400), t0.plusSeconds(14520))
        val plan1 = plan(a1.id, listOf(
            task("Add a page title", "done", t0.plusSeconds(3000)),          // between a1 and a2 -> a2
            task("Describe your photos", "verified", t0.plusSeconds(7300)),  // set by a2's pipeline -> a2
            task("Still open", "todo", null),
            task("Done later", "done", t0.plusSeconds(10000)),               // between a2 and a3 -> a3
        ))
        val plan2 = plan(a2.id, listOf(
            task("Shorten titles", "verified", t0.plusSeconds(14500)),       // set by a3's pipeline -> a3
        ))

        val changes = changesFor(listOf(a3, failed, a1, a2), listOf(plan2, plan1))

        assertEquals(emptyList(), changes[a1.id])
        assertEquals(emptyList(), changes[failed.id])
        assertEquals(listOf(TaskChangeDto("Add a page title", "done"), TaskChangeDto("Describe your photos", "verified")), changes[a2.id])
        assertEquals(listOf(TaskChangeDto("Done later", "done"), TaskChangeDto("Shorten titles", "verified")), changes[a3.id])
    }

    @Test
    fun `a running assessment has no changes and does not shift the window of the next ready one`() {
        val a1 = assessment("ready", t0, t0.plusSeconds(120))
        val running = assessment("crawling", t0.plusSeconds(500), null)
        val a2 = assessment("ready", t0.plusSeconds(7200), t0.plusSeconds(7320))
        val plan1 = plan(a1.id, listOf(task("Fix", "done", t0.plusSeconds(600))))
        val changes = changesFor(listOf(a1, running, a2), listOf(plan1))
        assertEquals(emptyList(), changes[running.id])
        assertEquals(listOf(TaskChangeDto("Fix", "done")), changes[a2.id])
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.assessment.HistoryTest"`
Expected: compilation error (`changesFor`, `TaskChangeDto` unresolved).

- [ ] **Step 3: Implement the pure function**

Create `backend/src/main/kotlin/app/geostrategy/assessment/History.kt`:

```kotlin
package app.geostrategy.assessment

import app.geostrategy.plans.PlanDoc
import kotlinx.serialization.Serializable
import org.bson.types.ObjectId
import java.time.Instant

@Serializable
data class TaskChangeDto(val title: String, val kind: String)

/**
 * "What changed" per assessment. For a ready assessment N the window is
 * (completedAt of the previous ready assessment, completedAt of N]. Every task of the
 * site with status done or verified whose completedAt falls in that window belongs to N.
 * Failed and running assessments get an empty list. The first ready one gets an empty list
 * unless tasks were completed before it (not possible in practice, but the rule is uniform).
 */
fun changesFor(assessments: List<Assessment>, plans: List<PlanDoc>): Map<ObjectId, List<TaskChangeDto>> {
    val completed = plans.flatMap { p -> p.tasks }
        .filter { (it.status == "done" || it.status == "verified") && it.completedAt != null }
        .sortedBy { it.completedAt }
    val ready = assessments.filter { it.status == "ready" && it.completedAt != null }.sortedBy { it.completedAt }
    val result = HashMap<ObjectId, List<TaskChangeDto>>()
    for (a in assessments) result[a.id] = emptyList()
    var lower: Instant? = null
    for (a in ready) {
        val upper = a.completedAt!!
        result[a.id] = completed
            .filter { t -> val at = t.completedAt!!; (lower == null || at.isAfter(lower)) && !at.isAfter(upper) }
            .map { TaskChangeDto(it.title, it.status) }
        lower = upper
    }
    return result
}
```

- [ ] **Step 4: Run the pure test to verify it passes**

Run: `./gradlew test --tests "app.geostrategy.assessment.HistoryTest"`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing route test**

Add to `ReassessmentTest.kt` (this class already has `makePro`, the HTML fixtures, `MapFetcher`, `Crawler`, `CannedClaudeClient`, `PlanRepository` imports):

```kotlin
    @Test
    fun `history items carry what changed since the previous ready check`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails)
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        runBlocking { makePro(db, "ada@example.com") }
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content

        suspend fun run(html: String) {
            http.post("/v1/sites/$siteId/assessments")
            val pipeline = AssessmentPipeline(deps.assessments, deps.sites, deps.plans, Crawler(MapFetcher(mapOf("https://example.com" to html))), CannedClaudeClient())
            pipeline.handle(deps.jobs.claim()!!)
        }
        run(pageNoMeta)
        // the user marks the first task done between the two checks
        val plan1 = runBlocking { deps.plans.latestFor(ObjectId(siteId))!! }
        val firstTask = plan1.tasks.first()
        assertEquals(HttpStatusCode.OK, http.patch("/v1/plans/${plan1.id.toHexString()}/tasks/${firstTask.taskId}") {
            contentType(ContentType.Application.Json); setBody("""{"status":"done"}""")
        }.status)
        run(pageWithMeta)

        val items = Json.parseToJsonElement(http.get("/v1/sites/$siteId/assessments").bodyAsText()).jsonObject["assessments"]!!.jsonArray
        assertEquals(2, items.size)
        val newest = items[0].jsonObject
        val oldest = items[1].jsonObject
        assertEquals(0, oldest["changes"]!!.jsonArray.size)
        val kinds = newest["changes"]!!.jsonArray.map { it.jsonObject["kind"]!!.jsonPrimitive.content }
        assertTrue("done" in kinds, kinds.toString())
        assertTrue(newest["changes"]!!.jsonArray.any { it.jsonObject["title"]!!.jsonPrimitive.content == firstTask.title })
    }
```

Add these imports to `ReassessmentTest.kt` if missing: `import io.ktor.client.request.patch`, `import kotlinx.serialization.json.jsonArray`, `import app.geostrategy.makePro` (then delete the private `makePro` in the class so the shared one is used).

- [ ] **Step 6: Run the route test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.assessment.ReassessmentTest"`
Expected: FAIL — `changes` is absent from the JSON.

- [ ] **Step 7: Add the repository method and wire the route**

In `Plans.kt`, add to `PlanRepository`:

```kotlin
    suspend fun listFor(siteId: ObjectId): List<PlanDoc> = col.find(eq("siteId", siteId)).toList()
```

Add the import `import kotlinx.coroutines.flow.toList`.

In `AssessmentRoutes.kt`, add `changes` to the DTO as the last field, and give `toDto` a parameter:

```kotlin
    val completedAt: String?,
    val changes: List<TaskChangeDto> = emptyList(),
)

fun Assessment.toDto(changes: List<TaskChangeDto> = emptyList()) = AssessmentDto(
    id = id.toHexString(), siteId = siteId.toHexString(), status = status, scores = scores,
    summary = summary, scoreNotes = scoreNotes, findings = findings,
    pageCount = crawlDigest?.pages?.size,
    errorCode = errorCode, errorMessage = errorMessage,
    createdAt = createdAt.toString(), completedAt = completedAt?.toString(),
    changes = changes,
)
```

Replace the history handler body (`GET /v1/sites/{siteId}/assessments`):

```kotlin
        val list = deps.assessments.listFor(site.id)
        val changes = changesFor(list, deps.plans.listFor(site.id))
        call.respond(AssessmentListResponse(list.map { it.toDto(changes[it.id] ?: emptyList()) }))
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `./gradlew test --tests "app.geostrategy.assessment.ReassessmentTest" --tests "app.geostrategy.assessment.HistoryTest"`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/main/kotlin/app/geostrategy/assessment backend/src/main/kotlin/app/geostrategy/plans/Plans.kt backend/src/test/kotlin/app/geostrategy/assessment
git commit -m "feat(backend): what-changed list on the assessment history"
```

---

### Task 7: `nextCheckAt` on the usage endpoint

**Files:**
- Modify: `backend/src/main/kotlin/app/geostrategy/assessment/Assessment.kt` (repository: `oldestNonFailedForUserSince`)
- Modify: `backend/src/main/kotlin/app/geostrategy/auth/AuthRoutes.kt:22,73-82`
- Test: `backend/src/test/kotlin/app/geostrategy/auth/UsageRouteTest.kt`

**Interfaces:**
- Produces:
  - `AssessmentRepository.oldestNonFailedForUserSince(userId: ObjectId, since: Instant): Assessment?`
  - `UsageResponse(assessmentsUsed, assessmentsLimit, sitesUsed, sitesLimit, nextCheckAt: String?)` — `nextCheckAt` = oldest counted `createdAt` + 30 days when `used >= limit`, else `null`.

- [ ] **Step 1: Update the two exact-JSON assertions and add a test**

In `UsageRouteTest.kt`:

Test `fresh free user with no sites reports zero usage against free-tier limits`: replace the expected string with

```kotlin
            """{"assessmentsUsed":0,"assessmentsLimit":${deps.config.tierLimits.freeAssessmentsPerMonth},"sitesUsed":0,"sitesLimit":${deps.config.tierLimits.freeMaxSites},"nextCheckAt":null}""",
```

Test `usage reflects one site and one non-failed assessment`: the free limit is 1 and one assessment is used, so `nextCheckAt` is set. Replace the exact-string assertion with:

```kotlin
        val body = Json.parseToJsonElement(res.bodyAsText()).jsonObject
        assertEquals(1, body["assessmentsUsed"]!!.jsonPrimitive.content.toInt())
        assertEquals(1, body["sitesUsed"]!!.jsonPrimitive.content.toInt())
        val expected = now.plus(java.time.Duration.ofDays(30)).toString()
        assertEquals(expected, body["nextCheckAt"]!!.jsonPrimitive.content)
```

Add a third test:

```kotlin
    @Test
    fun `nextCheckAt is null while the user is under the limit`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        val deps = testDeps(db, email = emails, env = mapOf("FREE_ASSESSMENTS_PER_MONTH" to "2"))
        application { appModule(deps) }
        val http = createClient { install(HttpCookies) }
        registerVerifyLogin(http, emails, "ada@example.com")
        val siteId = Json.parseToJsonElement(
            http.post("/v1/sites") { contentType(ContentType.Application.Json); setBody("""{"url":"example.com"}""") }.bodyAsText(),
        ).jsonObject["id"]!!.jsonPrimitive.content
        val user = runBlocking { deps.users.findByEmail("ada@example.com")!! }
        val now = Instant.now()
        runBlocking {
            deps.assessments.insert(Assessment(siteId = ObjectId(siteId), userId = user.id, status = "ready", createdAt = now, updatedAt = now))
        }
        val body = Json.parseToJsonElement(http.get("/v1/me/usage").bodyAsText()).jsonObject
        assertEquals(1, body["assessmentsUsed"]!!.jsonPrimitive.content.toInt())
        assertEquals(2, body["assessmentsLimit"]!!.jsonPrimitive.content.toInt())
        assertEquals(kotlinx.serialization.json.JsonNull, body["nextCheckAt"])
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./gradlew test --tests "app.geostrategy.auth.UsageRouteTest"`
Expected: FAIL — `nextCheckAt` is absent.

- [ ] **Step 3: Add the repository query**

In `Assessment.kt`, add to `AssessmentRepository`:

```kotlin
    /** The oldest assessment that the monthly quota counts. Mirrors countNonFailedForUserSince. */
    suspend fun oldestNonFailedForUserSince(userId: ObjectId, since: Instant): Assessment? =
        col.find(and(eq("userId", userId), ne("status", "failed"), gte("createdAt", since)))
            .sort(Sorts.orderBy(Sorts.ascending("createdAt"), Sorts.ascending("_id")))
            .firstOrNull()
```

- [ ] **Step 4: Extend the usage route**

In `AuthRoutes.kt`, replace the `UsageResponse` declaration:

```kotlin
@Serializable data class UsageResponse(val assessmentsUsed: Int, val assessmentsLimit: Int, val sitesUsed: Int, val sitesLimit: Int, val nextCheckAt: String?)
```

Replace the `GET /v1/me/usage` handler body:

```kotlin
    get("/v1/me/usage") {
        val user = call.requireUser(deps)
        // Mirrors the gates exactly, so the meter always matches enforcement:
        // assessment quota gate in AssessmentRoutes.kt, site cap gate in SiteRoutes.kt.
        val since = Instant.now().minus(Duration.ofDays(30))
        val assessmentsUsed = deps.assessments.countNonFailedForUserSince(user.id, since)
        val assessmentsLimit = deps.config.tierLimits.assessmentsPerMonthFor(user.tier)
        val sitesUsed = deps.sites.countFor(user.id)
        val sitesLimit = deps.config.tierLimits.maxSitesFor(user.tier)
        // At the limit, the next check opens when the oldest counted assessment leaves the 30-day window.
        val nextCheckAt = if (assessmentsUsed >= assessmentsLimit) {
            deps.assessments.oldestNonFailedForUserSince(user.id, since)?.createdAt?.plus(Duration.ofDays(30))?.toString()
        } else null
        call.respond(UsageResponse(assessmentsUsed.toInt(), assessmentsLimit, sitesUsed.toInt(), sitesLimit, nextCheckAt))
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./gradlew test --tests "app.geostrategy.auth.UsageRouteTest"`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/kotlin/app/geostrategy/assessment/Assessment.kt backend/src/main/kotlin/app/geostrategy/auth/AuthRoutes.kt backend/src/test/kotlin/app/geostrategy/auth/UsageRouteTest.kt
git commit -m "feat(backend): nextCheckAt on the usage endpoint"
```

---

### Task 8: Docs and the full suite

**Files:**
- Modify: `backend/README.md` (Assessment engine and tier sections)
- Modify: `docs/launch-checklist.md` (section 7)

- [ ] **Step 1: Update `backend/README.md`**

In the "Assessment engine" section, after the tier limits bullet, add:

```markdown
- The plan is a Pro feature. `GET /v1/assessments/{id}/plan` and `GET /v1/sites/{id}/plan`
  return a locked plan for a Free user: task titles, impact, effort, and step count, but no
  steps, no "why it matters", and no done-check. `PATCH /v1/plans/{planId}/tasks/{taskId}`
  answers 403 `upgrade_required` for a Free user.
- The analysis returns `summary` and `scoreNotes` and can add up to two findings with
  severity `good`. The pipeline gives no `good` finding to the plan call.
- Every `scores` object in the API carries a derived `overall` (round half up of the mean).
```

- [ ] **Step 2: Update `docs/launch-checklist.md`**

In section 7, after item 7.1, add:

```markdown
- [ ] 7.1a In the Freemius dashboard, set the Pro price equal to `PRO_PRICE_LABEL` in
      `frontend/src/app/core/config.ts` (default `$9` a month). Keep `FREE_TIER_COPY` and
      `PRO_TIER_COPY` in the same file equal to the tier env values of step 3.2.
```

- [ ] **Step 3: Run the full backend suite**

Run: `./gradlew test`
Expected: PASS, every class green. Fix any test that still asserts the old plan or usage shapes before you continue.

- [ ] **Step 4: Commit**

```bash
git add backend/README.md docs/launch-checklist.md
git commit -m "docs: plan gate, analysis fields and price note for one thing"
```

---

## Self-review against the spec

- §2 tier model: pipeline still writes the plan (unchanged); locked plan for Free (Task 4); downgrade keeps statuses (Task 4 test).
- §3.1 schema, prompts, `good`, canned fixtures (Task 2); pipeline filters `good` (Task 3).
- §3.2 `overall` (Task 1).
- §3.3 `summary`, `scoreNotes`, `pageCount` (Task 3).
- §3.4 `latestAssessment`, `latestReadyAssessmentId` (Task 5).
- §3.5 redaction, `locked`, `stepCount`, PATCH order (Task 4).
- §3.6 `changes` (Task 6).
- §3.7 `nextCheckAt` (Task 7).
- §3.8 unchanged areas: no task touches them.
- §7 backend tests: each bullet maps to a test in Tasks 1–7; old-document decode is covered by nullable defaults and the pipeline resume test.
- §8: README and checklist (Task 8).
