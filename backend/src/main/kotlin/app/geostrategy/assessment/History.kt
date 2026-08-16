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
