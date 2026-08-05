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
    implementation("org.jsoup:jsoup:1.18.3")
    implementation("com.anthropic:anthropic-java:2.34.0")

    testImplementation(kotlin("test"))
    testImplementation("io.ktor:ktor-server-test-host:$ktorVersion")
    testImplementation("io.ktor:ktor-client-mock:$ktorVersion")
    testImplementation("org.testcontainers:mongodb:1.21.0")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
}

kotlin { jvmToolchain(21) }

application { mainClass.set("app.geostrategy.ApplicationKt") }

tasks.test {
    useJUnitPlatform()
    // Docker Engine 29+ rejects the default API version requested by
    // Testcontainers' bundled docker-java; pin a supported version.
    systemProperty("api.version", "1.44")
}
