package app.geostrategy.claude

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ScoresTest {
    @Test
    fun `overall is the rounded mean, half up`() {
        assertEquals(41, Scores(62, 34, 28).overall)   // 41.33 -> 41
        assertEquals(50, Scores(50, 50, 49).overall)   // 49.67 -> 50
        assertEquals(51, Scores(51, 51, 50).overall)   // 50.67 -> 51
        assertEquals(1, Scores(1, 1, 2).overall)       // 1.33 -> 1
        assertEquals(2, Scores(1, 2, 2).overall)       // 1.67 -> 2
        assertEquals(0, Scores(0, 0, 0).overall)
        assertEquals(100, Scores(100, 100, 100).overall)
    }

    @Test
    fun `overall is encoded to json and derived again on decode`() {
        val json = Json
        val encoded = json.encodeToString(Scores.serializer(), Scores(62, 34, 28))
        assertTrue(encoded.contains("\"overall\":41"), encoded)
        val decoded = json.decodeFromString(Scores.serializer(), """{"seo":62,"aeo":34,"geo":28}""")
        assertEquals(41, decoded.overall)
        // equality ignores the derived value: two Scores with the same inputs are equal
        assertEquals(Scores(62, 34, 28), decoded)
    }
}
