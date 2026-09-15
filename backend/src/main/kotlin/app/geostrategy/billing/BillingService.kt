package app.geostrategy.billing

import app.geostrategy.users.FreemiusInfo
import app.geostrategy.users.UserRepository
import org.slf4j.LoggerFactory

private val UPGRADE_TYPES = setOf("license.created", "license.activated", "subscription.created")
private val DOWNGRADE_TYPES = setOf("payment.refund", "license.expired", "license.cancelled", "license.deactivated")
private val EXPIRY_UPDATE_TYPES = setOf("license.extended")
private val HANDLED_TYPES = UPGRADE_TYPES + DOWNGRADE_TYPES + EXPIRY_UPDATE_TYPES + setOf("subscription.cancelled")

class BillingService(
    private val users: UserRepository,
    private val proPlanId: String?,
) {
    private val log = LoggerFactory.getLogger(BillingService::class.java)

    suspend fun apply(event: FreemiusEvent) {
        if (event.type !in HANDLED_TYPES) {
            log.info("freemius event {} ignored", event.type)
            return
        }
        val email = event.email ?: run { log.warn("freemius event {} without email", event.type); return }
        val user = users.findByEmail(email) ?: run {
            log.error("freemius event {} for unknown email, license {}", event.type, event.licenseId)
            return
        }
        when {
            event.type in UPGRADE_TYPES -> {
                if (proPlanId != null && event.planId != null && event.planId != proPlanId) {
                    log.info("freemius event {} for non-pro plan {} ignored", event.type, event.planId)
                    return
                }
                users.setBilling(
                    user.id, "pro",
                    FreemiusInfo(licenseId = event.licenseId, planId = event.planId, subscriptionStatus = "active", expiresAt = event.expiresAt),
                )
            }
            event.type == "subscription.cancelled" -> {
                val info = user.freemius ?: return
                users.setBilling(user.id, user.tier, info.copy(subscriptionStatus = "cancelled"))
            }
            // A renewal extends the license. Freemius then sends license.extended with the user
            // and license objects. A payment.created event has no license object. A
            // license.updated event has no user object, so the server cannot find the account.
            // The license id check rejects an event for another license.
            event.type in EXPIRY_UPDATE_TYPES -> {
                val info = user.freemius
                if (info != null && event.licenseId != null && event.licenseId == info.licenseId && event.expiresAt != null) {
                    users.setBilling(user.id, user.tier, info.copy(expiresAt = event.expiresAt))
                }
            }
            event.type in DOWNGRADE_TYPES -> {
                users.setBilling(user.id, "free", (user.freemius ?: FreemiusInfo()).copy(subscriptionStatus = "expired"))
            }
        }
    }
}

interface FreemiusClient {
    suspend fun isLicenseActive(licenseId: String): Boolean?
}

/** Placeholder client: answers "unknown" so only expiry-based downgrades run. */
class CannedFreemiusClient : FreemiusClient {
    override suspend fun isLicenseActive(licenseId: String): Boolean? = null
}

class BillingRevalidator(
    private val users: UserRepository,
    private val client: FreemiusClient,
) {
    private val log = LoggerFactory.getLogger(BillingRevalidator::class.java)

    suspend fun run(now: java.time.Instant = java.time.Instant.now()): Int {
        var downgraded = 0
        for (user in users.listByTier("pro")) {
            val info = user.freemius ?: continue
            val expired = info.expiresAt?.isBefore(now) == true
            val revoked = info.licenseId?.let { client.isLicenseActive(it) } == false
            if (expired || revoked) {
                // Conditional on the billing state we just observed, so a renewal webhook
                // landing concurrently (between the read above and this write) is not clobbered.
                if (users.downgradeProIfMatches(user.id, info.licenseId, info.expiresAt)) {
                    downgraded++
                    log.info("downgraded {} (expired={}, revoked={})", user.email, expired, revoked)
                } else {
                    log.info("skipped downgrade for {}: billing state changed concurrently", user.email)
                }
            }
        }
        return downgraded
    }
}
