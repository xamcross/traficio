package app.geostrategy.plans

import app.geostrategy.AppDeps
import app.geostrategy.assessment.toObjectIdOr404
import app.geostrategy.auth.requireUser
import app.geostrategy.http.AppException
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.patch
import kotlinx.serialization.Serializable

@Serializable data class PlanTaskDto(val taskId: String, val title: String, val category: String, val impact: String, val effortMinutes: Int, val whyItMatters: String, val steps: List<String>, val doneCheck: String, val status: String)
@Serializable data class PlanProgressDto(val done: Int, val verified: Int, val total: Int)
@Serializable data class PlanDto(val id: String, val assessmentId: String, val siteId: String, val tasks: List<PlanTaskDto>, val progress: PlanProgressDto)
@Serializable data class TaskStatusRequest(val status: String)

fun PlanDoc.toDto(): PlanDto = PlanDto(
    id = id.toHexString(),
    assessmentId = assessmentId.toHexString(),
    siteId = siteId.toHexString(),
    tasks = tasks.map { PlanTaskDto(it.taskId, it.title, it.category, it.impact, it.effortMinutes, it.whyItMatters, it.steps, it.doneCheck, it.status) },
    progress = PlanProgressDto(
        done = tasks.count { it.status == "done" },
        verified = tasks.count { it.status == "verified" },
        total = tasks.size,
    ),
)

private val NOT_FOUND = { AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that plan.") }

fun Route.planRoutes(deps: AppDeps) {
    get("/v1/assessments/{id}/plan") {
        val user = call.requireUser(deps)
        val plan = deps.plans.findByAssessment(call.parameters["id"]!!.toObjectIdOr404())
            ?.takeIf { it.userId == user.id } ?: throw NOT_FOUND()
        call.respond(plan.toDto())
    }

    get("/v1/sites/{siteId}/plan") {
        val user = call.requireUser(deps)
        val plan = deps.plans.latestFor(call.parameters["siteId"]!!.toObjectIdOr404())
            ?.takeIf { it.userId == user.id } ?: throw NOT_FOUND()
        call.respond(plan.toDto())
    }

    patch("/v1/plans/{planId}/tasks/{taskId}") {
        val user = call.requireUser(deps)
        val body = call.receive<TaskStatusRequest>()
        if (body.status !in setOf("todo", "done")) {
            throw AppException(HttpStatusCode.BadRequest, "invalid_status", "A task can only be marked as done or todo.")
        }
        val planId = call.parameters["planId"]!!.toObjectIdOr404()
        deps.plans.findById(planId)?.takeIf { it.userId == user.id } ?: throw NOT_FOUND()
        val updated = deps.plans.updateTaskStatus(planId, call.parameters["taskId"]!!, body.status)
            ?: throw AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that task.")
        call.respond(updated.toDto())
    }
}
