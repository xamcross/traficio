# Backend Foundation & Auth Implementation Plan (Plan 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Kotlin/Ktor API on Fly.io with MongoDB persistence, complete email/password + Google authentication, transactional email, and the error/config/test scaffolding every later plan builds on.

**Architecture:** Single Gradle project in `backend/` — a modular Ktor monolith. Features are plain Kotlin classes wired by hand into an `AppDeps` bundle (no DI framework). MongoDB accessed via the official Kotlin coroutine driver; tests run against a real MongoDB in Testcontainers. Secrets (session + one-time tokens) are stored only as SHA-256 hashes.

**Tech Stack:** Kotlin 2.2.x / JDK 21, Ktor 3.2.x (server + client), `mongodb-driver-kotlin-coroutine` 5.5.x, argon2-jvm, kotlinx.serialization, Testcontainers (MongoDB), JUnit 5, Docker/Fly.io.

**Roadmap context:** This is Plan 1 of 4. Plan 2 = assessment engine (crawler + Claude + SSE + quotas), Plan 3 = Freemius billing + tiers, Plan 4 = Angular frontend. Spec: `docs/superpowers/specs/2026-08-04-geostrategy-design.md`.

## Global Constraints

- JDK **21**, Kotlin **2.2.0**, Ktor **3.2.0**, Mongo Kotlin coroutine driver **5.5.0** (exact versions in Task 1's build file; treat as floors).
- All backend code lives under `backend/`, package root `app.geostrategy`. All Gradle commands below run **from `backend/`**.
- All API routes are under `/v1` except `GET /healthz`.
- Every error response uses exactly the envelope `{"code": "<machine_code>", "message": "<human message>"}`. Human messages are written for non-technical users.
- Passwords: **argon2id** (3 iterations, 64 MB memory, parallelism 1).
- Raw secrets (session tokens, one-time tokens) are **never persisted** — store SHA-256 hex only.
- Timestamps: `java.time.Instant` (UTC) everywhere.
- TDD: every task writes the failing test first, and ends with a passing test run and a commit.
- Prerequisites on the dev machine: JDK 21, Gradle 8.14+ (only to generate the wrapper once), **Docker Desktop running** (Testcontainers), Git. Windows note: commands are written as `./gradlew` (Git Bash); in PowerShell use `.\gradlew.bat`.

## File Structure

```
backend/
  settings.gradle.kts, build.gradle.kts, .gitignore, Dockerfile, fly.toml, README.md
  src/main/kotlin/app/geostrategy/
    Application.kt              # main(): config, Mongo, AppDeps wiring, embeddedServer
    AppDeps.kt                  # dependency bundle handed to appModule (Task 8)
    config/AppConfig.kt         # typed config from env vars
    http/Errors.kt              # AppException, ApiError, StatusPages install
    http/Cors.kt                # CORS install (Task 12)
    persistence/Mongo.kt        # ensureIndexes(db)
    users/User.kt               # User model + UserRepository
    auth/Crypto.kt              # randomToken(), sha256Hex()
    auth/PasswordHasher.kt
    auth/OneTimeTokens.kt       # TokenPurpose, OneTimeToken, OneTimeTokenService
    auth/Sessions.kt            # Session, SessionService, cookie helpers, requireUser
    auth/AuthRoutes.kt          # register/verify/login/logout/me/reset routes
    auth/GoogleAuth.kt          # GoogleIdentityClient + real impl + routes
    email/EmailSender.kt        # interface + LoggingEmailSender
    email/ResendEmailSender.kt
    email/Emails.kt             # verifyEmailHtml(), resetEmailHtml()
  src/test/kotlin/app/geostrategy/
    TestSupport.kt              # TestMongo harness; testDeps() factory (Task 8)
    ... one test file per feature (named in each task)
```

---

### Task 1: Project scaffold, config, health endpoint

**Files:**
- Create: `backend/settings.gradle.kts`, `backend/build.gradle.kts`, `backend/.gitignore`
- Create: `backend/src/main/kotlin/app/geostrategy/config/AppConfig.kt`
- Create: `backend/src/main/kotlin/app/geostrategy/Application.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/AppConfigTest.kt`, `backend/src/test/kotlin/app/geostrategy/HealthzTest.kt`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `AppConfig` (fields below), `AppConfig.fromEnv(env: Map<String, String>): AppConfig`, `fun Application.appModule(config: AppConfig)` (signature changes to `appModule(deps: AppDeps)` in Task 8), `main()`.

- [ ] **Step 1: Create the Gradle project**

`backend/settings.gradle.kts`:
```kotlin
rootProject.name = "geostrategy-backend"
```

`backend/build.gradle.kts`:
```kotlin
plugins {
    kotlin("jvm") version "2.2.0"
    kotlin("plugin.serialization") version "2.2.0"
    application
}

group = "app.geostrategy"
version = "0.1.0"

repositories { mavenCentral() }

val ktorVersion = "3.2.0"

dependencies {
    implementation("io.ktor:ktor-server-netty:$ktorVersion")
    implementation("io.ktor:ktor-server-content-negotiation:$ktorVersion")
    implementation("io.ktor:ktor-serialization-kotlinx-json:$ktorVersion")
    implementation("io.ktor:ktor-server-status-pages:$ktorVersion")
    implementation("io.ktor:ktor-server-call-logging:$ktorVersion")
    implementation("io.ktor:ktor-server-cors:$ktorVersion")
    implementation("io.ktor:ktor-client-cio:$ktorVersion")
    implementation("io.ktor:ktor-client-content-negotiation:$ktorVersion")
    implementation("org.mongodb:mongodb-driver-kotlin-coroutine:5.5.0")
    implementation("de.mkammerer:argon2-jvm:2.12")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    implementation("ch.qos.logback:logback-classic:1.5.18")

    testImplementation(kotlin("test"))
    testImplementation("io.ktor:ktor-server-test-host:$ktorVersion")
    testImplementation("io.ktor:ktor-client-mock:$ktorVersion")
    testImplementation("org.testcontainers:mongodb:1.21.0")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
}

kotlin { jvmToolchain(21) }

application { mainClass.set("app.geostrategy.ApplicationKt") }

tasks.test { useJUnitPlatform() }
```

`backend/.gitignore`:
```
build/
.gradle/
*.log
```

Generate the wrapper (one-time; needs a locally installed Gradle):
```bash
cd backend && gradle wrapper --gradle-version 8.14
```

- [ ] **Step 2: Write the failing tests**

`backend/src/test/kotlin/app/geostrategy/AppConfigTest.kt`:
```kotlin
package app.geostrategy

import app.geostrategy.config.AppConfig
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AppConfigTest {
    @Test
    fun `defaults apply when env is empty`() {
        val c = AppConfig.fromEnv(emptyMap())
        assertEquals(8080, c.port)
        assertEquals("mongodb://localhost:27017", c.mongoUri)
        assertEquals("geostrategy", c.mongoDatabase)
        assertFalse(c.secureCookies)
    }

    @Test
    fun `env values override defaults and https enables secure cookies`() {
        val c = AppConfig.fromEnv(mapOf("PORT" to "9999", "BASE_URL" to "https://api.geostrategy.app"))
        assertEquals(9999, c.port)
        assertTrue(c.secureCookies)
    }
}
```

`backend/src/test/kotlin/app/geostrategy/HealthzTest.kt`:
```kotlin
package app.geostrategy

import app.geostrategy.config.AppConfig
import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals

class HealthzTest {
    @Test
    fun `healthz returns 200`() = testApplication {
        application { appModule(AppConfig.fromEnv(emptyMap())) }
        val res = client.get("/healthz")
        assertEquals(HttpStatusCode.OK, res.status)
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `./gradlew test`
Expected: compilation FAILS — `AppConfig` and `appModule` don't exist yet.

- [ ] **Step 4: Implement config and app module**

`backend/src/main/kotlin/app/geostrategy/config/AppConfig.kt`:
```kotlin
package app.geostrategy.config

data class AppConfig(
    val port: Int,
    val mongoUri: String,
    val mongoDatabase: String,
    val baseUrl: String,          // public API origin, e.g. https://api.geostrategy.app
    val appUrl: String,           // SPA origin, e.g. https://app.geostrategy.app
    val cookieDomain: String?,    // e.g. .geostrategy.app; null in dev
    val secureCookies: Boolean,
    val resendApiKey: String?,
    val emailFrom: String,
    val googleClientId: String?,
    val googleClientSecret: String?,
) {
    companion object {
        fun fromEnv(env: Map<String, String> = System.getenv()): AppConfig {
            val baseUrl = env["BASE_URL"] ?: "http://localhost:8080"
            return AppConfig(
                port = env["PORT"]?.toInt() ?: 8080,
                mongoUri = env["MONGODB_URI"] ?: "mongodb://localhost:27017",
                mongoDatabase = env["MONGODB_DB"] ?: "geostrategy",
                baseUrl = baseUrl,
                appUrl = env["APP_URL"] ?: "http://localhost:4200",
                cookieDomain = env["COOKIE_DOMAIN"],
                secureCookies = baseUrl.startsWith("https://"),
                resendApiKey = env["RESEND_API_KEY"],
                emailFrom = env["EMAIL_FROM"] ?: "GeoStrategy <noreply@geostrategy.app>",
                googleClientId = env["GOOGLE_CLIENT_ID"],
                googleClientSecret = env["GOOGLE_CLIENT_SECRET"],
            )
        }
    }
}
```

`backend/src/main/kotlin/app/geostrategy/Application.kt`:
```kotlin
package app.geostrategy

import app.geostrategy.config.AppConfig
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.calllogging.CallLogging
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.serialization.json.Json

fun main() {
    val config = AppConfig.fromEnv()
    embeddedServer(Netty, port = config.port) { appModule(config) }.start(wait = true)
}

fun Application.appModule(config: AppConfig) {
    install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true; encodeDefaults = true }) }
    install(CallLogging)
    routing {
        get("/healthz") { call.respondText("ok") }
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL, 3 tests passed.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): Ktor scaffold with typed config and health endpoint"
```

---

### Task 2: Error envelope and status pages

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/http/Errors.kt`
- Modify: `backend/src/main/kotlin/app/geostrategy/Application.kt` (call `installErrorHandling()` inside `appModule`)
- Test: `backend/src/test/kotlin/app/geostrategy/http/ErrorsTest.kt`

**Interfaces:**
- Consumes: `appModule` from Task 1.
- Produces: `class AppException(val status: HttpStatusCode, val code: String, override val message: String) : RuntimeException`, `@Serializable data class ApiError(val code: String, val message: String)`, `fun Application.installErrorHandling()`. **Every later task throws `AppException` for expected failures.**

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/http/ErrorsTest.kt`:
```kotlin
package app.geostrategy.http

import app.geostrategy.appModule
import app.geostrategy.config.AppConfig
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ErrorsTest {
    private fun Application.withThrowingRoutes(config: AppConfig) {
        appModule(config)
        routing {
            get("/boom-known") { throw AppException(HttpStatusCode.Conflict, "email_taken", "That email is already registered.") }
            get("/boom-unknown") { error("db exploded: secret detail") }
        }
    }

    @Test
    fun `AppException maps to its status and envelope`() = testApplication {
        application { withThrowingRoutes(AppConfig.fromEnv(emptyMap())) }
        val res = client.get("/boom-known")
        assertEquals(HttpStatusCode.Conflict, res.status)
        assertEquals("""{"code":"email_taken","message":"That email is already registered."}""", res.bodyAsText())
    }

    @Test
    fun `unexpected exceptions map to 500 without leaking details`() = testApplication {
        application { withThrowingRoutes(AppConfig.fromEnv(emptyMap())) }
        val res = client.get("/boom-unknown")
        assertEquals(HttpStatusCode.InternalServerError, res.status)
        assertTrue(res.bodyAsText().contains("internal_error"))
        assertTrue(!res.bodyAsText().contains("secret detail"))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.http.ErrorsTest"`
Expected: compilation FAILS — `AppException` not defined.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/app/geostrategy/http/Errors.kt`:
```kotlin
package app.geostrategy.http

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.application.log
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respond
import kotlinx.serialization.Serializable

@Serializable
data class ApiError(val code: String, val message: String)

class AppException(
    val status: HttpStatusCode,
    val code: String,
    override val message: String,
) : RuntimeException(message)

fun Application.installErrorHandling() {
    install(StatusPages) {
        exception<AppException> { call, e ->
            call.respond(e.status, ApiError(e.code, e.message))
        }
        exception<Throwable> { call, e ->
            call.application.log.error("Unhandled exception", e)
            call.respond(
                HttpStatusCode.InternalServerError,
                ApiError("internal_error", "Something went wrong on our side. Please try again."),
            )
        }
    }
}
```

In `Application.kt`, add `installErrorHandling()` right after `install(CallLogging)` inside `appModule` (import `app.geostrategy.http.installErrorHandling`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): AppException error envelope via StatusPages"
```

---

### Task 3: MongoDB bootstrap, test harness, UserRepository

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/users/User.kt`
- Create: `backend/src/main/kotlin/app/geostrategy/persistence/Mongo.kt`
- Create: `backend/src/test/kotlin/app/geostrategy/TestSupport.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/users/UserRepositoryTest.kt`

**Interfaces:**
- Consumes: `AppException` (Task 2).
- Produces:
  - `data class User(@BsonId val id: ObjectId = ObjectId(), val email: String, val passwordHash: String? = null, val googleId: String? = null, val emailVerified: Boolean = false, val tier: String = "free", val createdAt: Instant, val updatedAt: Instant)`
  - `class UserRepository(db: MongoDatabase)` with `suspend fun insert(user: User): User` (throws `AppException(409, "email_taken", …)` on duplicate), `suspend fun findByEmail(email: String): User?`, `suspend fun findById(id: ObjectId): User?`, `suspend fun setEmailVerified(id: ObjectId)`, `suspend fun setPasswordHash(id: ObjectId, hash: String)`, `suspend fun linkGoogle(id: ObjectId, googleId: String)`
  - `suspend fun ensureIndexes(db: MongoDatabase)`
  - Test harness: `object TestMongo { fun freshDb(): MongoDatabase }` — a shared Testcontainers MongoDB, one fresh database per test.

- [ ] **Step 1: Create the test harness**

`backend/src/test/kotlin/app/geostrategy/TestSupport.kt`:
```kotlin
package app.geostrategy

import app.geostrategy.persistence.ensureIndexes
import com.mongodb.kotlin.client.coroutine.MongoClient
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import kotlinx.coroutines.runBlocking
import org.testcontainers.containers.MongoDBContainer
import java.util.UUID

object TestMongo {
    private val container: MongoDBContainer by lazy {
        MongoDBContainer("mongo:7.0").also { it.start() }
    }
    private val client: MongoClient by lazy { MongoClient.create(container.connectionString) }

    fun freshDb(): MongoDatabase {
        val db = client.getDatabase("t" + UUID.randomUUID().toString().replace("-", ""))
        runBlocking { ensureIndexes(db) }
        return db
    }
}
```

- [ ] **Step 2: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/users/UserRepositoryTest.kt`:
```kotlin
package app.geostrategy.users

import app.geostrategy.TestMongo
import app.geostrategy.http.AppException
import kotlinx.coroutines.runBlocking
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class UserRepositoryTest {
    private fun newUser(email: String) =
        User(email = email, passwordHash = "x", createdAt = Instant.now(), updatedAt = Instant.now())

    @Test
    fun `insert then find by email and id`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val saved = repo.insert(newUser("ada@example.com"))
        assertEquals("ada@example.com", repo.findByEmail("ada@example.com")?.email)
        assertNotNull(repo.findById(saved.id))
        assertNull(repo.findByEmail("nobody@example.com"))
    }

    @Test
    fun `duplicate email raises email_taken`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        repo.insert(newUser("dup@example.com"))
        val e = assertFailsWith<AppException> { repo.insert(newUser("dup@example.com")) }
        assertEquals("email_taken", e.code)
    }

    @Test
    fun `updates flip flags and fields`() = runBlocking {
        val repo = UserRepository(TestMongo.freshDb())
        val u = repo.insert(newUser("flip@example.com"))
        repo.setEmailVerified(u.id)
        repo.setPasswordHash(u.id, "newhash")
        repo.linkGoogle(u.id, "google-sub-1")
        val loaded = repo.findById(u.id)!!
        assertTrue(loaded.emailVerified)
        assertEquals("newhash", loaded.passwordHash)
        assertEquals("google-sub-1", loaded.googleId)
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.users.UserRepositoryTest"`
Expected: compilation FAILS — `User`, `UserRepository`, `ensureIndexes` not defined.

- [ ] **Step 4: Implement model, repository, indexes**

`backend/src/main/kotlin/app/geostrategy/users/User.kt`:
```kotlin
package app.geostrategy.users

import app.geostrategy.http.AppException
import com.mongodb.MongoWriteException
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Updates.combine
import com.mongodb.client.model.Updates.set
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.firstOrNull
import org.bson.codecs.pojo.annotations.BsonId
import org.bson.types.ObjectId
import java.time.Instant

data class User(
    @BsonId val id: ObjectId = ObjectId(),
    val email: String,
    val passwordHash: String? = null,
    val googleId: String? = null,
    val emailVerified: Boolean = false,
    val tier: String = "free",
    val createdAt: Instant,
    val updatedAt: Instant,
)

class UserRepository(db: MongoDatabase) {
    private val col = db.getCollection<User>("users")

    suspend fun insert(user: User): User {
        try {
            col.insertOne(user)
        } catch (e: MongoWriteException) {
            if (e.error.code == 11000) {
                throw AppException(HttpStatusCode.Conflict, "email_taken", "An account with this email already exists.")
            }
            throw e
        }
        return user
    }

    suspend fun findByEmail(email: String): User? = col.find(eq("email", email)).firstOrNull()

    suspend fun findById(id: ObjectId): User? = col.find(eq("_id", id)).firstOrNull()

    suspend fun setEmailVerified(id: ObjectId) {
        col.updateOne(eq("_id", id), combine(set("emailVerified", true), set("updatedAt", Instant.now())))
    }

    suspend fun setPasswordHash(id: ObjectId, hash: String) {
        col.updateOne(eq("_id", id), combine(set("passwordHash", hash), set("updatedAt", Instant.now())))
    }

    suspend fun linkGoogle(id: ObjectId, googleId: String) {
        col.updateOne(eq("_id", id), combine(set("googleId", googleId), set("updatedAt", Instant.now())))
    }
}
```

`backend/src/main/kotlin/app/geostrategy/persistence/Mongo.kt`:
```kotlin
package app.geostrategy.persistence

import com.mongodb.client.model.IndexOptions
import com.mongodb.client.model.Indexes
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import org.bson.Document
import java.util.concurrent.TimeUnit

suspend fun ensureIndexes(db: MongoDatabase) {
    db.getCollection<Document>("users")
        .createIndex(Indexes.ascending("email"), IndexOptions().unique(true))
    db.getCollection<Document>("tokens")
        .createIndex(Indexes.ascending("tokenHash"), IndexOptions().unique(true))
    db.getCollection<Document>("tokens")
        .createIndex(Indexes.ascending("expiresAt"), IndexOptions().expireAfter(0, TimeUnit.SECONDS))
    db.getCollection<Document>("sessions")
        .createIndex(Indexes.ascending("tokenHash"), IndexOptions().unique(true))
    db.getCollection<Document>("sessions")
        .createIndex(Indexes.ascending("expiresAt"), IndexOptions().expireAfter(0, TimeUnit.SECONDS))
    db.getCollection<Document>("sessions")
        .createIndex(Indexes.ascending("userId"))
}
```

- [ ] **Step 5: Run tests to verify they pass** (Docker must be running)

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL. First run pulls the `mongo:7.0` image (slow once).

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): Mongo bootstrap, Testcontainers harness, UserRepository"
```

---

### Task 4: Security primitives — password hashing and token crypto

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/auth/PasswordHasher.kt`
- Create: `backend/src/main/kotlin/app/geostrategy/auth/Crypto.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/auth/CryptoTest.kt`

**Interfaces:**
- Consumes: nothing.
- Produces: `class PasswordHasher` with `fun hash(password: String): String`, `fun verify(hash: String, password: String): Boolean`; top-level `fun randomToken(): String` (32 random bytes, base64url, no padding), `fun sha256Hex(value: String): String`.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/auth/CryptoTest.kt`:
```kotlin
package app.geostrategy.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class CryptoTest {
    @Test
    fun `password hash verifies and rejects`() {
        val hasher = PasswordHasher()
        val hash = hasher.hash("correct-horse")
        assertTrue(hash.startsWith("\$argon2id\$"))
        assertTrue(hasher.verify(hash, "correct-horse"))
        assertFalse(hasher.verify(hash, "wrong-horse"))
    }

    @Test
    fun `random tokens are unique and url-safe`() {
        val a = randomToken()
        val b = randomToken()
        assertNotEquals(a, b)
        assertTrue(a.matches(Regex("^[A-Za-z0-9_-]{43}$")))
    }

    @Test
    fun `sha256Hex is deterministic`() {
        assertEquals(sha256Hex("abc"), sha256Hex("abc"))
        assertEquals(64, sha256Hex("abc").length)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.auth.CryptoTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/app/geostrategy/auth/PasswordHasher.kt`:
```kotlin
package app.geostrategy.auth

import de.mkammerer.argon2.Argon2Factory

class PasswordHasher {
    private val argon2 = Argon2Factory.create(Argon2Factory.Argon2Types.ARGON2id)

    fun hash(password: String): String =
        argon2.hash(3, 65536, 1, password.toCharArray())

    fun verify(hash: String, password: String): Boolean =
        argon2.verify(hash, password.toCharArray())
}
```

`backend/src/main/kotlin/app/geostrategy/auth/Crypto.kt`:
```kotlin
package app.geostrategy.auth

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

private val secureRandom = SecureRandom()

fun randomToken(): String {
    val bytes = ByteArray(32)
    secureRandom.nextBytes(bytes)
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}

fun sha256Hex(value: String): String =
    MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): argon2id password hashing and token crypto helpers"
```

---

### Task 5: One-time tokens (email verification / password reset)

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/auth/OneTimeTokens.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/auth/OneTimeTokensTest.kt`

**Interfaces:**
- Consumes: `randomToken()`, `sha256Hex()` (Task 4); `TestMongo` (Task 3).
- Produces: `enum class TokenPurpose { VERIFY_EMAIL, PASSWORD_RESET }`; `class OneTimeTokenService(db: MongoDatabase)` with `suspend fun issue(userId: ObjectId, purpose: TokenPurpose, ttl: Duration): String` (returns the raw token) and `suspend fun consume(raw: String, purpose: TokenPurpose): ObjectId?` (returns the userId once, deletes the token; null if unknown/expired/wrong purpose).

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/auth/OneTimeTokensTest.kt`:
```kotlin
package app.geostrategy.auth

import app.geostrategy.TestMongo
import kotlinx.coroutines.runBlocking
import org.bson.types.ObjectId
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class OneTimeTokensTest {
    @Test
    fun `issue then consume returns userId exactly once`() = runBlocking {
        val svc = OneTimeTokenService(TestMongo.freshDb())
        val userId = ObjectId()
        val raw = svc.issue(userId, TokenPurpose.VERIFY_EMAIL, Duration.ofHours(1))
        assertEquals(userId, svc.consume(raw, TokenPurpose.VERIFY_EMAIL))
        assertNull(svc.consume(raw, TokenPurpose.VERIFY_EMAIL)) // single use
    }

    @Test
    fun `wrong purpose and expired tokens are rejected`() = runBlocking {
        val svc = OneTimeTokenService(TestMongo.freshDb())
        val userId = ObjectId()
        val wrongPurpose = svc.issue(userId, TokenPurpose.VERIFY_EMAIL, Duration.ofHours(1))
        assertNull(svc.consume(wrongPurpose, TokenPurpose.PASSWORD_RESET))
        val expired = svc.issue(userId, TokenPurpose.PASSWORD_RESET, Duration.ofSeconds(-5))
        assertNull(svc.consume(expired, TokenPurpose.PASSWORD_RESET))
    }

    @Test
    fun `unknown token returns null`() = runBlocking {
        val svc = OneTimeTokenService(TestMongo.freshDb())
        assertNull(svc.consume("not-a-real-token", TokenPurpose.VERIFY_EMAIL))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.auth.OneTimeTokensTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/app/geostrategy/auth/OneTimeTokens.kt`:
```kotlin
package app.geostrategy.auth

import com.mongodb.client.model.Filters.and
import com.mongodb.client.model.Filters.eq
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import org.bson.codecs.pojo.annotations.BsonId
import org.bson.types.ObjectId
import java.time.Duration
import java.time.Instant

enum class TokenPurpose { VERIFY_EMAIL, PASSWORD_RESET }

data class OneTimeToken(
    @BsonId val id: ObjectId = ObjectId(),
    val tokenHash: String,
    val userId: ObjectId,
    val purpose: String,
    val expiresAt: Instant,
)

class OneTimeTokenService(db: MongoDatabase) {
    private val col = db.getCollection<OneTimeToken>("tokens")

    suspend fun issue(userId: ObjectId, purpose: TokenPurpose, ttl: Duration): String {
        val raw = randomToken()
        col.insertOne(
            OneTimeToken(
                tokenHash = sha256Hex(raw),
                userId = userId,
                purpose = purpose.name,
                expiresAt = Instant.now().plus(ttl),
            ),
        )
        return raw
    }

    suspend fun consume(raw: String, purpose: TokenPurpose): ObjectId? {
        val doc = col.findOneAndDelete(
            and(eq("tokenHash", sha256Hex(raw)), eq("purpose", purpose.name)),
        ) ?: return null
        return if (doc.expiresAt.isAfter(Instant.now())) doc.userId else null
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): single-use hashed one-time tokens with TTL"
```

---

### Task 6: Sessions, cookies, requireUser

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/auth/Sessions.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/auth/SessionsTest.kt`

**Interfaces:**
- Consumes: `randomToken()`, `sha256Hex()` (Task 4); `User`, `UserRepository` (Task 3); `AppException` (Task 2); `AppConfig` (Task 1).
- Produces:
  - `class SessionService(db: MongoDatabase)` with `suspend fun create(userId: ObjectId): String` (raw token, 30-day expiry), `suspend fun userIdFor(raw: String): ObjectId?`, `suspend fun revoke(raw: String)`, `suspend fun revokeAllFor(userId: ObjectId)`
  - `const val SESSION_COOKIE = "gs_session"`
  - `fun ApplicationCall.setSessionCookie(raw: String, config: AppConfig)`, `fun ApplicationCall.clearSessionCookie(config: AppConfig)`
  - `suspend fun ApplicationCall.requireUser(deps: AppDeps): User` — **defined in Task 8** once `AppDeps` exists; this task produces the service + cookie helpers only.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/auth/SessionsTest.kt`:
```kotlin
package app.geostrategy.auth

import app.geostrategy.TestMongo
import kotlinx.coroutines.runBlocking
import org.bson.types.ObjectId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SessionsTest {
    @Test
    fun `create then resolve then revoke`() = runBlocking {
        val svc = SessionService(TestMongo.freshDb())
        val userId = ObjectId()
        val raw = svc.create(userId)
        assertEquals(userId, svc.userIdFor(raw))
        svc.revoke(raw)
        assertNull(svc.userIdFor(raw))
    }

    @Test
    fun `revokeAllFor kills every session of that user only`() = runBlocking {
        val svc = SessionService(TestMongo.freshDb())
        val alice = ObjectId(); val bob = ObjectId()
        val a1 = svc.create(alice); val a2 = svc.create(alice); val b1 = svc.create(bob)
        svc.revokeAllFor(alice)
        assertNull(svc.userIdFor(a1))
        assertNull(svc.userIdFor(a2))
        assertEquals(bob, svc.userIdFor(b1))
    }

    @Test
    fun `unknown token resolves to null`() = runBlocking {
        val svc = SessionService(TestMongo.freshDb())
        assertNull(svc.userIdFor("bogus"))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.auth.SessionsTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/app/geostrategy/auth/Sessions.kt`:
```kotlin
package app.geostrategy.auth

import app.geostrategy.config.AppConfig
import com.mongodb.client.model.Filters.and
import com.mongodb.client.model.Filters.eq
import com.mongodb.client.model.Filters.gt
import com.mongodb.kotlin.client.coroutine.MongoDatabase
import io.ktor.http.Cookie
import io.ktor.server.application.ApplicationCall
import kotlinx.coroutines.flow.firstOrNull
import org.bson.codecs.pojo.annotations.BsonId
import org.bson.types.ObjectId
import java.time.Duration
import java.time.Instant

const val SESSION_COOKIE = "gs_session"
private val SESSION_TTL: Duration = Duration.ofDays(30)

data class Session(
    @BsonId val id: ObjectId = ObjectId(),
    val tokenHash: String,
    val userId: ObjectId,
    val expiresAt: Instant,
    val createdAt: Instant,
)

class SessionService(db: MongoDatabase) {
    private val col = db.getCollection<Session>("sessions")

    suspend fun create(userId: ObjectId): String {
        val raw = randomToken()
        val now = Instant.now()
        col.insertOne(Session(tokenHash = sha256Hex(raw), userId = userId, expiresAt = now.plus(SESSION_TTL), createdAt = now))
        return raw
    }

    suspend fun userIdFor(raw: String): ObjectId? =
        col.find(and(eq("tokenHash", sha256Hex(raw)), gt("expiresAt", Instant.now())))
            .firstOrNull()?.userId

    suspend fun revoke(raw: String) {
        col.deleteOne(eq("tokenHash", sha256Hex(raw)))
    }

    suspend fun revokeAllFor(userId: ObjectId) {
        col.deleteMany(eq("userId", userId))
    }
}

fun ApplicationCall.setSessionCookie(raw: String, config: AppConfig) {
    response.cookies.append(
        Cookie(
            name = SESSION_COOKIE, value = raw, path = "/",
            httpOnly = true, secure = config.secureCookies, domain = config.cookieDomain,
            maxAge = SESSION_TTL.seconds.toInt(),
            extensions = mapOf("SameSite" to "Lax"),
        ),
    )
}

fun ApplicationCall.clearSessionCookie(config: AppConfig) {
    response.cookies.append(
        Cookie(
            name = SESSION_COOKIE, value = "", path = "/",
            httpOnly = true, secure = config.secureCookies, domain = config.cookieDomain,
            maxAge = 0,
            extensions = mapOf("SameSite" to "Lax"),
        ),
    )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): hashed session store with cookie helpers"
```

---

### Task 7: Email sending — interface, dev logger, Resend implementation

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/email/EmailSender.kt`
- Create: `backend/src/main/kotlin/app/geostrategy/email/ResendEmailSender.kt`
- Create: `backend/src/main/kotlin/app/geostrategy/email/Emails.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/email/ResendEmailSenderTest.kt`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `interface EmailSender { suspend fun send(to: String, subject: String, html: String) }`
  - `class LoggingEmailSender : EmailSender` (dev fallback — logs instead of sending)
  - `class ResendEmailSender(apiKey: String, from: String, http: HttpClient) : EmailSender`
  - `fun verifyEmailHtml(appUrl: String, token: String): String`, `fun resetEmailHtml(appUrl: String, token: String): String` — both embed the raw token as `token=<raw>` in a link.
  - Tests in later tasks use `class RecordingEmailSender : EmailSender` (defined here, in **test** sources).

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/email/ResendEmailSenderTest.kt`:
```kotlin
package app.geostrategy.email

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ResendEmailSenderTest {
    private fun clientWith(engine: MockEngine) = HttpClient(engine) {
        install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
    }

    @Test
    fun `posts the expected payload with bearer auth`() = runBlocking {
        var authHeader: String? = null
        var body: String? = null
        val engine = MockEngine { request ->
            authHeader = request.headers[HttpHeaders.Authorization]
            body = String(request.body.toByteArray())
            respond("""{"id":"email_1"}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }
        ResendEmailSender("re_test_key", "GeoStrategy <noreply@geostrategy.app>", clientWith(engine))
            .send("ada@example.com", "Hello", "<p>Hi</p>")

        assertEquals("Bearer re_test_key", authHeader)
        val parsed = Json.parseToJsonElement(body!!).jsonObject
        assertEquals("ada@example.com", parsed["to"]!!.jsonArray[0].jsonPrimitive.content)
        assertEquals("Hello", parsed["subject"]!!.jsonPrimitive.content)
    }

    @Test
    fun `non-2xx response throws`() {
        val engine = MockEngine { respond("nope", HttpStatusCode.Unauthorized) }
        assertFailsWith<IllegalStateException> {
            runBlocking {
                ResendEmailSender("bad", "x <x@x.dev>", clientWith(engine)).send("a@b.c", "s", "h")
            }
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.email.ResendEmailSenderTest"`
Expected: compilation FAILS.

- [ ] **Step 3: Implement**

`backend/src/main/kotlin/app/geostrategy/email/EmailSender.kt`:
```kotlin
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
```

`backend/src/main/kotlin/app/geostrategy/email/ResendEmailSender.kt`:
```kotlin
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
```

`backend/src/main/kotlin/app/geostrategy/email/Emails.kt`:
```kotlin
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
```

Append to `backend/src/test/kotlin/app/geostrategy/TestSupport.kt`:
```kotlin
class RecordingEmailSender : app.geostrategy.email.EmailSender {
    data class Sent(val to: String, val subject: String, val html: String)
    val sent = mutableListOf<Sent>()
    override suspend fun send(to: String, subject: String, html: String) {
        sent.add(Sent(to, subject, html))
    }
}

fun extractToken(html: String): String =
    Regex("token=([A-Za-z0-9_-]+)").find(html)?.groupValues?.get(1)
        ?: error("no token found in email html")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): EmailSender with Resend implementation and email templates"
```

---

### Task 8: AppDeps wiring + registration endpoint

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/AppDeps.kt`
- Create: `backend/src/main/kotlin/app/geostrategy/auth/AuthRoutes.kt`
- Modify: `backend/src/main/kotlin/app/geostrategy/Application.kt` — `appModule` now takes `AppDeps`; `main()` builds real dependencies
- Modify: `backend/src/main/kotlin/app/geostrategy/auth/Sessions.kt` — add `requireUser`
- Modify: `backend/src/test/kotlin/app/geostrategy/TestSupport.kt` — add `testDeps()`
- Modify: `backend/src/test/kotlin/app/geostrategy/HealthzTest.kt` — use `testDeps()`
- Modify: `backend/src/test/kotlin/app/geostrategy/http/ErrorsTest.kt` — use `testDeps()`
- Test: `backend/src/test/kotlin/app/geostrategy/auth/RegisterRouteTest.kt`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces:
  - `class AppDeps(val config: AppConfig, val users: UserRepository, val tokens: OneTimeTokenService, val sessions: SessionService, val passwordHasher: PasswordHasher, val emailSender: EmailSender, val googleIdentity: GoogleIdentityClient?)` — `GoogleIdentityClient` is declared in this task as a placeholder interface and implemented in Task 11.
  - `fun Application.appModule(deps: AppDeps)` (replaces the Task 1 signature)
  - `fun Route.authRoutes(deps: AppDeps)`
  - `suspend fun ApplicationCall.requireUser(deps: AppDeps): User` (throws `AppException(401, "unauthenticated", …)`)
  - Test factory: `fun testDeps(db: MongoDatabase, email: EmailSender = RecordingEmailSender(), google: GoogleIdentityClient? = null): AppDeps`
  - Endpoint: `POST /v1/auth/register` body `{"email","password"}` → 201 `{"ok":true}`; 400 `invalid_email`/`weak_password`; 409 `email_taken`. Sends a verification email containing `token=<raw>`.
  - Shared DTOs in `AuthRoutes.kt`: `@Serializable data class OkResponse(val ok: Boolean = true)`, `@Serializable data class UserDto(val id: String, val email: String, val emailVerified: Boolean, val tier: String)`, `fun User.toDto(): UserDto`.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/auth/RegisterRouteTest.kt`:
```kotlin
package app.geostrategy.auth

import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.testDeps
import app.geostrategy.users.UserRepository
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class RegisterRouteTest {
    @Test
    fun `register lowercases email, stores hash, emails verification token`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        application { appModule(testDeps(db, email = emails)) }

        val res = client.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"Ada@Example.com","password":"correct-horse"}""")
        }
        assertEquals(HttpStatusCode.Created, res.status)

        val user = runBlocking { UserRepository(db).findByEmail("ada@example.com") }
        assertNotNull(user)
        assertFalse(user.emailVerified)
        assertTrue(user.passwordHash!!.startsWith("\$argon2id\$"))
        assertEquals(1, emails.sent.size)
        assertTrue(emails.sent[0].html.contains("token="))
    }

    @Test
    fun `weak password and bad email are rejected`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }
        val weak = client.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"a@b.co","password":"short"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, weak.status)
        assertTrue(weak.bodyAsText().contains("weak_password"))

        val bad = client.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"not-an-email","password":"long-enough-pw"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, bad.status)
        assertTrue(bad.bodyAsText().contains("invalid_email"))
    }

    @Test
    fun `duplicate email returns 409`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db)) }
        suspend fun register() = client.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"dup@example.com","password":"correct-horse"}""")
        }
        assertEquals(HttpStatusCode.Created, register().status)
        assertEquals(HttpStatusCode.Conflict, register().status)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.auth.RegisterRouteTest"`
Expected: compilation FAILS — `testDeps`, `AppDeps`, `authRoutes` missing.

- [ ] **Step 3: Implement AppDeps, requireUser, route, wiring**

`backend/src/main/kotlin/app/geostrategy/AppDeps.kt`:
```kotlin
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
```

Add the placeholder interface at the top of a new file `backend/src/main/kotlin/app/geostrategy/auth/GoogleAuth.kt` (routes come in Task 11):
```kotlin
package app.geostrategy.auth

data class GoogleIdentity(val subject: String, val email: String, val emailVerified: Boolean)

interface GoogleIdentityClient {
    suspend fun exchange(code: String, redirectUri: String): GoogleIdentity
}
```

Add to `backend/src/main/kotlin/app/geostrategy/auth/Sessions.kt`:
```kotlin
suspend fun io.ktor.server.application.ApplicationCall.requireUser(deps: app.geostrategy.AppDeps): app.geostrategy.users.User {
    val unauthenticated = app.geostrategy.http.AppException(
        io.ktor.http.HttpStatusCode.Unauthorized, "unauthenticated", "Please log in.",
    )
    val raw = request.cookies[SESSION_COOKIE] ?: throw unauthenticated
    val userId = deps.sessions.userIdFor(raw) ?: throw unauthenticated
    return deps.users.findById(userId) ?: throw unauthenticated
}
```
(Convert the fully-qualified names to imports when writing the file.)

`backend/src/main/kotlin/app/geostrategy/auth/AuthRoutes.kt`:
```kotlin
package app.geostrategy.auth

import app.geostrategy.AppDeps
import app.geostrategy.email.verifyEmailHtml
import app.geostrategy.http.AppException
import app.geostrategy.users.User
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import kotlinx.serialization.Serializable
import java.time.Duration
import java.time.Instant

private val EMAIL_REGEX = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")

@Serializable data class OkResponse(val ok: Boolean = true)
@Serializable data class UserDto(val id: String, val email: String, val emailVerified: Boolean, val tier: String)
@Serializable data class RegisterRequest(val email: String, val password: String)

fun User.toDto() = UserDto(id = id.toHexString(), email = email, emailVerified = emailVerified, tier = tier)

fun Route.authRoutes(deps: AppDeps) {
    post("/v1/auth/register") {
        val body = call.receive<RegisterRequest>()
        val email = body.email.trim().lowercase()
        if (!EMAIL_REGEX.matches(email)) {
            throw AppException(HttpStatusCode.BadRequest, "invalid_email", "That doesn't look like an email address.")
        }
        if (body.password.length < 8) {
            throw AppException(HttpStatusCode.BadRequest, "weak_password", "Your password must be at least 8 characters.")
        }
        val now = Instant.now()
        val user = deps.users.insert(
            User(email = email, passwordHash = deps.passwordHasher.hash(body.password), createdAt = now, updatedAt = now),
        )
        val token = deps.tokens.issue(user.id, TokenPurpose.VERIFY_EMAIL, Duration.ofHours(24))
        deps.emailSender.send(email, "Confirm your GeoStrategy email", verifyEmailHtml(deps.config.appUrl, token))
        call.respond(HttpStatusCode.Created, OkResponse())
    }
}
```

Rewrite `backend/src/main/kotlin/app/geostrategy/Application.kt`:
```kotlin
package app.geostrategy

import app.geostrategy.auth.OneTimeTokenService
import app.geostrategy.auth.PasswordHasher
import app.geostrategy.auth.SessionService
import app.geostrategy.auth.authRoutes
import app.geostrategy.config.AppConfig
import app.geostrategy.email.LoggingEmailSender
import app.geostrategy.email.ResendEmailSender
import app.geostrategy.http.installErrorHandling
import app.geostrategy.persistence.ensureIndexes
import app.geostrategy.users.UserRepository
import com.mongodb.kotlin.client.coroutine.MongoClient
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.calllogging.CallLogging
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation as ClientContentNegotiation

fun main() {
    val config = AppConfig.fromEnv()
    val mongo = MongoClient.create(config.mongoUri)
    val db = mongo.getDatabase(config.mongoDatabase)
    runBlocking { ensureIndexes(db) }

    val httpClient = HttpClient(CIO) {
        install(ClientContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
    }
    val deps = AppDeps(
        config = config,
        users = UserRepository(db),
        tokens = OneTimeTokenService(db),
        sessions = SessionService(db),
        passwordHasher = PasswordHasher(),
        emailSender = config.resendApiKey?.let { ResendEmailSender(it, config.emailFrom, httpClient) } ?: LoggingEmailSender(),
        googleIdentity = null, // wired in Task 11
    )
    embeddedServer(Netty, port = config.port) { appModule(deps) }.start(wait = true)
}

fun Application.appModule(deps: AppDeps) {
    install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true; encodeDefaults = true }) }
    install(CallLogging)
    installErrorHandling()
    routing {
        get("/healthz") { call.respondText("ok") }
        authRoutes(deps)
    }
}
```

Add to `backend/src/test/kotlin/app/geostrategy/TestSupport.kt`:
```kotlin
fun testDeps(
    db: com.mongodb.kotlin.client.coroutine.MongoDatabase,
    email: app.geostrategy.email.EmailSender = RecordingEmailSender(),
    google: app.geostrategy.auth.GoogleIdentityClient? = null,
): AppDeps = AppDeps(
    config = app.geostrategy.config.AppConfig.fromEnv(emptyMap()),
    users = app.geostrategy.users.UserRepository(db),
    tokens = app.geostrategy.auth.OneTimeTokenService(db),
    sessions = app.geostrategy.auth.SessionService(db),
    passwordHasher = app.geostrategy.auth.PasswordHasher(),
    emailSender = email,
    googleIdentity = google,
)
```
(Use imports, not fully-qualified names.) Update `HealthzTest` and `ErrorsTest` to call `appModule(testDeps(TestMongo.freshDb()))` — they now need the Mongo container too.

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL — new register tests pass, old tests still pass with the new signature.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): AppDeps wiring and registration endpoint with verification email"
```

---

### Task 9: Verify-email, login, me, logout

**Files:**
- Modify: `backend/src/main/kotlin/app/geostrategy/auth/AuthRoutes.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/auth/LoginFlowTest.kt`

**Interfaces:**
- Consumes: Tasks 5, 6, 8 (`OneTimeTokenService.consume`, `SessionService`, cookie helpers, `requireUser`, `extractToken`).
- Produces endpoints:
  - `POST /v1/auth/verify-email` body `{"token"}` → 200 `{"ok":true}`; 400 `invalid_token` if unknown/expired.
  - `POST /v1/auth/login` body `{"email","password"}` → 200 `UserDto` + sets `gs_session` cookie; 401 `invalid_credentials` on any failure (same message whether email or password is wrong).
  - `GET /v1/me` → 200 `UserDto`; 401 `unauthenticated` without a valid session.
  - `POST /v1/auth/logout` → 204, revokes the session and clears the cookie.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/auth/LoginFlowTest.kt`:
```kotlin
package app.geostrategy.auth

import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.extractToken
import app.geostrategy.testDeps
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class LoginFlowTest {
    @Test
    fun `full journey - register, verify, login, me, logout`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        application { appModule(testDeps(db, email = emails)) }
        val http = createClient { install(HttpCookies) }

        // register
        http.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"correct-horse"}""")
        }

        // verify email using the token from the sent email
        val token = extractToken(emails.sent[0].html)
        val verify = http.post("/v1/auth/verify-email") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"$token"}""")
        }
        assertEquals(HttpStatusCode.OK, verify.status)

        // login sets the session cookie
        val login = http.post("/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"correct-horse"}""")
        }
        assertEquals(HttpStatusCode.OK, login.status)

        // me works with the cookie and shows the verified flag
        val me = http.get("/v1/me")
        assertEquals(HttpStatusCode.OK, me.status)
        assertTrue(me.bodyAsText().contains("\"emailVerified\":true"))

        // logout kills the session
        assertEquals(HttpStatusCode.NoContent, http.post("/v1/auth/logout").status)
        assertEquals(HttpStatusCode.Unauthorized, http.get("/v1/me").status)
    }

    @Test
    fun `login with wrong password or unknown email is a uniform 401`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db)) }
        val http = createClient { install(HttpCookies) }
        http.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"correct-horse"}""")
        }
        val wrongPw = http.post("/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"wrong-horse"}""")
        }
        val unknown = http.post("/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ghost@example.com","password":"whatever-pw"}""")
        }
        assertEquals(HttpStatusCode.Unauthorized, wrongPw.status)
        assertEquals(HttpStatusCode.Unauthorized, unknown.status)
        assertEquals(wrongPw.bodyAsText(), unknown.bodyAsText())
    }

    @Test
    fun `verify-email with bogus token returns 400 invalid_token`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }
        val res = client.post("/v1/auth/verify-email") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"bogus"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertTrue(res.bodyAsText().contains("invalid_token"))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.auth.LoginFlowTest"`
Expected: FAIL — 404s for the new routes.

- [ ] **Step 3: Implement the routes**

Add inside `authRoutes(deps)` in `AuthRoutes.kt` (new DTOs at file level):
```kotlin
@Serializable data class VerifyEmailRequest(val token: String)
@Serializable data class LoginRequest(val email: String, val password: String)
```
```kotlin
    post("/v1/auth/verify-email") {
        val body = call.receive<VerifyEmailRequest>()
        val userId = deps.tokens.consume(body.token, TokenPurpose.VERIFY_EMAIL)
            ?: throw AppException(HttpStatusCode.BadRequest, "invalid_token", "This link is invalid or has expired. Please request a new one.")
        deps.users.setEmailVerified(userId)
        call.respond(OkResponse())
    }

    post("/v1/auth/login") {
        val body = call.receive<LoginRequest>()
        val invalid = AppException(HttpStatusCode.Unauthorized, "invalid_credentials", "Email or password is incorrect.")
        val user = deps.users.findByEmail(body.email.trim().lowercase()) ?: throw invalid
        val hash = user.passwordHash ?: throw invalid
        if (!deps.passwordHasher.verify(hash, body.password)) throw invalid
        val raw = deps.sessions.create(user.id)
        call.setSessionCookie(raw, deps.config)
        call.respond(user.toDto())
    }

    get("/v1/me") {
        call.respond(call.requireUser(deps).toDto())
    }

    post("/v1/auth/logout") {
        call.request.cookies[SESSION_COOKIE]?.let { deps.sessions.revoke(it) }
        call.clearSessionCookie(deps.config)
        call.respond(HttpStatusCode.NoContent)
    }
```
Also add `import io.ktor.server.routing.get` to the file's imports.

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): verify-email, login, me, and logout endpoints"
```

---

### Task 10: Password reset

**Files:**
- Modify: `backend/src/main/kotlin/app/geostrategy/auth/AuthRoutes.kt`
- Test: `backend/src/test/kotlin/app/geostrategy/auth/PasswordResetTest.kt`

**Interfaces:**
- Consumes: Tasks 5–9.
- Produces endpoints:
  - `POST /v1/auth/password-reset/request` body `{"email"}` → **always** 202 `{"ok":true}` (no account enumeration); sends a reset email only if the account exists (1-hour token).
  - `POST /v1/auth/password-reset/confirm` body `{"token","newPassword"}` → 200 `{"ok":true}`; 400 `invalid_token` / `weak_password`. On success: password updated **and all existing sessions revoked**.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/auth/PasswordResetTest.kt`:
```kotlin
package app.geostrategy.auth

import app.geostrategy.RecordingEmailSender
import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.extractToken
import app.geostrategy.testDeps
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PasswordResetTest {
    @Test
    fun `reset flow changes password and revokes sessions`() = testApplication {
        val db = TestMongo.freshDb()
        val emails = RecordingEmailSender()
        application { appModule(testDeps(db, email = emails)) }
        val http = createClient { install(HttpCookies) }

        http.post("/v1/auth/register") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"old-password-1"}""")
        }
        http.post("/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"old-password-1"}""")
        }
        assertEquals(HttpStatusCode.OK, http.get("/v1/me").status)

        val req = http.post("/v1/auth/password-reset/request") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com"}""")
        }
        assertEquals(HttpStatusCode.Accepted, req.status)
        val token = extractToken(emails.sent.last().html)

        val confirm = http.post("/v1/auth/password-reset/confirm") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"$token","newPassword":"new-password-2"}""")
        }
        assertEquals(HttpStatusCode.OK, confirm.status)

        // old session is dead
        assertEquals(HttpStatusCode.Unauthorized, http.get("/v1/me").status)
        // old password no longer works, new one does
        val oldLogin = http.post("/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"old-password-1"}""")
        }
        assertEquals(HttpStatusCode.Unauthorized, oldLogin.status)
        val newLogin = http.post("/v1/auth/login") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ada@example.com","password":"new-password-2"}""")
        }
        assertEquals(HttpStatusCode.OK, newLogin.status)
    }

    @Test
    fun `request for unknown email still returns 202 and sends nothing`() = testApplication {
        val emails = RecordingEmailSender()
        application { appModule(testDeps(TestMongo.freshDb(), email = emails)) }
        val res = client.post("/v1/auth/password-reset/request") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"ghost@example.com"}""")
        }
        assertEquals(HttpStatusCode.Accepted, res.status)
        assertEquals(0, emails.sent.size)
    }

    @Test
    fun `confirm with bad token is rejected`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }
        val res = client.post("/v1/auth/password-reset/confirm") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"bogus","newPassword":"long-enough-pw"}""")
        }
        assertEquals(HttpStatusCode.BadRequest, res.status)
        assertTrue(res.bodyAsText().contains("invalid_token"))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.auth.PasswordResetTest"`
Expected: FAIL — 404s for the new routes.

- [ ] **Step 3: Implement the routes**

Add to `AuthRoutes.kt` (DTOs at file level, routes inside `authRoutes`; import `app.geostrategy.email.resetEmailHtml`):
```kotlin
@Serializable data class ResetRequest(val email: String)
@Serializable data class ResetConfirmRequest(val token: String, val newPassword: String)
```
```kotlin
    post("/v1/auth/password-reset/request") {
        val body = call.receive<ResetRequest>()
        val user = deps.users.findByEmail(body.email.trim().lowercase())
        if (user != null) {
            val token = deps.tokens.issue(user.id, TokenPurpose.PASSWORD_RESET, Duration.ofHours(1))
            deps.emailSender.send(user.email, "Reset your GeoStrategy password", resetEmailHtml(deps.config.appUrl, token))
        }
        call.respond(HttpStatusCode.Accepted, OkResponse())
    }

    post("/v1/auth/password-reset/confirm") {
        val body = call.receive<ResetConfirmRequest>()
        if (body.newPassword.length < 8) {
            throw AppException(HttpStatusCode.BadRequest, "weak_password", "Your password must be at least 8 characters.")
        }
        val userId = deps.tokens.consume(body.token, TokenPurpose.PASSWORD_RESET)
            ?: throw AppException(HttpStatusCode.BadRequest, "invalid_token", "This link is invalid or has expired. Please request a new one.")
        deps.users.setPasswordHash(userId, deps.passwordHasher.hash(body.newPassword))
        deps.sessions.revokeAllFor(userId)
        call.respond(OkResponse())
    }
```

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): password reset with session revocation and no account enumeration"
```

---

### Task 11: Google sign-in

**Files:**
- Modify: `backend/src/main/kotlin/app/geostrategy/auth/GoogleAuth.kt` (real client + routes)
- Modify: `backend/src/main/kotlin/app/geostrategy/Application.kt` (wire `RealGoogleIdentityClient` when configured; register `googleAuthRoutes`)
- Test: `backend/src/test/kotlin/app/geostrategy/auth/GoogleAuthTest.kt`

**Interfaces:**
- Consumes: `GoogleIdentityClient`/`GoogleIdentity` (declared Task 8), `SessionService`, cookie helpers, `UserRepository`.
- Produces:
  - `class RealGoogleIdentityClient(clientId: String, clientSecret: String, http: HttpClient) : GoogleIdentityClient`
  - `fun Route.googleAuthRoutes(deps: AppDeps)` registered inside `appModule`'s `routing` block (this task adds the call).
  - `GET /v1/auth/google/start` → 302 to Google's authorize URL; sets a 10-minute `gs_oauth_state` cookie. 404 `google_disabled` if not configured.
  - `GET /v1/auth/google/callback?code&state` → validates state, exchanges code, upserts/links the user, creates a session, 302 to `{appUrl}/auth/complete`. 400 `oauth_state_mismatch` on bad state.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/auth/GoogleAuthTest.kt`:
```kotlin
package app.geostrategy.auth

import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.testDeps
import app.geostrategy.users.User
import app.geostrategy.users.UserRepository
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class FakeGoogleIdentityClient(private val email: String = "ada@example.com") : GoogleIdentityClient {
    override suspend fun exchange(code: String, redirectUri: String): GoogleIdentity {
        check(code == "good-code") { "unexpected code" }
        return GoogleIdentity(subject = "google-sub-1", email = email, emailVerified = true)
    }
}

class GoogleAuthTest {
    @Test
    fun `start redirects to google and sets state cookie`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb(), google = FakeGoogleIdentityClient())) }
        val http = createClient { followRedirects = false; install(HttpCookies) }
        val res = http.get("/v1/auth/google/start")
        assertEquals(HttpStatusCode.Found, res.status)
        val location = res.headers[HttpHeaders.Location]!!
        assertTrue(location.startsWith("https://accounts.google.com/o/oauth2/v2/auth"))
        assertTrue(location.contains("state="))
    }

    @Test
    fun `callback creates a verified user, session, and redirects to the app`() = testApplication {
        val db = TestMongo.freshDb()
        application { appModule(testDeps(db, google = FakeGoogleIdentityClient())) }
        val http = createClient { followRedirects = false; install(HttpCookies) }

        val start = http.get("/v1/auth/google/start")
        val state = Url(start.headers[HttpHeaders.Location]!!).parameters["state"]!!

        val cb = http.get("/v1/auth/google/callback?code=good-code&state=$state")
        assertEquals(HttpStatusCode.Found, cb.status)
        assertTrue(cb.headers[HttpHeaders.Location]!!.endsWith("/auth/complete"))

        val user = runBlocking { UserRepository(db).findByEmail("ada@example.com") }
        assertNotNull(user)
        assertTrue(user.emailVerified)
        assertEquals("google-sub-1", user.googleId)

        // session cookie works
        assertEquals(HttpStatusCode.OK, http.get("/v1/me").status)
    }

    @Test
    fun `callback links google to an existing email account`() = testApplication {
        val db = TestMongo.freshDb()
        runBlocking {
            UserRepository(db).insert(
                User(email = "ada@example.com", passwordHash = "x", createdAt = Instant.now(), updatedAt = Instant.now()),
            )
        }
        application { appModule(testDeps(db, google = FakeGoogleIdentityClient())) }
        val http = createClient { followRedirects = false; install(HttpCookies) }
        val state = Url(http.get("/v1/auth/google/start").headers[HttpHeaders.Location]!!).parameters["state"]!!
        http.get("/v1/auth/google/callback?code=good-code&state=$state")

        val user = runBlocking { UserRepository(db).findByEmail("ada@example.com") }!!
        assertEquals("google-sub-1", user.googleId)
    }

    @Test
    fun `callback with mismatched state is rejected`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb(), google = FakeGoogleIdentityClient())) }
        val http = createClient { followRedirects = false; install(HttpCookies) }
        http.get("/v1/auth/google/start")
        val res = http.get("/v1/auth/google/callback?code=good-code&state=WRONG")
        assertEquals(HttpStatusCode.BadRequest, res.status)
    }

    @Test
    fun `start returns 404 when google is not configured`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb(), google = null)) }
        val res = client.get("/v1/auth/google/start")
        assertEquals(HttpStatusCode.NotFound, res.status)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.auth.GoogleAuthTest"`
Expected: FAIL — 404 for the new routes.

- [ ] **Step 3: Implement routes and the real client**

Replace `backend/src/main/kotlin/app/geostrategy/auth/GoogleAuth.kt` with:
```kotlin
package app.geostrategy.auth

import app.geostrategy.AppDeps
import app.geostrategy.http.AppException
import app.geostrategy.users.User
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.forms.submitForm
import io.ktor.http.Cookie
import io.ktor.http.HttpStatusCode
import io.ktor.http.URLBuilder
import io.ktor.http.isSuccess
import io.ktor.http.parameters
import io.ktor.server.response.respondRedirect
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import java.util.Base64

data class GoogleIdentity(val subject: String, val email: String, val emailVerified: Boolean)

interface GoogleIdentityClient {
    suspend fun exchange(code: String, redirectUri: String): GoogleIdentity
}

@Serializable
private data class GoogleTokenResponse(@SerialName("id_token") val idToken: String)

/**
 * Exchanges the OAuth code at Google's token endpoint and reads the id_token payload.
 * The payload is trusted without signature verification because it is received
 * directly from Google's token endpoint over TLS (per OIDC Core 3.1.3.7 note).
 */
class RealGoogleIdentityClient(
    private val clientId: String,
    private val clientSecret: String,
    private val http: HttpClient,
) : GoogleIdentityClient {
    override suspend fun exchange(code: String, redirectUri: String): GoogleIdentity {
        val res = http.submitForm(
            url = "https://oauth2.googleapis.com/token",
            formParameters = parameters {
                append("code", code)
                append("client_id", clientId)
                append("client_secret", clientSecret)
                append("redirect_uri", redirectUri)
                append("grant_type", "authorization_code")
            },
        )
        check(res.status.isSuccess()) { "Google token exchange failed: HTTP ${res.status.value}" }
        val idToken = res.body<GoogleTokenResponse>().idToken
        val payloadJson = String(Base64.getUrlDecoder().decode(idToken.split(".")[1]))
        val payload = Json.parseToJsonElement(payloadJson).jsonObject
        return GoogleIdentity(
            subject = payload["sub"]!!.jsonPrimitive.content,
            email = payload["email"]!!.jsonPrimitive.content.lowercase(),
            emailVerified = payload["email_verified"]?.jsonPrimitive?.content == "true",
        )
    }
}

private const val STATE_COOKIE = "gs_oauth_state"

fun Route.googleAuthRoutes(deps: AppDeps) {
    val google = deps.googleIdentity
    val redirectUri = "${deps.config.baseUrl}/v1/auth/google/callback"

    get("/v1/auth/google/start") {
        if (google == null) throw AppException(HttpStatusCode.NotFound, "google_disabled", "Google sign-in is not available.")
        val state = randomToken()
        call.response.cookies.append(
            Cookie(
                name = STATE_COOKIE, value = state, path = "/", httpOnly = true,
                secure = deps.config.secureCookies, maxAge = 600, extensions = mapOf("SameSite" to "Lax"),
            ),
        )
        val url = URLBuilder("https://accounts.google.com/o/oauth2/v2/auth").apply {
            parameters.append("client_id", deps.config.googleClientId ?: "test-client-id")
            parameters.append("redirect_uri", redirectUri)
            parameters.append("response_type", "code")
            parameters.append("scope", "openid email")
            parameters.append("state", state)
        }.buildString()
        call.respondRedirect(url)
    }

    get("/v1/auth/google/callback") {
        if (google == null) throw AppException(HttpStatusCode.NotFound, "google_disabled", "Google sign-in is not available.")
        val state = call.request.queryParameters["state"]
        val cookieState = call.request.cookies[STATE_COOKIE]
        if (state == null || state != cookieState) {
            throw AppException(HttpStatusCode.BadRequest, "oauth_state_mismatch", "Sign-in session expired. Please try again.")
        }
        val code = call.request.queryParameters["code"]
            ?: throw AppException(HttpStatusCode.BadRequest, "oauth_missing_code", "Google didn't complete sign-in. Please try again.")

        val identity = google.exchange(code, redirectUri)
        val existing = deps.users.findByEmail(identity.email)
        val user = if (existing != null) {
            if (existing.googleId == null) deps.users.linkGoogle(existing.id, identity.subject)
            existing
        } else {
            val now = Instant.now()
            deps.users.insert(
                User(
                    email = identity.email, googleId = identity.subject,
                    emailVerified = identity.emailVerified, createdAt = now, updatedAt = now,
                ),
            )
        }
        val raw = deps.sessions.create(user.id)
        call.setSessionCookie(raw, deps.config)
        call.respondRedirect("${deps.config.appUrl}/auth/complete")
    }
}
```

In `Application.kt`: add `googleAuthRoutes(deps)` after `authRoutes(deps)` in the `routing` block, and in `main()` replace `googleIdentity = null` with:
```kotlin
googleIdentity = if (config.googleClientId != null && config.googleClientSecret != null) {
    RealGoogleIdentityClient(config.googleClientId, config.googleClientSecret, httpClient)
} else null,
```
(imports: `app.geostrategy.auth.googleAuthRoutes`, `app.geostrategy.auth.RealGoogleIdentityClient`).

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): Google sign-in with OIDC code flow and account linking"
```

---

### Task 12: CORS, Dockerfile, fly.toml, deploy runbook

**Files:**
- Create: `backend/src/main/kotlin/app/geostrategy/http/Cors.kt`
- Modify: `backend/src/main/kotlin/app/geostrategy/Application.kt` (install CORS)
- Create: `backend/Dockerfile`, `backend/fly.toml`, `backend/README.md`
- Test: `backend/src/test/kotlin/app/geostrategy/http/CorsTest.kt`

**Interfaces:**
- Consumes: `AppConfig.appUrl` (Task 1), `appModule` (Task 8).
- Produces: `fun Application.installCors(config: AppConfig)`; production container + Fly.io config; deploy runbook.

- [ ] **Step 1: Write the failing test**

`backend/src/test/kotlin/app/geostrategy/http/CorsTest.kt`:
```kotlin
package app.geostrategy.http

import app.geostrategy.TestMongo
import app.geostrategy.appModule
import app.geostrategy.testDeps
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.http.HttpHeaders
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CorsTest {
    @Test
    fun `app origin is allowed with credentials, others are not`() = testApplication {
        application { appModule(testDeps(TestMongo.freshDb())) }
        // testDeps uses AppConfig defaults -> appUrl = http://localhost:4200
        val allowed = client.get("/healthz") { header(HttpHeaders.Origin, "http://localhost:4200") }
        assertEquals("http://localhost:4200", allowed.headers[HttpHeaders.AccessControlAllowOrigin])
        assertEquals("true", allowed.headers[HttpHeaders.AccessControlAllowCredentials])

        val denied = client.get("/healthz") { header(HttpHeaders.Origin, "https://evil.example") }
        assertNull(denied.headers[HttpHeaders.AccessControlAllowOrigin])
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "app.geostrategy.http.CorsTest"`
Expected: FAIL — no CORS headers present.

- [ ] **Step 3: Implement CORS + deployment files**

`backend/src/main/kotlin/app/geostrategy/http/Cors.kt`:
```kotlin
package app.geostrategy.http

import app.geostrategy.config.AppConfig
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.cors.routing.CORS

fun Application.installCors(config: AppConfig) {
    val appHost = config.appUrl.substringAfter("://")
    install(CORS) {
        allowHost(appHost, schemes = listOf("http", "https"))
        allowCredentials = true
        allowHeader(HttpHeaders.ContentType)
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Patch)
        allowMethod(HttpMethod.Delete)
    }
}
```

In `Application.kt`, add `installCors(deps.config)` right after `installErrorHandling()` (import `app.geostrategy.http.installCors`).

`backend/Dockerfile`:
```dockerfile
FROM gradle:8.14-jdk21 AS build
WORKDIR /src
COPY . .
RUN gradle --no-daemon installDist

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/build/install/geostrategy-backend/ /app/
EXPOSE 8080
CMD ["/app/bin/geostrategy-backend"]
```

`backend/fly.toml`:
```toml
app = "geostrategy-api"
primary_region = "waw"  # change to the region closest to your MongoDB Atlas cluster

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false
  min_machines_running = 1

  [[http_service.checks]]
    method = "GET"
    path = "/healthz"
    interval = "15s"
    timeout = "5s"
    grace_period = "20s"
```

`backend/README.md`:
```markdown
# GeoStrategy backend

## Local development
1. Prereqs: JDK 21, Docker Desktop (for Testcontainers and a local Mongo).
2. Run Mongo locally: `docker run -d -p 27017:27017 --name gs-mongo mongo:7.0`
3. Run tests: `./gradlew test`
4. Run the server: `./gradlew run` (health check: http://localhost:8080/healthz)

Without `RESEND_API_KEY`, emails are logged to stdout instead of sent —
copy the `token=` value from the log line to complete flows manually.

## Deploy to Fly.io (first time)
1. `fly launch --no-deploy --copy-config` (accept the existing fly.toml; adjust app name/region)
2. Set secrets:
   fly secrets set \
     MONGODB_URI="mongodb+srv://<user>:<pass>@<cluster>.mongodb.net" \
     MONGODB_DB="geostrategy" \
     BASE_URL="https://api.<your-domain>" \
     APP_URL="https://app.<your-domain>" \
     COOKIE_DOMAIN=".<your-domain>" \
     RESEND_API_KEY="re_..." \
     EMAIL_FROM="GeoStrategy <noreply@<your-domain>>" \
     GOOGLE_CLIENT_ID="..." GOOGLE_CLIENT_SECRET="..."
3. `fly deploy`
4. In Cloudflare DNS: CNAME `api` -> `geostrategy-api.fly.dev` (proxied), after
   `fly certs add api.<your-domain>`.
5. Google Cloud Console: add `https://api.<your-domain>/v1/auth/google/callback`
   as an authorized redirect URI on the OAuth client.
6. MongoDB Atlas: allow the Fly.io egress IPs (or 0.0.0.0/0 + strong credentials
   to start), database user with readWrite on `geostrategy`.
```

- [ ] **Step 4: Run all tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Verify the container builds**

Run: `docker build -t geostrategy-backend ./backend`
Expected: image builds successfully.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): CORS, Dockerfile, fly.toml and deploy runbook"
```

---

## Done criteria for Plan 1

- `./gradlew test` green (all tasks).
- `docker build` succeeds.
- Manual smoke test locally: register → copy token from log → verify → login → `GET /v1/me` → logout.
- After `fly deploy`: `https://api.<domain>/healthz` returns `ok`; register/login work against the deployed API.

**Next:** Plan 2 (assessment engine — sites, job queue worker, crawler + platform fingerprinting, Claude analysis + plan generation with structured outputs, SSE progress, quotas) is written after this plan is implemented.
