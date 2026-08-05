package app.geostrategy.claude

import app.geostrategy.crawl.CrawlDigest
import com.anthropic.client.AnthropicClient
import com.anthropic.client.okhttp.AnthropicOkHttpClient
import com.anthropic.core.JsonValue
import com.anthropic.models.messages.CacheControlEphemeral
import com.anthropic.models.messages.JsonOutputFormat
import com.anthropic.models.messages.MessageCreateParams
import com.anthropic.models.messages.OutputConfig
import com.anthropic.models.messages.TextBlockParam
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

private val json = Json { ignoreUnknownKeys = true }

/**
 * Thin adapter over the official Anthropic Java SDK. Uses structured outputs
 * (output_config.format = json_schema) so responses always parse.
 * Not covered by unit tests: it makes network calls. The canned client covers
 * the ClaudeClient contract.
 */
class RealClaudeClient(apiKey: String, private val model: String) : ClaudeClient {
    private val client: AnthropicClient = AnthropicOkHttpClient.builder().apiKey(apiKey).build()
    private val analysisSchema = loadSchema("/schemas/analysis.json")
    private val planSchema = loadSchema("/schemas/plan.json")
    private val analyzeSystem = loadResource("/prompts/analyze-system.txt")
    private val planSystem = loadResource("/prompts/plan-system.txt")

    override suspend fun analyze(digest: CrawlDigest): ClaudeResponse<AnalysisResult> {
        val (text, usage) = complete(analyzeSystem, digestToPromptText(digest), analysisSchema)
        return ClaudeResponse(json.decodeFromString<AnalysisResult>(text), usage)
    }

    override suspend fun plan(analysis: AnalysisResult, platform: String): ClaudeResponse<PlanResult> {
        val user = "Platform: $platform\n\nFindings JSON:\n" + json.encodeToString(AnalysisResult.serializer(), analysis)
        val (text, usage) = complete(planSystem, user, planSchema)
        return ClaudeResponse(json.decodeFromString<PlanResult>(text), usage)
    }

    private suspend fun complete(system: String, user: String, schema: Any): Pair<String, ClaudeUsage> =
        withContext(Dispatchers.IO) {
            val params = MessageCreateParams.builder()
                .model(model)
                .maxTokens(16000L)
                .systemOfTextBlockParams(
                    listOf(
                        TextBlockParam.builder()
                            .text(system)
                            .cacheControl(CacheControlEphemeral.builder().build())
                            .build(),
                    ),
                )
                .outputConfig(
                    OutputConfig.builder()
                        .format(JsonOutputFormat.builder().schema(JsonValue.from(schema)).build())
                        .build(),
                )
                .addUserMessage(user)
                .build()
            val res = client.messages().create(params)
            val text = res.content().joinToString("") { block -> block.text().map { it.text() }.orElse("") }
            text to ClaudeUsage(res.usage().inputTokens(), res.usage().outputTokens())
        }

    private fun loadResource(path: String): String = javaClass.getResource(path)!!.readText()
    private fun loadSchema(path: String): Any = Json.parseToJsonElement(loadResource(path)).toJava()!!
}

internal fun JsonElement.toJava(): Any? = when (this) {
    is JsonNull -> null
    is JsonPrimitive -> if (isString) content else booleanOrNull ?: longOrNull ?: doubleOrNull ?: content
    is JsonArray -> map { it.toJava() }
    is JsonObject -> entries.associate { it.key to it.value.toJava() }
}
