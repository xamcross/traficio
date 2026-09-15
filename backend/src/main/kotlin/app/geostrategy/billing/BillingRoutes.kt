package app.geostrategy.billing

import app.geostrategy.AppDeps
import app.geostrategy.auth.OkResponse
import app.geostrategy.auth.requireUser
import app.geostrategy.http.AppException
import app.geostrategy.users.User
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import kotlinx.serialization.Serializable
import org.slf4j.LoggerFactory
import java.time.Instant

@Serializable data class SandboxDto(val ctx: String, val token: String)
@Serializable data class CheckoutResponse(val planId: String?, val sandbox: SandboxDto?)
@Serializable data class SubscriptionDto(val tier: String, val status: String?, val planId: String?, val currentPeriodEnd: String?)
@Serializable data class PortalLinkDto(val url: String)

private val NO_SUBSCRIPTION = { AppException(HttpStatusCode.Conflict, "no_subscription", "There is no subscription on this account to cancel.") }
private val CANCEL_FAILED = { AppException(HttpStatusCode.BadGateway, "cancel_failed", "We could not reach Freemius to cancel the subscription. Please try again.") }
private val PORTAL_LINK_FAILED = { AppException(HttpStatusCode.BadGateway, "portal_link_failed", "We could not reach Freemius. Please try again.") }
private val billingRoutesLog = LoggerFactory.getLogger("app.geostrategy.billing.BillingRoutes")

private fun User.toSubscriptionDto() = SubscriptionDto(
    tier = tier,
    status = freemius?.subscriptionStatus,
    planId = freemius?.planId,
    currentPeriodEnd = freemius?.expiresAt?.toString(),
)

fun Route.billingRoutes(deps: AppDeps) {
    get("/v1/billing/subscription") {
        val user = call.requireUser(deps)
        call.respond(user.toSubscriptionDto())
    }

    post("/v1/billing/subscription/cancel") {
        val user = call.requireUser(deps)
        val subscriptionId = user.freemius?.subscriptionId ?: throw NO_SUBSCRIPTION()
        if (!deps.freemiusClient.cancelSubscription(subscriptionId)) throw CANCEL_FAILED()
        // Freemius has confirmed the cancellation either way. This write is conditional on the
        // stored subscriptionId still matching: a webhook that changed the billing state
        // concurrently (a new subscription.created, or its own subscription.cancelled) must not
        // be clobbered. The response below re-reads the account, so it reports the state that
        // actually landed rather than blindly repeating "cancelled" over a stale copy.
        if (!deps.users.markSubscriptionCancelled(user.id, subscriptionId)) {
            billingRoutesLog.info("cancel for {}: billing state changed concurrently, responding with the current stored state", user.email)
        }
        call.respond(deps.users.findById(user.id)!!.toSubscriptionDto())
    }

    post("/v1/billing/portal-link") {
        val user = call.requireUser(deps)
        val url = deps.freemiusClient.portalLoginLink(user.email) ?: throw PORTAL_LINK_FAILED()
        call.respond(PortalLinkDto(url))
    }

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
