package app.geostrategy.sites

import app.geostrategy.AppDeps
import app.geostrategy.assessment.Assessment
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
import org.bson.types.ObjectId
import java.time.Instant

@Serializable data class CreateSiteRequest(val url: String)
@Serializable data class LatestAssessmentDto(val id: String, val status: String, val createdAt: String, val completedAt: String?)
@Serializable data class SiteDto(
    val id: String,
    val domain: String,
    val url: String,
    val platform: String?,
    val latestScores: Scores?,
    val readOnly: Boolean,
    val latestAssessment: LatestAssessmentDto?,
    val latestReadyAssessmentId: String?,
)
@Serializable data class SiteListResponse(val sites: List<SiteDto>)

fun Site.toDto(readOnly: Boolean, latest: Assessment? = null, latestReady: Assessment? = null) = SiteDto(
    id = id.toHexString(), domain = domain, url = url, platform = platform, latestScores = latestScores, readOnly = readOnly,
    latestAssessment = latest?.let { LatestAssessmentDto(it.id.toHexString(), it.status, it.createdAt.toString(), it.completedAt?.toString()) },
    latestReadyAssessmentId = latestReady?.id?.toHexString(),
)

fun allowedSiteIds(sites: List<Site>, max: Int): Set<ObjectId> =
    sites.sortedWith(compareBy({ it.createdAt }, { it.id })).take(max).map { it.id }.toSet()

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
        // A concurrent request may have inserted its own site between the check above and
        // this insert; recheck the true count and roll back this insert if it pushed the
        // account over its cap.
        if (deps.sites.countFor(user.id) > max) {
            deps.sites.delete(site.id)
            throw AppException(HttpStatusCode.Forbidden, "site_limit_reached", "Your plan includes $max site${if (max == 1) "" else "s"}. Upgrade to add more.")
        }
        call.respond(HttpStatusCode.Created, site.toDto(readOnly = false))
    }

    get("/v1/sites") {
        val user = call.requireUser(deps)
        val sites = deps.sites.listFor(user.id)
        val allowed = allowedSiteIds(sites, deps.config.tierLimits.maxSitesFor(user.tier))
        val dtos = sites.map { site ->
            site.toDto(
                readOnly = site.id !in allowed,
                latest = deps.assessments.latestFor(site.id),
                latestReady = deps.assessments.latestReadyFor(site.id),
            )
        }
        call.respond(SiteListResponse(dtos))
    }
}
