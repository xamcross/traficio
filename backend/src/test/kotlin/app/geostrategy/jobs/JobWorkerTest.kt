package app.geostrategy.jobs

import app.geostrategy.TestMongo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.bson.Document
import kotlin.test.Test
import kotlin.test.assertEquals

class JobWorkerTest {
    private suspend fun awaitStatus(q: JobQueue, id: org.bson.types.ObjectId, status: String) =
        withTimeout(10_000) {
            while (q.findById(id)!!.status != status) delay(50)
        }

    @Test
    fun `worker runs handler and completes the job`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb())
        val seen = mutableListOf<String>()
        val worker = JobWorker(q, mapOf("greet" to { job -> seen.add(job.payload.getString("name")) }), pollMillis = 50)
        val j = q.enqueue("greet", Document("name", "ada"))
        val handle = worker.start(CoroutineScope(Dispatchers.Default))
        awaitStatus(q, j.id, "done")
        handle.cancelAndJoin()
        assertEquals(listOf("ada"), seen)
    }

    @Test
    fun `failing handler retries then fails the job`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb(), maxAttempts = 2)
        var calls = 0
        val worker = JobWorker(q, mapOf("boom" to { _ -> calls++; error("nope") }), pollMillis = 50)
        val j = q.enqueue("boom", Document())
        val handle = worker.start(CoroutineScope(Dispatchers.Default))
        awaitStatus(q, j.id, "failed")
        handle.cancelAndJoin()
        assertEquals(2, calls)
        assertEquals("nope", q.findById(j.id)!!.error)
    }

    @Test
    fun `unknown job type fails without crashing the worker`() = runBlocking {
        val q = JobQueue(TestMongo.freshDb(), maxAttempts = 1)
        val worker = JobWorker(q, emptyMap(), pollMillis = 50)
        val j = q.enqueue("mystery", Document())
        val handle = worker.start(CoroutineScope(Dispatchers.Default))
        awaitStatus(q, j.id, "failed")
        handle.cancelAndJoin()
    }
}
