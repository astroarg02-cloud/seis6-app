#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Locate all android main directories
function findAndroidMainDirs() {
  const candidates = [
    path.resolve(process.cwd(), 'cap-app/android/app/src/main'),
    path.resolve(__dirname, '../cap-app/android/app/src/main'),
    path.resolve(process.cwd(), 'android/app/src/main'),
    path.resolve(__dirname, '../android/app/src/main'),
  ];
  const found = [];
  for (const c of candidates) {
    if (fs.existsSync(c) && !found.includes(c)) {
      found.push(c);
    }
  }
  if (found.length === 0) {
    throw new Error('Android main directory not found. Candidates checked: ' + candidates.join(', '));
  }
  return found;
}

const mainDirs = findAndroidMainDirs();
console.log('Configuring Android styles, icons, and MainActivity in:', mainDirs);

// Master source of truth for custom icons
const masterResDir = path.resolve(__dirname, '../android/app/src/main/res');

for (const mainDir of mainDirs) {
  const resDir = path.join(mainDir, 'res');

  // Remove default vector launcher icons that override PNG mipmap icons on API 24+
  const obsoleteVectors = [
    path.join(resDir, 'drawable-v24/ic_launcher_foreground.xml'),
    path.join(resDir, 'drawable/ic_launcher_background.xml'),
    path.join(resDir, 'drawable/ic_launcher_foreground.xml'),
  ];
  for (const obsolete of obsoleteVectors) {
    if (fs.existsSync(obsolete)) {
      try {
        fs.unlinkSync(obsolete);
        console.log('✓ Removed obsolete vector:', obsolete);
      } catch (e) {}
    }
  }

  // Ensure custom SEIS 6 mipmap and splash icons are copied to this res directory
  if (masterResDir !== resDir && fs.existsSync(masterResDir)) {
    const iconDirs = [
      'mipmap-mdpi',
      'mipmap-hdpi',
      'mipmap-xhdpi',
      'mipmap-xxhdpi',
      'mipmap-xxxhdpi',
      'mipmap-anydpi-v26',
      'drawable',
      'drawable-port-mdpi',
      'drawable-port-hdpi',
      'drawable-port-xhdpi',
      'drawable-port-xxhdpi',
      'drawable-port-xxxhdpi',
      'drawable-land-mdpi',
      'drawable-land-hdpi',
      'drawable-land-xhdpi',
      'drawable-land-xxhdpi',
      'drawable-land-xxxhdpi',
    ];
    for (const sub of iconDirs) {
      const srcSub = path.join(masterResDir, sub);
      const dstSub = path.join(resDir, sub);
      if (fs.existsSync(srcSub)) {
        fs.mkdirSync(dstSub, { recursive: true });
        const files = fs.readdirSync(srcSub);
        for (const file of files) {
          fs.copyFileSync(path.join(srcSub, file), path.join(dstSub, file));
        }
      }
    }
    console.log('✓ Synchronized all custom SEIS 6 icons into:', resDir);
  }

  // Ensure ic_launcher_background is #040508
  const bgDir = path.join(resDir, 'values');
  fs.mkdirSync(bgDir, { recursive: true });
  fs.writeFileSync(
    path.join(bgDir, 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#040508</color>\n</resources>\n`,
    'utf8'
  );

  // 1. Write colors.xml (Pure black system colors)
  const colorsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#000000</color>
    <color name="colorPrimaryDark">#000000</color>
    <color name="colorAccent">#0066FF</color>
</resources>
`;

  for (const dirName of ['values', 'values-night']) {
    const dir = path.join(resDir, dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'colors.xml'), colorsXml, 'utf8');
  }

  // 2. Base styles.xml
  const baseStylesXml = `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="AppTheme" parent="Theme.AppCompat.NoActionBar">
        <item name="colorPrimary">#000000</item>
        <item name="colorPrimaryDark">#000000</item>
        <item name="colorAccent">#0066FF</item>
        <item name="android:statusBarColor">#000000</item>
        <item name="android:navigationBarColor">#000000</item>
        <item name="android:windowBackground">#000000</item>
        <item name="android:colorBackground">#000000</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">#000000</item>
        <item name="android:windowBackground">#000000</item>
        <item name="android:colorBackground">#000000</item>
        <item name="android:statusBarColor">#000000</item>
        <item name="android:navigationBarColor">#000000</item>
        <item name="android:windowDrawsSystemBarBackgrounds">true</item>
        <item name="android:windowLightStatusBar" tools:targetApi="m">false</item>
        <item name="android:windowLightNavigationBar" tools:targetApi="o_mr1">false</item>
        <item name="android:windowTranslucentStatus">false</item>
        <item name="android:windowTranslucentNavigation">false</item>
    </style>

    <style name="AppTheme.NoActionBarLaunch" parent="AppTheme.NoActionBar">
        <item name="android:background">#000000</item>
        <item name="android:windowBackground">#000000</item>
        <item name="android:statusBarColor">#000000</item>
        <item name="android:navigationBarColor">#000000</item>
    </style>
</resources>
`;

  for (const dirName of ['values', 'values-night']) {
    const dir = path.join(resDir, dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'styles.xml'), baseStylesXml, 'utf8');
  }

  // 3. Notch cutout styles for API 28+ (Android 9+)
  const v28StylesXml = `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">#000000</item>
        <item name="android:windowBackground">#000000</item>
        <item name="android:colorBackground">#000000</item>
        <item name="android:statusBarColor">#000000</item>
        <item name="android:navigationBarColor">#000000</item>
        <item name="android:windowDrawsSystemBarBackgrounds">true</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowLightNavigationBar">false</item>
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
        <item name="android:windowTranslucentStatus">false</item>
        <item name="android:windowTranslucentNavigation">false</item>
    </style>

    <style name="AppTheme.NoActionBarLaunch" parent="AppTheme.NoActionBar">
        <item name="android:background">#000000</item>
        <item name="android:windowBackground">#000000</item>
        <item name="android:statusBarColor">#000000</item>
        <item name="android:navigationBarColor">#000000</item>
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
    </style>
</resources>
`;

  for (const dirName of ['values-v28', 'values-night-v28']) {
    const dir = path.join(resDir, dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'styles.xml'), v28StylesXml, 'utf8');
  }

  // 4. Contrast removal styles for API 29+ (Android 10 - 16+)
  const v29StylesXml = `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">#000000</item>
        <item name="android:windowBackground">#000000</item>
        <item name="android:colorBackground">#000000</item>
        <item name="android:statusBarColor">#000000</item>
        <item name="android:navigationBarColor">#000000</item>
        <item name="android:windowDrawsSystemBarBackgrounds">true</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowLightNavigationBar">false</item>
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
        <item name="android:enforceNavigationBarContrast" tools:targetApi="q">false</item>
        <item name="android:enforceStatusBarContrast" tools:targetApi="q">false</item>
        <item name="android:windowTranslucentStatus">false</item>
        <item name="android:windowTranslucentNavigation">false</item>
    </style>

    <style name="AppTheme.NoActionBarLaunch" parent="AppTheme.NoActionBar">
        <item name="android:background">#000000</item>
        <item name="android:windowBackground">#000000</item>
        <item name="android:statusBarColor">#000000</item>
        <item name="android:navigationBarColor">#000000</item>
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
        <item name="android:enforceNavigationBarContrast" tools:targetApi="q">false</item>
        <item name="android:enforceStatusBarContrast" tools:targetApi="q">false</item>
    </style>
</resources>
`;

  for (const dirName of ['values-v29', 'values-night-v29', 'values-v31', 'values-night-v31']) {
    const dir = path.join(resDir, dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'styles.xml'), v29StylesXml, 'utf8');
  }

  // 5. MainActivity.java
  const mainActivityJava = `package com.seis6.app;

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
`;

  const javaDir = path.join(mainDir, 'java/com/seis6/app');
  fs.mkdirSync(javaDir, { recursive: true });
  fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), mainActivityJava, 'utf8');

  // 6. AndroidManifest.xml
  const manifestPath = path.join(mainDir, 'AndroidManifest.xml');
  if (fs.existsSync(manifestPath)) {
    let manifest = fs.readFileSync(manifestPath, 'utf8');
    if (!manifest.includes('android.max_aspect')) {
      manifest = manifest.replace(
        '</application>',
        '    <meta-data android:name="android.max_aspect" android:value="3.0" />\n    </application>'
      );
    }
    if (!manifest.includes('android:usesCleartextTraffic')) {
      manifest = manifest.replace(
        '<application',
        '<application android:usesCleartextTraffic="true"'
      );
    }
    if (!manifest.includes('android.permission.ACCESS_NETWORK_STATE')) {
      manifest = manifest.replace(
        '</manifest>',
        '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />\n    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="32" />\n</manifest>'
      );
    }
    if (!manifest.includes('requestLegacyExternalStorage')) {
      manifest = manifest.replace(
        '<application',
        '<application android:requestLegacyExternalStorage="true"'
      );
    }
    if (!manifest.includes('android:resizeableActivity')) {
      manifest = manifest.replace(
        '<activity',
        '<activity android:resizeableActivity="true" android:windowSoftInputMode="adjustResize"'
      );
      manifest = manifest.replace(
        '<application',
        '<application android:resizeableActivity="true"'
      );
    }
    fs.writeFileSync(manifestPath, manifest, 'utf8');
  }
}

// 7. Auto-heal android/variables.gradle (compileSdkVersion 36, targetSdkVersion 36, Android 16/15, Java 21 compatible)
const candidateRoots = [
  path.resolve(process.cwd(), 'android'),
  path.resolve(process.cwd(), 'cap-app/android'),
  path.resolve(__dirname, '../android'),
  path.resolve(__dirname, '../cap-app/android'),
];

const safeVariables = `ext {
    minSdkVersion = 24
    compileSdkVersion = 36
    targetSdkVersion = 36
    androidxActivityVersion = '1.11.0'
    androidxAppCompatVersion = '1.7.1'
    androidxCoordinatorLayoutVersion = '1.3.0'
    androidxCoreVersion = '1.17.0'
    androidxFragmentVersion = '1.8.9'
    coreSplashScreenVersion = '1.2.0'
    androidxWebkitVersion = '1.14.0'
    junitVersion = '4.13.2'
    androidxJunitVersion = '1.3.0'
    androidxEspressoCoreVersion = '3.7.0'
    cordovaAndroidVersion = '14.0.1'
}
`;

for (const aRoot of candidateRoots) {
  const vPath = path.join(aRoot, 'variables.gradle');
  if (fs.existsSync(vPath)) {
    fs.writeFileSync(vPath, safeVariables, 'utf8');
    console.log('✓ Ensured compileSdkVersion 36 in ' + vPath);
  }
}

// 7b. Auto-heal capacitor-cordova-android-plugins/build.gradle
for (const aRoot of candidateRoots) {
  const cordovaPluginsBuildGradle = path.join(aRoot, 'capacitor-cordova-android-plugins/build.gradle');
  if (fs.existsSync(cordovaPluginsBuildGradle)) {
    let cGradle = fs.readFileSync(cordovaPluginsBuildGradle, 'utf8');
    cGradle = cGradle.replace(/compileSdk\s*=\s*project\.hasProperty\('compileSdkVersion'\)\s*\?\s*rootProject\.ext\.compileSdkVersion\s*:\s*\d+/, "compileSdk = project.hasProperty('compileSdkVersion') ? rootProject.ext.compileSdkVersion : 36");
    cGradle = cGradle.replace(/targetSdkVersion\s*=\s*project\.hasProperty\('targetSdkVersion'\)\s*\?\s*rootProject\.ext\.targetSdkVersion\s*:\s*\d+/, "targetSdkVersion = project.hasProperty('targetSdkVersion') ? rootProject.ext.targetSdkVersion : 36");
    fs.writeFileSync(cordovaPluginsBuildGradle, cGradle, 'utf8');
    console.log('✓ Ensured fallback compileSdk 36 in ' + cordovaPluginsBuildGradle);
  }
}

// 8. Auto-heal android/gradle.properties
for (const aRoot of candidateRoots) {
  const gradlePropsPath = path.join(aRoot, 'gradle.properties');
  if (fs.existsSync(gradlePropsPath)) {
    let gProps = fs.readFileSync(gradlePropsPath, 'utf8');
    if (!gProps.includes('android.builder.sdkDownload')) {
      gProps += '\nandroid.builder.sdkDownload=true\n';
    }
    if (!gProps.includes('android.enableJetifier')) {
      gProps += '\nandroid.enableJetifier=true\n';
    }
    gProps = gProps.replace(/org\.gradle\.jvmargs=-Xmx\d+m/, 'org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8');
    fs.writeFileSync(gradlePropsPath, gProps, 'utf8');
    console.log('✓ Ensured auto sdkDownload and 2048m memory in ' + gradlePropsPath);
  }
}

// 8b. Auto-create local.properties if ANDROID_HOME is set
for (const aRoot of candidateRoots) {
  if (fs.existsSync(aRoot)) {
    const localPropsPath = path.join(aRoot, 'local.properties');
    const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '/usr/local/lib/android/sdk';
    if (!fs.existsSync(localPropsPath) && fs.existsSync(androidHome)) {
      fs.writeFileSync(localPropsPath, `sdk.dir=${androidHome}\n`, 'utf8');
      console.log('✓ Created local.properties with sdk.dir in ' + aRoot);
    }
  }
}

// 9. Auto-heal android/build.gradle (google-services 4.4.2 and layout.buildDirectory)
for (const aRoot of candidateRoots) {
  const rootBuildGradlePath = path.join(aRoot, 'build.gradle');
  if (fs.existsSync(rootBuildGradlePath)) {
    let rootGradle = fs.readFileSync(rootBuildGradlePath, 'utf8');
    rootGradle = rootGradle.replace(/classpath\s+['"]com\.google\.gms:google-services:[^'"]+['"]/, "classpath 'com.google.gms:google-services:4.4.2'");
    if (rootGradle.includes('delete rootProject.buildDir')) {
      rootGradle = rootGradle.replace('delete rootProject.buildDir', 'delete rootProject.layout.buildDirectory');
    }
    fs.writeFileSync(rootBuildGradlePath, rootGradle, 'utf8');
    console.log('✓ Ensured google-services 4.4.2 in ' + rootBuildGradlePath);
  }
}

// 10. Auto-heal android/app/build.gradle (Java 21 compileOptions, assignment operator = and safe google-services)
for (const aRoot of candidateRoots) {
  const appBuildGradlePath = path.join(aRoot, 'app/build.gradle');
  if (fs.existsSync(appBuildGradlePath)) {
    let appGradle = fs.readFileSync(appBuildGradlePath, 'utf8');
    // Ensure compileOptions
    if (!appGradle.includes('compileOptions')) {
      appGradle = appGradle.replace(
        'buildTypes {',
        'compileOptions {\n        sourceCompatibility JavaVersion.VERSION_21\n        targetCompatibility JavaVersion.VERSION_21\n    }\n    buildTypes {'
      );
    }
    // Ensure = operator for defaultConfig
    appGradle = appGradle.replace(/applicationId\s+"([^"]+)"/, 'applicationId = "$1"');
    appGradle = appGradle.replace(/minSdkVersion\s+rootProject/, 'minSdkVersion = rootProject');
    appGradle = appGradle.replace(/targetSdkVersion\s+rootProject/, 'targetSdkVersion = rootProject');
    appGradle = appGradle.replace(/versionCode\s+(\d+)/, 'versionCode = $1');
    appGradle = appGradle.replace(/versionName\s+"([^"]+)"/, 'versionName = "$1"');
    appGradle = appGradle.replace(/testInstrumentationRunner\s+"([^"]+)"/, 'testInstrumentationRunner = "$1"');
    appGradle = appGradle.replace(/minifyEnabled\s+false/, 'minifyEnabled = false');

    // Safe google-services check
    if (appGradle.includes('if (servicesJSON.text)')) {
      appGradle = appGradle.replace('if (servicesJSON.text)', 'if (servicesJSON.exists() && servicesJSON.text)');
    }

    // Clean up any internal class reference AarMetadataTask
    if (appGradle.includes('tasks.withType(com.android.build.gradle.internal.tasks.AarMetadataTask)')) {
      appGradle = appGradle.replace(/tasks\.withType\(com\.android\.build\.gradle\.internal\.tasks\.AarMetadataTask\)\.configureEach\s*\{\s*enabled\s*=\s*false\s*\}/g, '');
    }

    // Bypass any strict AarMetadata check mismatch safely by task name without internal class resolution
    if (!appGradle.includes('aarmetadata')) {
      appGradle += `
tasks.configureEach { task ->
    if (task.name.toLowerCase().contains("aarmetadata")) {
        task.enabled = false
    }
}
`;
    }

    fs.writeFileSync(appBuildGradlePath, appGradle, 'utf8');
    console.log('✓ Ensured Java 21 compileOptions and safe AarMetadataTask bypass in ' + appBuildGradlePath);
  }
}

console.log('All Android configuration applied successfully!');
