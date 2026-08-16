# Build stage. Copy the Gradle files first, so the dependency layer stays cached
# when only the sources change.
FROM gradle:8.14-jdk21 AS build
WORKDIR /src
COPY settings.gradle.kts build.gradle.kts ./
COPY gradle ./gradle
RUN gradle --no-daemon dependencies > /dev/null 2>&1 || true
COPY . .
RUN gradle --no-daemon installDist

# Runtime stage. A 512 MB Fly machine needs a heap cap, or the JVM goes out of memory.
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/build/install/geostrategy-backend/ /app/
ENV JAVA_OPTS="-Xmx300m -XX:+ExitOnOutOfMemoryError"
EXPOSE 8080
CMD ["/app/bin/geostrategy-backend"]
