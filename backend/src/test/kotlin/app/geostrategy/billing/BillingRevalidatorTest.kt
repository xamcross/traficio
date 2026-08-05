package app.geostrategy.billing

import app.geostrategy.TestMongo
import app.geostrategy.users.FreemiusInfo
import app.geostrategy.users.User
import app.geostrategy.users.UserRepository
import kotlinx.coroutines.runBlocking
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals

class BillingRevalidatorTest {
    private fun newUser(email: String) =
        User(email = email, passwordHash = "x", createdAt = Instant.now(), updatedAt = Instant.now())

    @Test
    fun `expired pro users downgrade, active ones stay, canned client changes nothing else`() = runBlocking {
        val db = TestMongo.freshDb()
        val repo = UserRepository(db)
        val now = Instant.now()
        val expired = repo.insert(newUser("expired@example.com"))
        val active = repo.insert(newUser("active@example.com"))
        val noInfo = repo.insert(newUser("noinfo@example.com"))
        repo.setBilling(expired.id, "pro", FreemiusInfo(licenseId = "l1", expiresAt = now.minusSeconds(60)))
        repo.setBilling(active.id, "pro", FreemiusInfo(licenseId = "l2", expiresAt = now.plusSeconds(3600)))
        repo.setBilling(noInfo.id, "pro", null)

        val count = BillingRevalidator(repo, CannedFreemiusClient()).run(now)

        assertEquals(1, count)
        assertEquals("free", repo.findById(expired.id)!!.tier)
        assertEquals("expired", repo.findById(expired.id)!!.freemius!!.subscriptionStatus)
        assertEquals("pro", repo.findById(active.id)!!.tier)
        assertEquals("pro", repo.findById(noInfo.id)!!.tier)
    }

    @Test
    fun `client saying inactive downgrades even before expiry`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val u = repo.insert(newUser("revoked@example.com"))
        repo.setBilling(u.id, "pro", FreemiusInfo(licenseId = "lic-revoked", expiresAt = Instant.now().plusSeconds(3600)))
        val client = object : FreemiusClient {
            override suspend fun isLicenseActive(licenseId: String) = licenseId != "lic-revoked"
        }
        assertEquals(1, BillingRevalidator(repo, client).run())
        assertEquals("free", repo.findById(u.id)!!.tier)
    }
}
