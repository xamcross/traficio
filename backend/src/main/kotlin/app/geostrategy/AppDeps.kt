package app.geostrategy

import app.geostrategy.auth.GoogleIdentityClient
import app.geostrategy.auth.OneTimeTokenService
import app.geostrategy.auth.PasswordHasher
import app.geostrategy.auth.SessionService
import app.geostrategy.config.AppConfig
import app.geostrategy.email.EmailSender
import app.geostrategy.users.UserRepository

class AppDeps(
    val config: AppConfig,
    val users: UserRepository,
    val tokens: OneTimeTokenService,
    val sessions: SessionService,
    val passwordHasher: PasswordHasher,
    val emailSender: EmailSender,
    val googleIdentity: GoogleIdentityClient?,
)
