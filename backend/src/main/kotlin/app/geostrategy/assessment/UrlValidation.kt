package app.geostrategy.assessment

import app.geostrategy.http.AppException
import io.ktor.http.HttpStatusCode
import org.bson.types.ObjectId
import java.net.InetAddress
import java.net.URI

private val INVALID = { AppException(HttpStatusCode.BadRequest, "invalid_url", "That doesn't look like a website address. Try something like example.com.") }

fun normalizeUrl(raw: String): String {
    var s = raw.trim()
    if (s.isEmpty() || s.any { it.isWhitespace() }) throw INVALID()
    if (!s.startsWith("http://", ignoreCase = true) && !s.startsWith("https://", ignoreCase = true)) {
        if ("://" in s) throw AppException(HttpStatusCode.BadRequest, "invalid_url", "Only http and https websites are supported.")
        s = "https://$s"
    }
    val uri = try { URI(s) } catch (e: Exception) { throw INVALID() }
    val scheme = uri.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") {
        throw AppException(HttpStatusCode.BadRequest, "invalid_url", "Only http and https websites are supported.")
    }
    val host = uri.host?.lowercase() ?: throw INVALID()
    val port = if (uri.port == -1 || uri.port == 80 && scheme == "http" || uri.port == 443 && scheme == "https") "" else ":${uri.port}"
    val path = uri.rawPath?.takeIf { it.isNotEmpty() && it != "/" }?.trimEnd('/') ?: ""
    return "$scheme://$host$port$path"
}

fun hostOf(normalizedUrl: String): String = URI(normalizedUrl).host

class SsrfGuard(
    private val resolve: (String) -> List<InetAddress> = { InetAddress.getAllByName(it).toList() },
) {
    fun check(host: String) {
        val addresses = try { resolve(host) } catch (e: Exception) {
            throw AppException(HttpStatusCode.BadRequest, "site_unreachable", "We couldn't find that website. Double-check the address and try again.")
        }
        if (addresses.isEmpty()) {
            throw AppException(HttpStatusCode.BadRequest, "site_unreachable", "We couldn't find that website. Double-check the address and try again.")
        }
        if (addresses.any {
                it.isLoopbackAddress || it.isSiteLocalAddress || it.isLinkLocalAddress || it.isAnyLocalAddress ||
                    it.isMulticastAddress || isUniqueLocal(it) || isCgnat(it)
            }
        ) {
            throw AppException(HttpStatusCode.BadRequest, "invalid_url", "That address points to a private network, which we can't assess.")
        }
    }

    private fun isUniqueLocal(a: InetAddress): Boolean =
        a.address.size == 16 && (a.address[0].toInt() and 0xfe) == 0xfc

    private fun isCgnat(a: InetAddress): Boolean {
        val b = a.address
        if (b.size != 4) return false
        val first = b[0].toInt() and 0xff
        val second = b[1].toInt() and 0xff
        return first == 100 && second in 64..127
    }
}

fun String.toObjectIdOr404(): ObjectId =
    if (ObjectId.isValid(this)) ObjectId(this)
    else throw AppException(HttpStatusCode.NotFound, "not_found", "We couldn't find that.")
