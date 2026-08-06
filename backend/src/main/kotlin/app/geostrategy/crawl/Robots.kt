package app.geostrategy.crawl

class Robots(private val disallowed: List<String>) {
    fun allows(path: String): Boolean = disallowed.none { it.isNotEmpty() && path.startsWith(it) }

    companion object {
        private const val TARGET_UA = "geostrategybot"

        fun parse(txt: String?): Robots {
            if (txt.isNullOrBlank()) return Robots(emptyList())
            // Track Disallow rules per user-agent group. A "group" here is whichever
            // User-agent line was most recently seen, matching the single-token robots.txt
            // style already in use across the fixture set (no comma/multi-agent lines).
            val groups = linkedMapOf<String, MutableList<String>>()
            var currentUa: String? = null
            for (line in txt.lines()) {
                val trimmed = line.substringBefore('#').trim()
                when {
                    trimmed.startsWith("User-agent:", ignoreCase = true) -> {
                        currentUa = trimmed.substringAfter(':').trim().lowercase()
                        groups.getOrPut(currentUa) { mutableListOf() }
                    }
                    trimmed.startsWith("Disallow:", ignoreCase = true) && currentUa != null ->
                        groups.getValue(currentUa).add(trimmed.substringAfter(':').trim())
                }
            }
            // A GeoStrategyBot group, if present, applies exclusively (standard robots.txt
            // precedence: the most specific matching group wins). Otherwise fall back to "*".
            val rules = groups[TARGET_UA] ?: groups["*"] ?: emptyList()
            return Robots(rules)
        }
    }
}
