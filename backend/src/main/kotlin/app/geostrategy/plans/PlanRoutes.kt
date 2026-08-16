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
