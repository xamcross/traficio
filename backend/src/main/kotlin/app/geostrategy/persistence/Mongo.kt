package app.geostrategy.persistence

import com.mongodb.client.model.IndexOptions
import com.mongodb.client.model.Indexes
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import org.bson.Document
import java.util.concurrent.TimeUnit

suspend fun ensureIndexes(db: MongoDatabase) {
    db.getCollection<Document>("users")
        .createIndex(Indexes.ascending("email"), IndexOptions().unique(true))
    db.getCollection<Document>("tokens")
        .createIndex(Indexes.ascending("tokenHash"), IndexOptions().unique(true))
    db.getCollection<Document>("tokens")
        .createIndex(Indexes.ascending("expiresAt"), IndexOptions().expireAfter(0, TimeUnit.SECONDS))
    db.getCollection<Document>("sessions")
        .createIndex(Indexes.ascending("tokenHash"), IndexOptions().unique(true))
    db.getCollection<Document>("sessions")
        .createIndex(Indexes.ascending("expiresAt"), IndexOptions().expireAfter(0, TimeUnit.SECONDS))
    db.getCollection<Document>("sessions")
        .createIndex(Indexes.ascending("userId"))
}
