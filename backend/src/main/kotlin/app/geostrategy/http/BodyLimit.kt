package app.geostrategy.http

import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.bodylimit.RequestBodyLimit
import io.ktor.server.request.path

/**
 * The cap for the Freemius webhook, in bytes. A caller needs no account and no valid
 * signature to reach this route, so the cap must be small. 64 KB is the value from the
 * launch issue. Measure one real Freemius webhook body before launch, and raise this
 * value if 64 KB is less than four times that body's size.
 */
const val WEBHOOK_BODY_LIMIT_BYTES = 64L * 1024

/** The cap for every other route, in bytes. A JSON request body never needs more than this. */
const val DEFAULT_BODY_LIMIT_BYTES = 16L * 1024

private const val WEBHOOK_PATH = "/v1/billing/freemius/webhook"

/**
 * Caps the size of every request body on every route. The API runs on one small Fly
 * machine, so an unbounded body can use up all its memory. The plugin counts bytes as
 * it reads the body, so it also stops a caller who sends no Content-Length header.
 */
fun Application.installBodyLimit() {
    install(RequestBodyLimit) {
        bodyLimit { call ->
            if (call.request.path() == WEBHOOK_PATH) WEBHOOK_BODY_LIMIT_BYTES else DEFAULT_BODY_LIMIT_BYTES
        }
    }
}
