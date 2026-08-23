package app.geostrategy.http

import app.geostrategy.config.AppConfig
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.cors.routing.CORS

/**
 * Allows the SPA origin to call this API with a cookie.
 *
 * `APP_URL` names the one canonical origin. The app also builds email links and the OAuth
 * return address from it, so it stays a single value.
 *
 * `EXTRA_CORS_ORIGINS` holds any further origin that may still call the API. It exists for
 * a move between origins: both the old and the new origin answer during the change, so no
 * request is blocked while DNS and the deploys catch up. Clear it when the move is over.
 */
fun Application.installCors(config: AppConfig) {
    val origins = (listOf(config.appUrl) + config.extraCorsOrigins).distinct()
    install(CORS) {
        origins.forEach { origin ->
            allowHost(origin.substringAfter("://"), schemes = listOf(origin.substringBefore("://")))
        }
        allowCredentials = true
        allowHeader(HttpHeaders.ContentType)
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Patch)
        allowMethod(HttpMethod.Delete)
    }
}
