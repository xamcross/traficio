package app.geostrategy.claude

import kotlinx.serialization.Serializable

@Serializable
data class Scores(val seo: Int, val aeo: Int, val geo: Int)
