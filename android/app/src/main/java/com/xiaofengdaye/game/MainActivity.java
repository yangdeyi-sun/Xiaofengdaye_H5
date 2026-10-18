package com.xiaofengdaye.game;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.JavascriptInterface;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import java.io.ByteArrayInputStream;

/** APK 内置离线资源；只加载自身 HTTPS 虚拟域名，不开放文件 URL 或任意网页导航。 */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "appassets.androidplatform.net";
    private WebView game;
    private final class OrientationBridge {
        @JavascriptInterface public void setOrientation(String value) {
            runOnUiThread(() -> setRequestedOrientation("portrait".equals(value)
                ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT : ("landscape".equals(value)
                    ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR)));
        }
    }
    private void lifecycle(String event) {
        if (game != null) game.evaluateJavascript("window.dispatchEvent(new Event('" + event + "'))", null);
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xff392715);
        getWindow().setNavigationBarColor(0xff392715);
        game = new WebView(this);
        game.setBackgroundColor(0xff392715);
        // Android 15/16 edge-to-edge：让网页内容避开状态栏和导航栏。
        game.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = android.os.Build.VERSION.SDK_INT >= 30
                ? insets.getInsets(android.view.WindowInsets.Type.systemBars()) : null;
            if (bars != null) view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        WebSettings settings = game.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString() + " XiaofengdayeAndroid");
        game.addJavascriptInterface(new OrientationBridge(), "XFNativeOrientation");
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        game.setWebViewClient(new WebViewClientCompat() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && ORIGIN.equals(uri.getHost())) {
                    WebResourceResponse local = loader.shouldInterceptRequest(uri);
                    if (local != null) return local;
                }
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !"https".equals(uri.getScheme()) || !ORIGIN.equals(uri.getHost());
            }
        });
        setContentView(game);
        game.requestApplyInsets();
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        game.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }
    @Override protected void onPause() {
        lifecycle("pagehide");
        game.onPause();
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (game != null) { game.onResume(); lifecycle("pageshow"); }
    }
    @Override public void onBackPressed() {
        handleBack();
    }
    private void handleBack() {
        game.evaluateJavascript("window.__xfHandleNativeBack ? window.__xfHandleNativeBack() : false", handled -> {
            if (!"true".equals(handled)) confirmExit();
        });
    }
    private void confirmExit() {
        new AlertDialog.Builder(this).setTitle("返回蜂巢休息？")
            .setMessage("当前进度会保存在本机。")
            .setNegativeButton("继续经营", null)
            .setPositiveButton("保存并退出", (dialog, which) -> {
                game.evaluateJavascript("window.dispatchEvent(new Event('xf-native-exit'));true", result -> finish());
            }).show();
    }
    @Override protected void onDestroy() {
        if (game != null) { game.stopLoading(); game.destroy(); game = null; }
        super.onDestroy();
    }
}
