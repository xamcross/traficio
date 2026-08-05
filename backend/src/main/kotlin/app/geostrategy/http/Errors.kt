package app.geostrategy.http

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.application.log
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respond
import kotlinx.serialization.Serializable

@Serializable
data class ApiError(val code: String, val message: String)

class AppException(
    val status: HttpStatusCode,
    val code: String,
    override val message: String,
) : RuntimeException(message)

fun Application.installErrorHandling() {
    install(StatusPages) {
        exception<AppException> { call, e ->
            call.respond(e.status, ApiError(e.code, e.message))
        }
        exception<BadRequestException> { call, _ ->
            call.respond(
                HttpStatusCode.BadRequest,
                ApiError("invalid_request", "We couldn't read that request. Please check the data and try again."),
            )
        }
        exception<Throwable> { call, e ->
            call.application.log.error("Unhandled exception", e)
            call.respond(
                HttpStatusCode.InternalServerError,
                ApiError("internal_error", "Something went wrong on our side. Please try again."),
            )
        }
    }
}
