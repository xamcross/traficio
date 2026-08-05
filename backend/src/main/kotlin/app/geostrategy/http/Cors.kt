package app.geostrategy.http

import app.geostrategy.config.AppConfig
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.cors.routing.CORS

fun Application.installCors(config: AppConfig) {
    val appScheme = config.appUrl.substringBefore("://")
    val appHost = config.appUrl.substringAfter("://")
    install(CORS) {
        allowHost(appHost, schemes = listOf(appScheme))
        allowCredentials = true
        allowHeader(HttpHeaders.ContentType)
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Patch)
        allowMethod(HttpMethod.Delete)
    }
}
