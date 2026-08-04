package app.geostrategy.auth

import app.geostrategy.TestMongo
import kotlinx.coroutines.runBlocking
import org.bson.types.ObjectId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SessionsTest {
    @Test
    fun `create then resolve then revoke`() = runBlocking {
        val svc = SessionService(TestMongo.freshDb())
        val userId = ObjectId()
        val raw = svc.create(userId)
        assertEquals(userId, svc.userIdFor(raw))
        svc.revoke(raw)
        assertNull(svc.userIdFor(raw))
    }

    @Test
    fun `revokeAllFor kills every session of that user only`() = runBlocking {
        val svc = SessionService(TestMongo.freshDb())
        val alice = ObjectId(); val bob = ObjectId()
        val a1 = svc.create(alice); val a2 = svc.create(alice); val b1 = svc.create(bob)
        svc.revokeAllFor(alice)
        assertNull(svc.userIdFor(a1))
        assertNull(svc.userIdFor(a2))
        assertEquals(bob, svc.userIdFor(b1))
    }

    @Test
    fun `unknown token resolves to null`() = runBlocking {
        val svc = SessionService(TestMongo.freshDb())
        assertNull(svc.userIdFor("bogus"))
    }
}
