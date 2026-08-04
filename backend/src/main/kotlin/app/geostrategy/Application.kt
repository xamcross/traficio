package app.geostrategy

import app.geostrategy.config.AppConfig
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.calllogging.CallLogging
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.serialization.json.Json

fun main() {
    val config = AppConfig.fromEnv()
    embeddedServer(Netty, port = config.port) { appModule(config) }.start(wait = true)
}

fun Application.appModule(config: AppConfig) {
    install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true; encodeDefaults = true }) }
    install(CallLogging)
    routing {
        get("/healthz") { call.respondText("ok") }
    }
}
