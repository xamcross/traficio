package app.geostrategy.jobs

import app.geostrategy.TestMongo
import kotlinx.coroutines.runBlocking
import org.bson.Document
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class JobQueueTest {
    @Test
    fun `claim returns oldest queued job once and complete finishes it`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb())
        val first = q.enqueue("assessment", Document("k", "v1"))
        q.enqueue("assessment", Document("k", "v2"))
        val claimed = q.claim()
        assertNotNull(claimed)
        assertEquals(first.id, claimed.id)
        assertEquals("running", claimed.status)
        assertEquals(1, claimed.attempts)
        q.complete(claimed.id)
        assertEquals("done", q.findById(claimed.id)!!.status)
        // second job still claimable, first is not
        assertEquals("v2", q.claim()!!.payload.getString("k"))
        assertNull(q.claim())
    }

    @Test
    fun `expired lease is re-claimable, exhausted attempts fail the job`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb(), maxAttempts = 2)
        val j = q.enqueue("assessment", Document())
        assertEquals(1, q.claim(leaseSeconds = -10)!!.attempts)  // lease already expired
        assertEquals(2, q.claim(leaseSeconds = -10)!!.attempts)  // re-claimed
        q.fail(j.id, "boom")                                     // attempts == max -> failed
        val failed = q.findById(j.id)!!
        assertEquals("failed", failed.status)
        assertEquals("boom", failed.error)
        assertNull(q.claim())
    }

    @Test
    fun `fail below max attempts re-queues`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb(), maxAttempts = 2)
        val j = q.enqueue("assessment", Document())
        q.claim()
        q.fail(j.id, "transient")
        assertEquals("queued", q.findById(j.id)!!.status)
        assertEquals(true, q.claim() != null)
    }
}
