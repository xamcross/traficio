package app.geostrategy.billing

import app.geostrategy.TestMongo
import app.geostrategy.users.FreemiusInfo
import app.geostrategy.users.User
import app.geostrategy.users.UserRepository
import kotlinx.coroutines.runBlocking
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.test.Test
import kotlin.test.assertEquals

class BillingRevalidatorTest {
    private fun newUser(email: String) =
        User(email = email, passwordHash = "x", createdAt = Instant.now(), updatedAt = Instant.now())

    private class FixedFreemiusClient(private val states: Map<String, LicenseState?>) : FreemiusClient {
        override suspend fun checkLicense(licenseId: String) = states[licenseId]
    }

    @Test
    fun `a user whose stored expiresAt is not past is never asked about, and stays pro`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val now = Instant.now()
        val active = repo.insert(newUser("active@example.com"))
        val noInfo = repo.insert(newUser("noinfo@example.com"))
        repo.setBilling(active.id, "pro", FreemiusInfo(licenseId = "l2", expiresAt = now.plusSeconds(3600)))
        repo.setBilling(noInfo.id, "pro", null)

        // The canned client would fail this test if it were ever called: every key is missing,
        // and a missing key answers null ("unknown"), which for a past-due user would go
        // through the grace-period branch instead of skipping the call entirely.
        val client = FixedFreemiusClient(emptyMap())

        val count = BillingRevalidator(repo, client).run(now)

        assertEquals(0, count)
        assertEquals("pro", repo.findById(active.id)!!.tier)
        assertEquals("pro", repo.findById(noInfo.id)!!.tier)
    }

    @Test
    fun `an active license with a later expiration extends the stored expiresAt and does not downgrade`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val now = Instant.now()
        val u = repo.insert(newUser("renewed@example.com"))
        repo.setBilling(u.id, "pro", FreemiusInfo(licenseId = "lic-active", expiresAt = now.minusSeconds(60)))
        // MongoDB stores an Instant with millisecond precision; truncate so the reloaded
        // document's expiresAt compares equal to this nanosecond-precision Instant.now() value.
        val newExpiresAt = now.plusSeconds(30 * 24 * 3600L).truncatedTo(ChronoUnit.MILLIS)
        val client = FixedFreemiusClient(mapOf("lic-active" to LicenseState(active = true, expiresAt = newExpiresAt)))

        val count = BillingRevalidator(repo, client).run(now)

        assertEquals(0, count)
        val reloaded = repo.findById(u.id)!!
        assertEquals("pro", reloaded.tier)
        assertEquals(newExpiresAt, reloaded.freemius!!.expiresAt)
    }

    @Test
    fun `a license that is not active downgrades`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val now = Instant.now()
        val u = repo.insert(newUser("revoked@example.com"))
        repo.setBilling(u.id, "pro", FreemiusInfo(licenseId = "lic-revoked", expiresAt = now.minusSeconds(60)))
        val client = FixedFreemiusClient(mapOf("lic-revoked" to LicenseState(active = false, expiresAt = null)))

        val count = BillingRevalidator(repo, client).run(now)

        assertEquals(1, count)
        assertEquals("free", repo.findById(u.id)!!.tier)
    }

    @Test
    fun `an unknown answer for a user 1 day past due does not downgrade, but 4 days past due does`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val now = Instant.now()
        val recent = repo.insert(newUser("recent@example.com"))
        val stale = repo.insert(newUser("stale@example.com"))
        repo.setBilling(recent.id, "pro", FreemiusInfo(licenseId = "lic-recent", expiresAt = now.minusSeconds(24 * 3600L)))
        repo.setBilling(stale.id, "pro", FreemiusInfo(licenseId = "lic-stale", expiresAt = now.minusSeconds(4 * 24 * 3600L)))
        // Both licenses answer "unknown" (a 500, in the real client's terms).
        val client = FixedFreemiusClient(mapOf("lic-recent" to null, "lic-stale" to null))

        val count = BillingRevalidator(repo, client).run(now)

        assertEquals(1, count)
        assertEquals("pro", repo.findById(recent.id)!!.tier)
        assertEquals("free", repo.findById(stale.id)!!.tier)
    }

    @Test
    fun `without a FREEMIUS_API_TOKEN the canned client's unknown answers give every past-due user its grace period`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val now = Instant.now()
        val expired = repo.insert(newUser("expired@example.com"))
        repo.setBilling(expired.id, "pro", FreemiusInfo(licenseId = "l1", expiresAt = now.minusSeconds(60)))

        val count = BillingRevalidator(repo, CannedFreemiusClient()).run(now)

        assertEquals(0, count)
        assertEquals("pro", repo.findById(expired.id)!!.tier)
    }
}
