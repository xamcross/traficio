package app.geostrategy.jobs

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory

class JobWorker(
    private val queue: JobQueue,
    private val handlers: Map<String, suspend (Job) -> Unit>,
    private val pollMillis: Long = 1000,
) {
    private val log = LoggerFactory.getLogger(JobWorker::class.java)

    fun start(scope: CoroutineScope): kotlinx.coroutines.Job = scope.launch {
        while (isActive) {
            val job = queue.claim()
            if (job == null) {
                delay(pollMillis)
                continue
            }
            try {
                val handler = handlers[job.type] ?: error("no handler registered for job type '${job.type}'")
                handler(job)
                queue.complete(job.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.warn("job {} ({}) attempt {} failed: {}", job.id, job.type, job.attempts, e.message)
                queue.fail(job.id, e.message ?: "unknown error")
            }
        }
    }
}
