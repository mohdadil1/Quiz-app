package com.quizora.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.updatePadding

/**
 * Quizora for Android: the Quizora website in a locked-down window.
 *
 *  - Screenshots, screen recording, the recent-apps preview and assistants that read the
 *    screen (Circle to Search, Gemini "ask about this screen") all see a black screen
 *    (FLAG_SECURE). A website can't do this; an app can.
 *  - While a proctored test runs, the app pins itself (Android screen pinning): the
 *    student can't go Home or switch apps, the system bars are hidden, back does nothing
 *    and the screen stays on.
 *  - The website's own proctoring still runs. The app tells it exactly when the window
 *    loses focus or goes to the background, so warnings are accurate.
 *  - Camera access for webcam proctoring, and file pickers for teacher uploads, work as
 *    in Chrome.
 *
 * Only pages on the Quizora site open inside the app; any other link opens in the browser.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private val siteUri: Uri = Uri.parse(BuildConfig.SITE_URL)

    /** True between the website calling QuizoraApp.startExam() and endExam(). */
    private var examActive = false
    /** Waiting for Android's pinning prompt / toast to finish before telling the page. */
    private var awaitingExamReady = false

    private var pendingCameraRequest: PermissionRequest? = null
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null

    private val cameraPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val request = pendingCameraRequest ?: return@registerForActivityResult
            pendingCameraRequest = null
            if (granted) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
            } else {
                request.deny()
                Toast.makeText(this, R.string.camera_needed, Toast.LENGTH_LONG).show()
            }
        }

    private val filePicker =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            pendingFileCallback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            )
            pendingFileCallback = null
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Block screenshots, recording, recents thumbnails and screen-reading assistants
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.WHITE)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true          // the site keeps the login in localStorage
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = false
                allowContentAccess = false
                setSupportMultipleWindows(false)
                mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                // Lets the website know it's running inside the app
                userAgentString = "$userAgentString QuizoraApp/${BuildConfig.VERSION_NAME}"
            }
            webViewClient = QuizoraWebViewClient()
            webChromeClient = QuizoraChromeClient()
            addJavascriptInterface(ExamBridge(), "QuizoraApp")
        }
        CookieManager.getInstance().setAcceptCookie(true)
        setContentView(webView)

        // Keep the page clear of the status / navigation bars (edge-to-edge on Android 15)
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.updatePadding(top = bars.top, bottom = bars.bottom, left = bars.left, right = bars.right)
            WindowInsetsCompat.CONSUMED
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    examActive -> Toast.makeText(this@MainActivity, R.string.exam_locked, Toast.LENGTH_SHORT).show()
                    webView.canGoBack() -> webView.goBack()
                    else -> finish()
                }
            }
        })

        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        else webView.loadUrl(BuildConfig.SITE_URL)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    // ---------------------------------------------------------------------------------------
    // Tell the website about focus / background changes. In-app browsers don't always fire
    // the page's own blur / visibilitychange events, so the site also reads these flags.
    // ---------------------------------------------------------------------------------------

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        sendToPage(
            if (hasFocus) "window.__quizoraFocus=true;window.dispatchEvent(new Event('focus'));"
            else "window.__quizoraFocus=false;window.dispatchEvent(new Event('blur'));"
        )
        if (hasFocus && examActive) hideSystemBars()
        if (hasFocus && awaitingExamReady) webView.postDelayed({ reportExamReady() }, 300)
    }

    override fun onPause() {
        super.onPause()
        sendToPage("window.__quizoraHidden=true;document.dispatchEvent(new Event('visibilitychange'));")
        CookieManager.getInstance().flush()
    }

    override fun onResume() {
        super.onResume()
        sendToPage("window.__quizoraHidden=false;document.dispatchEvent(new Event('visibilitychange'));")
        // Unpinned during a test (e.g. holding Back + Overview): pin again
        if (examActive && !isLockTaskActive()) startPinning()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private fun sendToPage(script: String) {
        if (::webView.isInitialized) webView.evaluateJavascript(script, null)
    }

    // ---------------------------------------------------------------------------------------
    // Exam lock-down, switched on and off by the website
    // ---------------------------------------------------------------------------------------

    /** Methods the website can call as window.QuizoraApp.*. Only Quizora pages load here. */
    inner class ExamBridge {
        @JavascriptInterface
        fun startExam() = runOnUiThread {
            if (!isOnSite(webView.url)) return@runOnUiThread
            examActive = true
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            hideSystemBars()
            awaitingExamReady = true
            startPinning()
            // Pinning may show a confirmation that takes focus; report once we have it back
            webView.postDelayed({ if (hasWindowFocus()) reportExamReady() }, 700)
        }

        @JavascriptInterface
        fun endExam() = runOnUiThread {
            if (!examActive) return@runOnUiThread
            examActive = false
            awaitingExamReady = false
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            showSystemBars()
            if (isLockTaskActive()) {
                try { stopLockTask() } catch (_: Exception) { /* not pinned by us */ }
            }
        }

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME
    }

    /**
     * Tells the page the lock-down has settled: it starts watching for focus loss only now,
     * so Android's own pinning prompt doesn't count as a warning.
     */
    private fun reportExamReady() {
        if (!awaitingExamReady || !examActive) return
        awaitingExamReady = false
        val pinned = isLockTaskActive()
        sendToPage("window.dispatchEvent(new CustomEvent('quizora-exam-ready',{detail:{pinned:$pinned}}));")
    }

    private fun startPinning() {
        // Without device-owner setup Android uses screen pinning, which may ask the student
        // to confirm. If pinning isn't allowed, the website's warnings still apply.
        try { startLockTask() } catch (_: Exception) { }
    }

    private fun isLockTaskActive(): Boolean {
        val am = getSystemService(ActivityManager::class.java) ?: return false
        return am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
    }

    private fun hideSystemBars() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun showSystemBars() {
        WindowInsetsControllerCompat(window, window.decorView).show(WindowInsetsCompat.Type.systemBars())
    }

    // ---------------------------------------------------------------------------------------
    // Browser behaviour
    // ---------------------------------------------------------------------------------------

    private fun isOnSite(url: String?): Boolean {
        val uri = url?.let(Uri::parse) ?: return false
        return uri.scheme == "https" && uri.host.equals(siteUri.host, ignoreCase = true)
    }

    private inner class QuizoraWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            if (isOnSite(url)) return false
            // Never leave the app in the middle of a test
            if (!examActive) {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (_: ActivityNotFoundException) { }
            }
            return true
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showOfflinePage(request.url.toString())
        }
    }

    private inner class QuizoraChromeClient : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
            val wantsCamera = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
            if (!wantsCamera || !isOnSite(request.origin.toString())) {
                request.deny()
                return
            }
            if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
            ) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
            } else {
                pendingCameraRequest?.deny()
                pendingCameraRequest = request
                cameraPermission.launch(Manifest.permission.CAMERA)
            }
        }

        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams
        ): Boolean {
            pendingFileCallback?.onReceiveValue(null)
            pendingFileCallback = filePathCallback
            return try {
                filePicker.launch(fileChooserParams.createIntent())
                true
            } catch (_: ActivityNotFoundException) {
                pendingFileCallback = null
                false
            }
        }
    }

    private fun showOfflinePage(failedUrl: String) {
        val retryUrl = if (isOnSite(failedUrl)) failedUrl else BuildConfig.SITE_URL
        val safeUrl = retryUrl.replace("\\", "\\\\").replace("'", "\\'")
        val html = """
            <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;
            justify-content:center;height:90vh;margin:0;padding:24px;text-align:center;color:#333}
            h2{color:#F96332}button{margin-top:16px;padding:12px 28px;border:0;border-radius:8px;
            background:#F96332;color:#fff;font-size:16px}</style></head><body>
            <h2>No internet connection</h2>
            <p>Quizora couldn't reach the server. Check your Wi-Fi or mobile data and try again.</p>
            <button onclick="location.href='$safeUrl'">Try again</button></body></html>
        """.trimIndent()
        webView.loadDataWithBaseURL(BuildConfig.SITE_URL, html, "text/html", "utf-8", retryUrl)
    }
}
