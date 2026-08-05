package app.geostrategy.assessment

import app.geostrategy.AppDeps
import app.geostrategy.auth.requireUser
import app.geostrategy.claude.Finding
import app.geostrategy.claude.Scores
import app.geostrategy.http.AppException
import app.geostrategy.sites.allowedSiteIds
import io.ktor.http.CacheControl
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.response.cacheControl
import io.ktor.server.response.respond
import io.ktor.server.response.respondTextWriter
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable
import org.bson.Document
import org.bson.types.ObjectId
import java.time.Duration
import java.time.Instant

@Serializable
data class AssessmentListResponse(val assessments: List<AssessmentDto>)

@Serializable
data class AssessmentDto(
    val id: String,
    val siteId: String,
    val status: String,
    val scores: Scores?,
    val findings: List<Finding>,
    val errorCode: String?,
    val errorMessage: String?,
    val createdAt: String,
    val completedAt: String?,
)

fun Assessment.toDto() = AssessmentDto(
    id = id.toHexString(), siteId = siteId.toHexString(), status = status, scores = scores,
    findings = findings, errorCode = errorCode, errorMessage = errorMessage,
    createdAt = createdAt.toString(), completedAt = completedAt?.toString(),
)

fun Route.assessmentRoutes(deps: AppDeps) {
    post("/v1/sites/{siteId}/assessments") {
        val user = call.requireUser(deps)
        if (!user.emailVerified) {
            throw AppException(HttpStatusCode.Forbidden, "email_not_verified", "Please confirm your email first. Check your inbox for the link, or ask for a new one in your account settings.")
        }
        val site = deps.sites.findById(call.parameters["siteId"]!!.toObjectIdOr404())
            ?.takeIf { it.userId == user.id }
            ?: throw AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that site.")

        val allowed = allowedSiteIds(deps.sites.listFor(user.id), deps.config.tierLimits.maxSitesFor(user.tier))
        if (site.id !in allowed) {
            throw AppException(HttpStatusCode.Forbidden, "site_read_only", "This site is read-only on your current plan. Upgrade to work with it again.")
        }

        if (deps.assessments.anyNonFailedFor(site.id) && user.tier != "pro") {
            throw AppException(HttpStatusCode.Forbidden, "upgrade_required", "Re-checking your site is a Pro feature. Upgrade to track your progress over time.")
        }

        val limit = deps.config.tierLimits.assessmentsPerMonthFor(user.tier)
        val used = deps.assessments.countNonFailedForUserSince(user.id, Instant.now().minus(Duration.ofDays(30)))
        if (used >= limit) {
            val noun = if (limit == 1) "assessment" else "assessments"
            throw AppException(HttpStatusCode.Forbidden, "quota_exceeded", "You've used your $limit $noun for this month. Upgrade for more.")
        }

        deps.ssrf.check(site.domain)

        val now = Instant.now()
        val assessment = deps.assessments.insert(Assessment(siteId = site.id, userId = user.id, createdAt = now, updatedAt = now))
        // A concurrent submission may have inserted its own assessment between the quota
        // check above and this insert; recheck the true count and roll back this insert
        // (before it's ever enqueued) if it pushed the account over its monthly quota.
        val recount = deps.assessments.countNonFailedForUserSince(user.id, Instant.now().minus(Duration.ofDays(30)))
        if (recount > limit) {
            deps.assessments.delete(assessment.id)
            val noun = if (limit == 1) "assessment" else "assessments"
            throw AppException(HttpStatusCode.Forbidden, "quota_exceeded", "You've used your $limit $noun for this month. Upgrade for more.")
        }
        deps.jobs.enqueue("assessment", Document("assessmentId", assessment.id))
        call.respond(HttpStatusCode.Accepted, assessment.toDto())
    }

    get("/v1/sites/{siteId}/assessments") {
        val user = call.requireUser(deps)
        val site = deps.sites.findById(call.parameters["siteId"]!!.toObjectIdOr404())
            ?.takeIf { it.userId == user.id }
            ?: throw AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that site.")
        if (user.tier != "pro") {
            throw AppException(HttpStatusCode.Forbidden, "upgrade_required", "Score history is a Pro feature. Upgrade to see your progress over time.")
        }
        call.respond(AssessmentListResponse(deps.assessments.listFor(site.id).map { it.toDto() }))
    }

    get("/v1/assessments/{id}") {
        val user = call.requireUser(deps)
        val a = deps.assessments.findById(call.parameters["id"]!!.toObjectIdOr404())
            ?.takeIf { it.userId == user.id }
            ?: throw AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that assessment.")
        call.respond(a.toDto())
    }

    get("/v1/assessments/{id}/events") {
        val user = call.requireUser(deps)
        val id = call.parameters["id"]!!.toObjectIdOr404()
        deps.assessments.findById(id)?.takeIf { it.userId == user.id }
            ?: throw AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that assessment.")
        call.response.cacheControl(CacheControl.NoCache(null))
        call.respondTextWriter(contentType = ContentType.Text.EventStream) {
            var last: String? = null
            while (true) {
                val current = deps.assessments.findById(id) ?: break
                if (current.status != last) {
                    write("data: {\"status\":\"${current.status}\"}\n\n")
                    flush()
                    last = current.status
                }
                if (current.status in TERMINAL_STATUSES) break
                delay(1000)
            }
        }
    }
}
