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
