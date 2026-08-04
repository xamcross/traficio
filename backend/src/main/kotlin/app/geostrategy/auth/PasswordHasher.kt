package app.geostrategy.auth

import de.mkammerer.argon2.Argon2Factory

class PasswordHasher {
    private val argon2 = Argon2Factory.create(Argon2Factory.Argon2Types.ARGON2id)

    fun hash(password: String): String =
        argon2.hash(3, 65536, 1, password.toCharArray())

    fun verify(hash: String, password: String): Boolean =
        argon2.verify(hash, password.toCharArray())
}
