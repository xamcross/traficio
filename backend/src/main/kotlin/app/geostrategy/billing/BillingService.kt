package app.geostrategy.billing

import app.geostrategy.users.FreemiusInfo
import app.geostrategy.users.UserRepository
import org.slf4j.LoggerFactory

private val UPGRADE_TYPES = setOf("license.created", "license.activated", "subscription.created")
private val DOWNGRADE_TYPES = setOf("payment.refund", "license.expired", "license.cancelled", "license.deactivated")

class BillingService(
    private val users: UserRepository,
    private val proPlanId: String?,
) {
    private val log = LoggerFactory.getLogger(BillingService::class.java)

    suspend fun apply(event: FreemiusEvent) {
        val email = event.email ?: run { log.warn("freemius event {} without email", event.type); return }
        val user = users.findByEmail(email) ?: run { log.warn("freemius event {} for unknown email", event.type); return }
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
            event.type in DOWNGRADE_TYPES -> {
                users.setBilling(user.id, "free", (user.freemius ?: FreemiusInfo()).copy(subscriptionStatus = "expired"))
            }
            else -> log.info("freemius event {} ignored", event.type)
        }
    }
}
