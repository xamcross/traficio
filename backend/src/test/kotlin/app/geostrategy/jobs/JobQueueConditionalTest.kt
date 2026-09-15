package app.geostrategy.jobs

import app.geostrategy.TestMongo
import kotlinx.coroutines.runBlocking
import org.bson.Document
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class JobQueueConditionalTest {
    @Test
    fun `complete is a no-op unless the job is running`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb())
        val j = q.enqueue("t", Document())
        q.complete(j)                         // queued, not running -> no-op
        assertEquals("queued", q.findById(j.id)!!.status)
        val claimed = q.claim()!!
        q.complete(claimed)
        assertEquals("done", q.findById(j.id)!!.status)
        q.fail(claimed, "late failure")       // done -> both conditional updates skip
        assertEquals("done", q.findById(j.id)!!.status)
    }

    @Test
    fun `fail still requeues below the cap and fails at the cap`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb(), maxAttempts = 2)
        val j = q.enqueue("t", Document())
        val claim1 = q.claim()!!
        q.fail(claim1, "one")
        assertEquals("queued", q.findById(j.id)!!.status)
        val claim2 = q.claim()!!
        q.fail(claim2, "two")
        assertEquals("failed", q.findById(j.id)!!.status)
        assertEquals("two", q.findById(j.id)!!.error)
    }

    @Test
    fun `complete and fail from an expired holder change nothing after re-claim`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb(), maxAttempts = 5)
        val j = q.enqueue("t", Document())
        val firstHolder = q.claim(leaseSeconds = -10)!!   // lease expires at once
        assertEquals(1, firstHolder.attempts)
        val secondHolder = q.claim(leaseSeconds = 300)!!  // a second worker takes the lease
        assertEquals(2, secondHolder.attempts)

        q.complete(firstHolder)                // stale holder, fenced out -> no-op
        q.fail(firstHolder, "stale failure")   // stale holder, fenced out -> no-op

        val afterStaleCalls = q.findById(j.id)!!
        assertEquals("running", afterStaleCalls.status)
        assertEquals(2, afterStaleCalls.attempts)
        assertNull(afterStaleCalls.error)

        q.complete(secondHolder)               // the current holder still finishes the job
        assertEquals("done", q.findById(j.id)!!.status)
    }
}
