package com.tentamus.lims.inventory.service;

import com.tentamus.lims.core.config.Env;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.web.RuleException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * AI reading of a Supplier COA. Off unless ANTHROPIC_API_KEY is set (IT approval needed: the document is sent to
 * Anthropic's API to be read). The AI only proposes; a person confirms every value before it is saved.
 */
@Component
public class CoaReader {
    private static final String PROMPT = """
        This is a supplier Certificate of Analysis for a laboratory chemical, reference standard, reagent, medium or microbiological strain.
        Read it and return ONLY a JSON object with these keys (use null when the document does not state the value; never guess):
        {"chemical_name": string, "cas_number": string, "manufacturer_name": string, "catalog_number": string, "manufacturer_lot": string,
         "expiration_date": "YYYY-MM-DD", "retest_date": "YYYY-MM-DD", "purity_pct": number, "concentration": number, "concentration_unit": string,
         "evidence": {"<key>": "the exact text on the document that supports the value"}}
        Dates written like 04/2027 mean the last day of that month. Purity is a percentage number without the % sign.""";
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(20)).build();

    public CoaReader(ObjectMapper json) { this.json = json; }

    public boolean enabled() { return key() != null; }

    public String model() {
        String m = Env.get("LIMS_AI_MODEL");
        return m == null || m.isEmpty() ? "claude-sonnet-5-5" : m;
    }

    /** The values the AI read from the document, with the text it read each one from. */
    public JsonNode read(String base64, String mimeType) {
        Map<String, Object> source = Map.of("type", "base64", "media_type", mimeType, "data", base64);
        Map<String, Object> block = Map.of("type", "application/pdf".equals(mimeType) ? "document" : "image", "source", source);
        Map<String, Object> body = Map.of("model", model(), "max_tokens", 1500,
            "messages", List.of(Map.of("role", "user", "content", List.of(block, Map.of("type", "text", "text", PROMPT)))));
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.anthropic.com/v1/messages")).timeout(Duration.ofMinutes(2))
                .header("content-type", "application/json").header("x-api-key", key()).header("anthropic-version", "2023-06-01")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode data = json.readTree(res.body().isEmpty() ? "{}" : res.body());
            if (res.statusCode() / 100 != 2) {
                String why = data.path("error").path("message").asText("");
                throw new RuleException("The AI could not read the COA: " + (why.isEmpty() ? String.valueOf(res.statusCode()) : why));
            }
            StringBuilder text = new StringBuilder();
            for (JsonNode c : data.path("content")) if ("text".equals(c.path("type").asText())) text.append(c.path("text").asText());
            Matcher m = Pattern.compile("\\{[\\s\\S]*\\}").matcher(text);
            if (!m.find()) throw new RuleException("The AI did not return values for this COA");
            return json.readTree(m.group());
        } catch (RuleException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuleException("The AI could not read the COA: interrupted");
        } catch (Exception e) {
            throw new RuleException("The AI could not read the COA: " + e.getMessage());
        }
    }

    private static String key() {
        String k = Env.get("ANTHROPIC_API_KEY");
        return k == null || k.isEmpty() ? null : k;
    }
}
