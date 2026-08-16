package app.geostrategy.plans

import app.geostrategy.assessment.Assessment
import app.geostrategy.claude.PlanResult
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Sorts
import com.mongodb.client.model.Updates
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.toList
import org.bson.codecs.pojo.annotations.BsonId
import org.bson.types.ObjectId
import java.time.Instant

data class PlanTask(
    val taskId: String,
    val title: String,
    val category: String,
    val impact: String,
    val effortMinutes: Int,
    val whyItMatters: String,
    val steps: List<String>,
    val doneCheck: String,
    val findingId: String?,
    val status: String = "todo",
    val completedAt: Instant? = null,
)

data class PlanDoc(
    @BsonId val id: ObjectId = ObjectId(),
    val assessmentId: ObjectId,
    val siteId: ObjectId,
    val userId: ObjectId,
    val tasks: List<PlanTask>,
    val createdAt: Instant,
    val updatedAt: Instant,
)

private val IMPACT_ORDER = mapOf("high" to 0, "medium" to 1, "low" to 2)

fun buildPlanDoc(assessment: Assessment, result: PlanResult): PlanDoc {
    val now = Instant.now()
    val tasks = result.tasks
        .sortedBy { IMPACT_ORDER[it.impact] ?: 3 }
        .map {
            PlanTask(
                taskId = ObjectId().toHexString(),
                title = it.title, category = it.category, impact = it.impact,
                effortMinutes = it.effortMinutes, whyItMatters = it.whyItMatters,
                steps = it.steps, doneCheck = it.doneCheck, findingId = it.findingId,
            )
        }
    return PlanDoc(
        assessmentId = assessment.id, siteId = assessment.siteId, userId = assessment.userId,
        tasks = tasks, createdAt = now, updatedAt = now,
    )
}

class PlanRepository(db: MongoDatabase) {
    private val col = db.getCollection<PlanDoc>("plans")

    suspend fun insert(doc: PlanDoc): PlanDoc { col.insertOne(doc); return doc }
    suspend fun findById(id: ObjectId): PlanDoc? = col.find(eq("_id", id)).firstOrNull()
    suspend fun findByAssessment(assessmentId: ObjectId): PlanDoc? = col.find(eq("assessmentId", assessmentId)).firstOrNull()
    suspend fun latestFor(siteId: ObjectId): PlanDoc? =
        col.find(eq("siteId", siteId)).sort(Sorts.descending("createdAt")).firstOrNull()
    suspend fun listFor(siteId: ObjectId): List<PlanDoc> = col.find(eq("siteId", siteId)).toList()

    suspend fun updateTaskStatus(planId: ObjectId, taskId: String, status: String): PlanDoc? {
        val doc = findById(planId) ?: return null
        if (doc.tasks.none { it.taskId == taskId }) return null
        val now = Instant.now()
        val updated = doc.tasks.map {
            if (it.taskId == taskId) it.copy(status = status, completedAt = if (status == "done") now else null) else it
        }
        col.updateOne(eq("_id", planId), Updates.combine(
            Updates.set("tasks", updated),
            Updates.set("updatedAt", now),
        ))
        return doc.copy(tasks = updated, updatedAt = now)
    }

    suspend fun markTasksVerified(planId: ObjectId, taskIds: List<String>) {
        if (taskIds.isEmpty()) return
        val doc = findById(planId) ?: return
        val now = Instant.now()
        val updated = doc.tasks.map { if (it.taskId in taskIds) it.copy(status = "verified", completedAt = now) else it }
        col.updateOne(eq("_id", planId), Updates.combine(
            Updates.set("tasks", updated),
            Updates.set("updatedAt", now),
        ))
    }
}
