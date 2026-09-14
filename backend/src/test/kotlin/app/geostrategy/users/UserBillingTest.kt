package app.geostrategy.users

import app.geostrategy.TestMongo
import kotlinx.coroutines.runBlocking
import org.bson.Document
import org.bson.types.ObjectId
import java.time.Instant
import java.util.Date
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class UserBillingTest {
    private fun newUser(email: String) =
        User(email = email, passwordHash = "x", createdAt = Instant.now(), updatedAt = Instant.now())

    @Test
    fun `setBilling upgrades and downgrades with info retained`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val u = repo.insert(newUser("ada@example.com"))
        assertNull(repo.findById(u.id)!!.freemius)

        val info = FreemiusInfo(licenseId = "lic-1", planId = "plan-pro", subscriptionStatus = "active", expiresAt = Instant.now().plusSeconds(3600))
        repo.setBilling(u.id, "pro", info)
        val pro = repo.findById(u.id)!!
        assertEquals("pro", pro.tier)
        assertEquals("lic-1", pro.freemius!!.licenseId)

        repo.setBilling(u.id, "free", info.copy(subscriptionStatus = "expired"))
        val free = repo.findById(u.id)!!
        assertEquals("free", free.tier)
        assertEquals("expired", free.freemius!!.subscriptionStatus)
    }

    @Test
    fun `a document with a legacy freemius userId field still decodes, other freemius fields keep their values`() = runBlocking {
        val db = TestMongo.freshDb()
        val id = ObjectId()
        val now = Date.from(Instant.now())
        // This document predates the removal of the userId field. Production can still hold
        // it, so UserRepository.findById must decode the document and ignore the field.
        db.getCollection<Document>("users").insertOne(
            Document(
                mapOf(
                    "_id" to id,
                    "email" to "legacy@example.com",
                    "emailVerified" to false,
                    "tier" to "pro",
                    "freemius" to Document(
                        mapOf(
                            "userId" to "fs-legacy",
                            "licenseId" to "lic-1",
                            "planId" to "plan-pro",
                            "subscriptionStatus" to "active",
                        ),
                    ),
                    "createdAt" to now,
                    "updatedAt" to now,
                ),
            ),
        )

        val loaded = UserRepository(db).findById(id)!!
        assertEquals("legacy@example.com", loaded.email)
        assertEquals("lic-1", loaded.freemius!!.licenseId)
        assertEquals("plan-pro", loaded.freemius!!.planId)
        assertEquals("active", loaded.freemius!!.subscriptionStatus)
    }

    @Test
    fun `listByTier returns only that tier`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val a = repo.insert(newUser("a@example.com"))
        repo.insert(newUser("b@example.com"))
        repo.setBilling(a.id, "pro", FreemiusInfo(licenseId = "lic-a"))
        assertEquals(listOf("a@example.com"), repo.listByTier("pro").map { it.email })
        assertEquals(listOf("b@example.com"), repo.listByTier("free").map { it.email })
    }
}
