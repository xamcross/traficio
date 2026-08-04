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
