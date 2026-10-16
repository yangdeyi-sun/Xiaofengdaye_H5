import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.zip.ZipFile;

/** JDK source launcher: 检查真实 APK 中的界面与本轮网页构建一致。 */
public class VerifyAndroidLayout {
    public static void main(String[] args) throws Exception {
        try (ZipFile apk = new ZipFile(args[0])) {
            for (String file : new String[] {"index.html", "styles.css", "assets/app.js"}) {
                var entry = apk.getEntry("assets/" + file);
                if (entry == null) throw new IllegalStateException("Missing web UI: " + file);
                byte[] embedded = apk.getInputStream(entry).readAllBytes();
                byte[] web = Files.readAllBytes(Path.of(args[1], file));
                if (!Arrays.equals(embedded, web)) throw new IllegalStateException("Android/web UI mismatch: " + file);
            }
            String html = Files.readString(Path.of(args[1], "index.html"));
            if (!html.contains("id=\"app\"") || !html.contains("./styles.css") || !html.contains("./assets/app.js")) {
                throw new IllegalStateException("Android must use the original web UI entry");
            }
            if (apk.stream().anyMatch(entry -> entry.getName().contains("canvas-preview"))) {
                throw new IllegalStateException("Mini game preview must not be packaged into Android");
            }
        }
        System.out.println("Android layout verified: original web entry, identical JavaScript/CSS, no mini game preview.");
    }
}
