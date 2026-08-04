package app.geostrategy.email

import org.slf4j.LoggerFactory

interface EmailSender {
    suspend fun send(to: String, subject: String, html: String)
}

class LoggingEmailSender : EmailSender {
    private val log = LoggerFactory.getLogger(LoggingEmailSender::class.java)
    override suspend fun send(to: String, subject: String, html: String) {
        log.info("EMAIL (not sent, no RESEND_API_KEY) to={} subject={} html={}", to, subject, html)
    }
}
