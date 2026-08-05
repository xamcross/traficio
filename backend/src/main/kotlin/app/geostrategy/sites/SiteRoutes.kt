package app.geostrategy.sites

import app.geostrategy.AppDeps
import app.geostrategy.assessment.hostOf
import app.geostrategy.assessment.normalizeUrl
import app.geostrategy.auth.requireUser
import app.geostrategy.claude.Scores
import app.geostrategy.http.AppException
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import kotlinx.serialization.Serializable
import java.time.Instant

@Serializable data class CreateSiteRequest(val url: String)
@Serializable data class SiteDto(val id: String, val domain: String, val url: String, val platform: String?, val latestScores: Scores?)
@Serializable data class SiteListResponse(val sites: List<SiteDto>)

fun Site.toDto() = SiteDto(id.toHexString(), domain, url, platform, latestScores)

fun Route.siteRoutes(deps: AppDeps) {
    post("/v1/sites") {
        val user = call.requireUser(deps)
        val url = normalizeUrl(call.receive<CreateSiteRequest>().url)
        val domain = hostOf(url)
        val max = deps.config.tierLimits.maxSitesFor(user.tier)
        val existing = deps.sites.listFor(user.id)
        // A duplicate domain must surface as 409 site_exists even when the account is
        // already at its tier cap, so only enforce the cap for genuinely new domains.
        if (existing.none { it.domain == domain } && existing.size >= max) {
            throw AppException(HttpStatusCode.Forbidden, "site_limit_reached", "Your plan includes $max site${if (max == 1) "" else "s"}. Upgrade to add more.")
        }
        val now = Instant.now()
        val site = deps.sites.insert(Site(userId = user.id, domain = domain, url = url, createdAt = now, updatedAt = now))
        call.respond(HttpStatusCode.Created, site.toDto())
    }

    get("/v1/sites") {
        val user = call.requireUser(deps)
        call.respond(SiteListResponse(deps.sites.listFor(user.id).map { it.toDto() }))
    }
}
