# Build stage. Copy the Gradle files first. Most dependency downloads then stay
# cached when only the sources change.
FROM gradle:8.14-jdk21 AS build
WORKDIR /src
COPY settings.gradle.kts build.gradle.kts ./
COPY gradle ./gradle
RUN gradle --no-daemon dependencies --configuration runtimeClasspath > /dev/null 2>&1 || true
COPY . .
RUN gradle --no-daemon installDist

# Runtime stage. A 512 MB Fly machine needs a heap cap and a direct-memory cap,
# or the JVM goes out of memory. The serial collector fits one shared vCPU.
FROM eclipse-temurin:21-jre
RUN useradd -r -u 10001 app
WORKDIR /app
COPY --from=build /src/build/install/geostrategy-backend/ /app/
ENV JAVA_OPTS="-Xmx300m -XX:MaxDirectMemorySize=96m -XX:+UseSerialGC -XX:+ExitOnOutOfMemoryError"
USER app
EXPOSE 8080
CMD ["/app/bin/geostrategy-backend"]
