package app.geostrategy.jobs

import app.geostrategy.TestMongo
import kotlinx.coroutines.runBlocking
import org.bson.Document
import kotlin.test.Test
import kotlin.test.assertEquals

class JobQueueConditionalTest {
    @Test
    fun `complete is a no-op unless the job is running`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb())
        val j = q.enqueue("t", Document())
        q.complete(j.id)                      // queued, not running -> no-op
        assertEquals("queued", q.findById(j.id)!!.status)
        q.claim()
        q.complete(j.id)
        assertEquals("done", q.findById(j.id)!!.status)
        q.fail(j.id, "late failure")          // done -> both conditional updates skip
        assertEquals("done", q.findById(j.id)!!.status)
    }

    @Test
    fun `fail still requeues below the cap and fails at the cap`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb(), maxAttempts = 2)
        val j = q.enqueue("t", Document())
        q.claim(); q.fail(j.id, "one")
        assertEquals("queued", q.findById(j.id)!!.status)
        q.claim(); q.fail(j.id, "two")
        assertEquals("failed", q.findById(j.id)!!.status)
        assertEquals("two", q.findById(j.id)!!.error)
    }
}
