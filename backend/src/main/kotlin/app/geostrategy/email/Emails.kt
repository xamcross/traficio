package app.geostrategy.email

fun verifyEmailHtml(appUrl: String, token: String): String = """
    <p>Welcome to GeoStrategy!</p>
    <p>Click the link below to confirm your email address:</p>
    <p><a href="$appUrl/verify-email?token=$token">Confirm my email</a></p>
    <p>The link works for 24 hours. If you didn't create an account, you can ignore this email.</p>
""".trimIndent()

fun resetEmailHtml(appUrl: String, token: String): String = """
    <p>Someone asked to reset the password for this GeoStrategy account.</p>
    <p><a href="$appUrl/reset-password?token=$token">Choose a new password</a></p>
    <p>The link works for 1 hour. If this wasn't you, you can ignore this email.</p>
""".trimIndent()
