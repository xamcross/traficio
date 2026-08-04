package app.geostrategy

import app.geostrategy.persistence.ensureIndexes
import com.mongodb.kotlin.client.coroutine.MongoClient
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import kotlinx.coroutines.runBlocking
import org.testcontainers.containers.MongoDBContainer
import java.util.UUID

object TestMongo {
    private val container: MongoDBContainer by lazy {
        MongoDBContainer("mongo:7.0").also { it.start() }
    }
    private val client: MongoClient by lazy { MongoClient.create(container.connectionString) }

    fun freshDb(): MongoDatabase {
        val db = client.getDatabase("t" + UUID.randomUUID().toString().replace("-", ""))
        runBlocking { ensureIndexes(db) }
        return db
    }
}

class RecordingEmailSender : app.geostrategy.email.EmailSender {
    data class Sent(val to: String, val subject: String, val html: String)
    val sent = mutableListOf<Sent>()
    override suspend fun send(to: String, subject: String, html: String) {
        sent.add(Sent(to, subject, html))
    }
}

fun extractToken(html: String): String =
    Regex("token=([A-Za-z0-9_-]+)").find(html)?.groupValues?.get(1)
        ?: error("no token found in email html")
