import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;

/**
 * Build step: reads java/template/index.html, stamps the build date,
 * and writes docs/index.html for GitHub Pages. Java runs only here;
 * the browser runs the page's JavaScript (MapLibre map, buttons).
 */
public class SiteBuilder {
    public static void main(String[] args) throws IOException {
        Path template = Paths.get("java", "template", "index.html");
        Path out = Paths.get("docs", "index.html");
        String html = Files.readString(template, StandardCharsets.UTF_8)
            .replace("{{BUILD_DATE}}", LocalDate.now().toString());
        Files.createDirectories(out.getParent());
        Files.writeString(out, html, StandardCharsets.UTF_8);
        System.out.println("wrote " + out);
    }
}
