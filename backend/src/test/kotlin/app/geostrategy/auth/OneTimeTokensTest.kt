package app.geostrategy.auth

import app.geostrategy.TestMongo
import kotlinx.coroutines.runBlocking
import org.bson.types.ObjectId
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class OneTimeTokensTest {
    @Test
    fun `issue then consume returns userId exactly once`() = runBlocking {
        val svc = OneTimeTokenService(TestMongo.freshDb())
        val userId = ObjectId()
        val raw = svc.issue(userId, TokenPurpose.VERIFY_EMAIL, Duration.ofHours(1))
        assertEquals(userId, svc.consume(raw, TokenPurpose.VERIFY_EMAIL))
        assertNull(svc.consume(raw, TokenPurpose.VERIFY_EMAIL)) // single use
    }

    @Test
    fun `wrong purpose and expired tokens are rejected`() = runBlocking {
        val svc = OneTimeTokenService(TestMongo.freshDb())
        val userId = ObjectId()
        val wrongPurpose = svc.issue(userId, TokenPurpose.VERIFY_EMAIL, Duration.ofHours(1))
        assertNull(svc.consume(wrongPurpose, TokenPurpose.PASSWORD_RESET))
        val expired = svc.issue(userId, TokenPurpose.PASSWORD_RESET, Duration.ofSeconds(-5))
        assertNull(svc.consume(expired, TokenPurpose.PASSWORD_RESET))
    }

    @Test
    fun `unknown token returns null`() = runBlocking {
        val svc = OneTimeTokenService(TestMongo.freshDb())
        assertNull(svc.consume("not-a-real-token", TokenPurpose.VERIFY_EMAIL))
    }
}
