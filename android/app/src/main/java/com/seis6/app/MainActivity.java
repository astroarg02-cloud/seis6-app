package com.seis6.app;

import android.os.Bundle;
import android.os.Build;
import android.graphics.Color;
import android.webkit.WebView;
import android.view.WindowManager;
import android.view.View;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyEdgeToEdgeBlack();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyEdgeToEdgeBlack();
    }

    @Override
    public void onPause() {
        super.onPause();
        try {
            android.webkit.CookieManager.getInstance().flush();
        } catch (Exception ignored) {}
    }

    @Override
    public void onStop() {
        super.onStop();
        try {
            android.webkit.CookieManager.getInstance().flush();
        } catch (Exception ignored) {}
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyEdgeToEdgeBlack();
        }
    }

    private void applyEdgeToEdgeBlack() {
        try {
            Window window = getWindow();
            if (window != null) {
                window.setBackgroundDrawableResource(android.R.color.black);
                if (window.getDecorView() != null) {
                    window.getDecorView().setBackgroundColor(Color.BLACK);
                }
                View contentView = window.findViewById(android.R.id.content);
                if (contentView != null) {
                    contentView.setBackgroundColor(Color.BLACK);
                }

                window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
                window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
                window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

                window.setStatusBarColor(Color.BLACK);
                window.setNavigationBarColor(Color.BLACK);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    WindowManager.LayoutParams lp = window.getAttributes();
                    lp.layoutInDisplayCutoutMode =
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                    window.setAttributes(lp);
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    window.setNavigationBarContrastEnforced(false);
                    window.setStatusBarContrastEnforced(false);
                }

                WindowCompat.setDecorFitsSystemWindows(window, false);

                WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(window, window.getDecorView());
                controller.setAppearanceLightStatusBars(false);
                controller.setAppearanceLightNavigationBars(false);
            }

            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                webView.setBackgroundColor(Color.BLACK);
                webView.setOverScrollMode(WebView.OVER_SCROLL_IF_CONTENT_SCROLLS);
                try {
                    android.webkit.WebSettings settings = webView.getSettings();
                    settings.setDomStorageEnabled(true);
                    settings.setDatabaseEnabled(true);
                    settings.setJavaScriptEnabled(true);
                    settings.setLoadsImagesAutomatically(true);
                    // Use LOAD_DEFAULT to automatically fetch updated assets and code from the live server
                    settings.setCacheMode(android.webkit.WebSettings.LOAD_DEFAULT);
                } catch (Exception ignoredSettings) {}

                // Register native DownloadListener for handling direct HTTP/HTTPS file downloads into Downloads folder
                try {
                    webView.setDownloadListener(new android.webkit.DownloadListener() {
                        @Override
                        public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                            try {
                                if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                                    android.app.DownloadManager.Request request = new android.app.DownloadManager.Request(android.net.Uri.parse(url));
                                    if (mimetype != null && !mimetype.isEmpty()) {
                                        request.setMimeType(mimetype);
                                    }
                                    String cookies = android.webkit.CookieManager.getInstance().getCookie(url);
                                    if (cookies != null) {
                                        request.addRequestHeader("cookie", cookies);
                                    }
                                    if (userAgent != null) {
                                        request.addRequestHeader("User-Agent", userAgent);
                                    }
                                    request.setDescription("Descargando archivo en Vault Seis6...");
                                    String guessed = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimetype);
                                    request.setTitle(guessed);
                                    request.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                                    request.setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, guessed);
                                    android.app.DownloadManager dm = (android.app.DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                                    if (dm != null) {
                                        dm.enqueue(request);
                                        android.widget.Toast.makeText(getApplicationContext(), "Guardando en carpeta Descargas: " + guessed, android.widget.Toast.LENGTH_SHORT).show();
                                    }
                                }
                            } catch (Exception dlEx) {
                                dlEx.printStackTrace();
                            }
                        }
                    });
                } catch (Exception ignoredDl) {}
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
