package com.soyeib.wifiadmin;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * The whole app is a web page (assets/index.html). A web page is not allowed to call the router directly,
 * so this class gives the page three small helpers: plain HTTP to the router, MD5/SHA-256, and the router's AES.
 */
public class MainActivity extends Activity {
    // Fixed key and IV used by the Tenda admin page itself (js/aes/util.js).
    private static final byte[] AES_KEY = "AbDu2ZdTFut6eQ7f".getBytes(StandardCharsets.UTF_8);
    private static final byte[] AES_IV = "EU5H62G9ICGRNI43".getBytes(StandardCharsets.UTF_8);

    private WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(), "Native");
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        pool.shutdownNow();
        super.onDestroy();
    }

    private static String b64(String s) {
        return Base64.encodeToString(s.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private void callJs(final String script) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript(script, null);
            }
        });
    }

    public class Bridge {
        /** headers: "Name: value" lines. bodyB64: request body as base64 (empty for none). Result goes to NativeDone/NativeFail in the page. */
        @JavascriptInterface
        public void http(final String id, final String method, final String url, final String headers, final String bodyB64) {
            pool.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                        c.setInstanceFollowRedirects(false);
                        c.setConnectTimeout(6000);
                        c.setReadTimeout(12000);
                        c.setRequestMethod(method);
                        if (headers != null) {
                            for (String line : headers.split("\n")) {
                                int i = line.indexOf(':');
                                if (i > 0) c.setRequestProperty(line.substring(0, i).trim(), line.substring(i + 1).trim());
                            }
                        }
                        if (bodyB64 != null && bodyB64.length() > 0) {
                            byte[] body = Base64.decode(bodyB64, Base64.DEFAULT);
                            c.setDoOutput(true);
                            c.setFixedLengthStreamingMode(body.length);
                            OutputStream os = c.getOutputStream();
                            os.write(body);
                            os.close();
                        }
                        int status = c.getResponseCode();
                        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        if (in != null) {
                            byte[] buf = new byte[4096];
                            int n;
                            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                            in.close();
                        }
                        String location = c.getHeaderField("Location");
                        StringBuilder cookies = new StringBuilder();
                        for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                            if (e.getKey() != null && e.getKey().equalsIgnoreCase("Set-Cookie")) {
                                for (String v : e.getValue()) cookies.append(v).append("\n");
                            }
                        }
                        c.disconnect();
                        callJs("NativeDone('" + id + "'," + status + ",'" + b64(location == null ? "" : location) + "','"
                                + b64(cookies.toString()) + "','" + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP) + "')");
                    } catch (Exception e) {
                        callJs("NativeFail('" + id + "','" + b64(String.valueOf(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage())) + "')");
                    }
                }
            });
        }

        /** Opens an address in the matching app: web pages, wa.me (WhatsApp) links, or tel: (dialer, no call is placed). */
        @JavascriptInterface
        public boolean openUrl(String url) {
            try {
                if (url == null || !(url.startsWith("http://") || url.startsWith("https://") || url.startsWith("tel:"))) return false;
                Intent i = new Intent(url.startsWith("tel:") ? Intent.ACTION_DIAL : Intent.ACTION_VIEW, Uri.parse(url));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /** Puts plain text on the clipboard. */
        @JavascriptInterface
        public boolean copyText(final String text) {
            try {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("text", text));
                    }
                });
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /** The launcher icon of an installed app as a base64 PNG (taken from the phone itself). Empty string if not installed. */
        @JavascriptInterface
        public String appIcon(String pkg) {
            try {
                Drawable d = getPackageManager().getApplicationIcon(pkg);
                int size = 96;
                Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
                Canvas c = new Canvas(bmp);
                d.setBounds(0, 0, size, size);
                d.draw(c);
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
                return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            } catch (Exception e) {
                return "";
            }
        }

        /** Opens an installed app by package name (only the packages listed in the manifest). False if it is not installed. */
        @JavascriptInterface
        public boolean openApp(String pkg) {
            try {
                Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
                if (i == null) return false;
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String md5(String s) {
            try {
                return hex(MessageDigest.getInstance("MD5").digest(s.getBytes(StandardCharsets.UTF_8)));
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public String sha256(String s) {
            try {
                return hex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
            } catch (Exception e) {
                return "";
            }
        }

        /** enc=true: plain text in, base64 out. enc=false: base64 in, plain text out. Empty string on error. */
        @JavascriptInterface
        public String aes(boolean enc, String text) {
            try {
                Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
                cipher.init(enc ? Cipher.ENCRYPT_MODE : Cipher.DECRYPT_MODE, new SecretKeySpec(AES_KEY, "AES"), new IvParameterSpec(AES_IV));
                if (enc) return Base64.encodeToString(cipher.doFinal(text.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
                return new String(cipher.doFinal(Base64.decode(text.trim(), Base64.DEFAULT)), StandardCharsets.UTF_8);
            } catch (Exception e) {
                return "";
            }
        }
    }
}
