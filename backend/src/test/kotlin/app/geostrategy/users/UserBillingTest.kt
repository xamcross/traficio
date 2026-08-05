package app.geostrategy.users

import app.geostrategy.TestMongo
import kotlinx.coroutines.runBlocking
import java.time.Instant
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

        val info = FreemiusInfo(userId = "fs-1", licenseId = "lic-1", planId = "plan-pro", subscriptionStatus = "active", expiresAt = Instant.now().plusSeconds(3600))
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
    fun `listByTier returns only that tier`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val a = repo.insert(newUser("a@example.com"))
        repo.insert(newUser("b@example.com"))
        repo.setBilling(a.id, "pro", FreemiusInfo(licenseId = "lic-a"))
        assertEquals(listOf("a@example.com"), repo.listByTier("pro").map { it.email })
        assertEquals(listOf("b@example.com"), repo.listByTier("free").map { it.email })
    }
}
