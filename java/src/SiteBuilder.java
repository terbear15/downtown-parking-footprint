import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Build step for Downtown Parking Footprint.
 * Reads java/template/index.html, stamps the build date and the OSM fetch date
 * (taken from docs/data/index.json, written by python/build_data.py),
 * and writes docs/index.html for GitHub Pages.
 */
public class SiteBuilder {
    public static void main(String[] args) throws IOException {
        Path template = Paths.get("java", "template", "index.html");
        Path index = Paths.get("docs", "data", "index.json");
        Path out = Paths.get("docs", "index.html");

        String dataDate = "unknown";
        Matcher m = Pattern.compile("\"osmFetched\":\"(\\d{4}-\\d{2}-\\d{2})\"").matcher(Files.readString(index, StandardCharsets.UTF_8));
        if (m.find()) {
            dataDate = m.group(1);
        }
        String html = Files.readString(template, StandardCharsets.UTF_8)
            .replace("{{BUILD_DATE}}", LocalDate.now().toString())
            .replace("{{DATA_DATE}}", dataDate);
        Files.writeString(out, html, StandardCharsets.UTF_8);
        System.out.println("wrote " + out + " (OSM data " + dataDate + ")");
    }
}
