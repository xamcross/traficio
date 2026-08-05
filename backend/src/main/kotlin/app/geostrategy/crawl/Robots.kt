package app.geostrategy.crawl

class Robots(private val disallowed: List<String>) {
    fun allows(path: String): Boolean = disallowed.none { it.isNotEmpty() && path.startsWith(it) }

    companion object {
        fun parse(txt: String?): Robots {
            if (txt.isNullOrBlank()) return Robots(emptyList())
            val rules = mutableListOf<String>()
            var inStarGroup = false
            for (line in txt.lines()) {
                val trimmed = line.substringBefore('#').trim()
                when {
                    trimmed.startsWith("User-agent:", ignoreCase = true) ->
                        inStarGroup = trimmed.substringAfter(':').trim() == "*"
                    trimmed.startsWith("Disallow:", ignoreCase = true) && inStarGroup ->
                        rules.add(trimmed.substringAfter(':').trim())
                }
            }
            return Robots(rules)
        }
    }
}
