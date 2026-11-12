import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * Reads data/sample.csv and writes docs/index.html.
 * GitHub Pages serves the docs/ folder as a static site, so the
 * browser only runs plain HTML. Java runs here, at build time.
 */
public class SiteBuilder {
    public static void main(String[] args) throws IOException {
        Path csv = Paths.get("data", "sample.csv");
        Path out = Paths.get("docs", "index.html");

        List<String> lines = Files.readAllLines(csv, StandardCharsets.UTF_8);
        StringBuilder rows = new StringBuilder();
        for (String line : lines.subList(1, lines.size())) {
            String[] c = line.split(",", -1);
            rows.append("      <tr><td>").append(esc(c[0])).append("</td><td>")
                .append(esc(c[1])).append("</td><td>").append(esc(c[2])).append("</td></tr>\n");
        }

        String html = """
            <!DOCTYPE html>
            <html lang="zh">
            <head>
              <meta charset="utf-8">
              <title>Surface Parking Demo</title>
              <style>
                body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #222; }
                table { border-collapse: collapse; width: 100%; }
                th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; }
                .warn { background: #fff4e5; border-left: 4px solid #f0a020; padding: 8px 12px; }
              </style>
            </head>
            <body>
              <h1>Surface Parking Demo</h1>
              <p class="warn">占位数据，不是分析结果。模型跑通后会替换。</p>
              <table>
                <tr><th>城市</th><th>停车用地占比（%）</th><th>备注</th></tr>
            %ROWS%  </table>
            </body>
            </html>
            """.replace("%ROWS%", rows.toString());

        Files.createDirectories(out.getParent());
        Files.writeString(out, html, StandardCharsets.UTF_8);
        System.out.println("wrote " + out);
    }

    private static String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
