package app.geostrategy.billing

import app.geostrategy.users.FreemiusInfo
import app.geostrategy.users.UserRepository
import com.mongodb.MongoWriteException
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import org.bson.Document
import org.slf4j.LoggerFactory

private val UPGRADE_TYPES = setOf("license.created", "license.activated", "subscription.created")
private val DOWNGRADE_TYPES = setOf("payment.refund", "license.expired", "license.cancelled", "license.deactivated")
private val EXPIRY_UPDATE_TYPES = setOf("license.extended")
private val HANDLED_TYPES = UPGRADE_TYPES + DOWNGRADE_TYPES + EXPIRY_UPDATE_TYPES + setOf("subscription.cancelled")

class BillingService(
    private val users: UserRepository,
    private val proPlanId: String?,
    db: MongoDatabase,
) {
    private val log = LoggerFactory.getLogger(BillingService::class.java)
    private val events = db.getCollection<Document>("billingEvents")

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
        // The event id is recorded only once the account is resolved. An event for an unknown
        // email changes nothing. It must not spend its id. A later retry, once the account
        // exists, must still go through.
        if (event.eventId != null && !recordEvent(event.eventId)) {
            log.info("freemius event {} {} was already applied to {}, ignored", event.type, event.eventId, email)
            return
        }
        when {
            event.type in UPGRADE_TYPES -> {
                if (proPlanId != null && event.planId != null && event.planId != proPlanId) {
                    log.info("freemius event {} for non-pro plan {} ignored", event.type, event.planId)
                    return
                }
                val applied = users.setBillingIfNewer(
                    user.id, "pro",
                    FreemiusInfo(
                        licenseId = event.licenseId, planId = event.planId, subscriptionStatus = "active",
                        expiresAt = event.expiresAt, lastEventAt = event.eventTime,
                    ),
                    event.eventTime,
                )
                logIfStale(applied, event, email)
            }
            event.type == "subscription.cancelled" -> {
                val info = user.freemius ?: return
                val applied = users.setBillingIfNewer(
                    user.id, user.tier,
                    info.copy(subscriptionStatus = "cancelled", lastEventAt = event.eventTime ?: info.lastEventAt),
                    event.eventTime,
                )
                logIfStale(applied, event, email)
            }
            // A renewal extends the license. Freemius then sends license.extended with the user
            // and license objects. A payment.created event has no license object. A
            // license.updated event has no user object, so the server cannot find the account.
            // The license id check rejects an event for another license.
            event.type in EXPIRY_UPDATE_TYPES -> {
                val info = user.freemius
                if (info != null && event.licenseId != null && event.licenseId == info.licenseId && event.expiresAt != null) {
                    val applied = users.setBillingIfNewer(
                        user.id, user.tier,
                        info.copy(expiresAt = event.expiresAt, lastEventAt = event.eventTime ?: info.lastEventAt),
                        event.eventTime,
                    )
                    logIfStale(applied, event, email)
                }
            }
            event.type in DOWNGRADE_TYPES -> {
                val info = user.freemius ?: FreemiusInfo()
                val applied = users.setBillingIfNewer(
                    user.id, "free",
                    info.copy(subscriptionStatus = "expired", lastEventAt = event.eventTime ?: info.lastEventAt),
                    event.eventTime,
                )
                logIfStale(applied, event, email)
            }
        }
    }

    /** Logs a stale-event notice when a conditional write did not apply. */
    private fun logIfStale(applied: Boolean, event: FreemiusEvent, email: String) {
        if (!applied) {
            log.info("freemius event {} {} is older than the stored billing state for {}, ignored", event.type, event.eventId, email)
        }
    }

    /**
     * Inserts the event id into the billingEvents collection. The unique index rejects a
     * second insert of the same id. Only one insert can win. This settles a race between two
     * concurrent deliveries of the same event. The return value tells the caller whether this
     * call is the first to record the event.
     */
    private suspend fun recordEvent(eventId: String): Boolean = try {
        events.insertOne(Document("eventId", eventId))
        true
    } catch (e: MongoWriteException) {
        if (e.error.code == 11000) false else throw e
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
