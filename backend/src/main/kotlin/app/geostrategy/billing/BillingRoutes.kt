package app.geostrategy.billing

import app.geostrategy.AppDeps
import app.geostrategy.auth.OkResponse
import app.geostrategy.http.AppException
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receiveText
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post

fun Route.billingRoutes(deps: AppDeps) {
    post("/v1/billing/freemius/webhook") {
        val secret = deps.config.freemiusSecretKey
        val billing = deps.billing
        if (secret == null || billing == null) {
            throw AppException(HttpStatusCode.ServiceUnavailable, "billing_not_configured", "Billing is not set up on this server yet.")
        }
        val raw = call.receiveText()
        val signature = call.request.headers[deps.config.freemiusSignatureHeader]
        if (!FreemiusWebhookVerifier(secret).verify(raw, signature)) {
            throw AppException(HttpStatusCode.Unauthorized, "invalid_signature", "The webhook signature does not match.")
        }
        parseFreemiusEvent(raw)?.let { billing.apply(it) }
        call.respond(OkResponse())
    }
}
