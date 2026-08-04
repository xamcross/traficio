package app.geostrategy

import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals

class HealthzTest {
    @Test
    fun `healthz returns 200`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }
        val res = client.get("/healthz")
        assertEquals(HttpStatusCode.OK, res.status)
    }
}
