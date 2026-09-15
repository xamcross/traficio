package app.geostrategy.billing

import app.geostrategy.AppDeps
import app.geostrategy.auth.OkResponse
import app.geostrategy.auth.requireUser
import app.geostrategy.http.AppException
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import kotlinx.serialization.Serializable
import java.time.Instant

@Serializable data class SandboxDto(val ctx: String, val token: String)
@Serializable data class CheckoutResponse(val planId: String?, val sandbox: SandboxDto?)

fun Route.billingRoutes(deps: AppDeps) {
    get("/v1/billing/checkout") {
        val user = call.requireUser(deps)
        val cfg = deps.config
        val secretKey = cfg.freemiusSecretKey
        val publicKey = cfg.freemiusPublicKey
        val sandbox = if (secretKey != null && publicKey != null && user.email in cfg.freemiusSandboxEmails) {
            val ctx = Instant.now().epochSecond.toString()
            SandboxDto(ctx = ctx, token = freemiusSandboxToken(ctx, secretKey, publicKey))
        } else {
            null
        }
        call.respond(CheckoutResponse(planId = cfg.freemiusProPlanId, sandbox = sandbox))
    }

    post("/v1/billing/freemius/webhook") {
        val secret = deps.config.freemiusSecretKey
        val billing = deps.billing
        if (secret == null || billing == null) {
            throw AppException(HttpStatusCode.ServiceUnavailable, "billing_not_configured", "Billing is not set up on this server yet.")
        }
        val rawBytes = call.receive<ByteArray>()
        val signature = call.request.headers[deps.config.freemiusSignatureHeader]
        if (!FreemiusWebhookVerifier(secret).verify(rawBytes, signature)) {
            throw AppException(HttpStatusCode.Unauthorized, "invalid_signature", "The webhook signature does not match.")
        }
        val raw = String(rawBytes, Charsets.UTF_8)
        parseFreemiusEvent(raw)?.let { billing.apply(it) }
        call.respond(OkResponse())
    }
}
