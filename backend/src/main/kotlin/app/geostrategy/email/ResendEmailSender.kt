package app.geostrategy.email

import io.ktor.client.HttpClient
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable

@Serializable
private data class ResendRequest(val from: String, val to: List<String>, val subject: String, val html: String)

class ResendEmailSender(
    private val apiKey: String,
    private val from: String,
    private val http: HttpClient,
) : EmailSender {
    override suspend fun send(to: String, subject: String, html: String) {
        val res = http.post("https://api.resend.com/emails") {
            header(HttpHeaders.Authorization, "Bearer $apiKey")
            contentType(ContentType.Application.Json)
            setBody(ResendRequest(from = from, to = listOf(to), subject = subject, html = html))
        }
        check(res.status.isSuccess()) { "Resend rejected the email: HTTP ${res.status.value}" }
    }
}
