import AutomaticAssessmentConfiguration
import UIKit
import WebKit

/// Quizora for iOS: the Quizora website in a locked-down window. The iOS counterpart of
/// android/app/src/main/java/com/quizora/app/MainActivity.kt.
///
///  - The website sits in a capture-protected view (CaptureShield): screenshots, screen
///    recordings, mirroring and the app-switcher preview show a blank area.
///  - A screenshot or screen recording during a test is also reported to the website as a
///    warning ("quizora-screen-capture" event). While recording or mirroring is on, the
///    question is covered.
///  - While a proctored test runs the status bar and home indicator are hidden, the screen
///    stays on and back-swipes are off. With Apple's assessment-mode entitlement (see
///    ios/README.md) the app also enters Automatic Assessment Configuration: other apps,
///    Siri, notifications and screenshots are blocked until the test ends.
///  - The website's own proctoring still runs. The app tells it exactly when the window
///    loses focus or goes to the background, so warnings are accurate.
///
/// Only pages on the Quizora site open inside the app; any other link opens in Safari.
final class WebViewController: UIViewController {

    private let siteURL: URL = {
        let raw = Bundle.main.object(forInfoDictionaryKey: "QuizoraSiteURL") as? String
        return URL(string: raw ?? "") ?? URL(string: "https://quiz-app-sigma-lemon-97.vercel.app")!
    }()

    private let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    /// Set by the QUIZORA_ASSESSMENT_MODE build setting once Apple has granted the entitlement
    private let assessmentModeAvailable =
        (Bundle.main.object(forInfoDictionaryKey: "QuizoraAssessmentMode") as? String)?.uppercased() == "YES"

    private var webView: WKWebView!
    private let shield = CaptureShield.makeContainer()
    /// Blank cover for the app switcher and for screen recording / mirroring.
    private let cover = CoverView()

    /// True between the website calling QuizoraApp.startExam() and endExam().
    private var examActive = false {
        didSet {
            setNeedsStatusBarAppearanceUpdate()
            setNeedsUpdateOfHomeIndicatorAutoHidden()
            setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
            UIApplication.shared.isIdleTimerDisabled = examActive
            webView?.allowsBackForwardNavigationGestures = !examActive
        }
    }
    /// Waiting for assessment mode to settle before telling the page the test can start.
    private var awaitingExamReady = false
    private var assessmentSession: AEAssessmentSession?
    private var assessmentActive = false
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]

    // MARK: - Set-up

    override func loadView() {
        let root = UIView()
        root.backgroundColor = .white
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true                 // webcam preview inside the page
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "QuizoraApp/\(version)"   // lets the site know it's in the app
        config.websiteDataStore = .default()                    // keeps the login in localStorage
        let controller = config.userContentController
        controller.add(WeakMessageHandler(self), name: "quizora")
        controller.addUserScript(WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .white
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        // The website goes inside the capture shield, which fills the safe area
        view.addSubview(shield)
        shield.translatesAutoresizingMaskIntoConstraints = false
        webView.translatesAutoresizingMaskIntoConstraints = false
        shield.addSubview(webView)
        NSLayoutConstraint.activate([
            shield.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            shield.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            shield.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            shield.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            webView.topAnchor.constraint(equalTo: shield.topAnchor),
            webView.bottomAnchor.constraint(equalTo: shield.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: shield.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: shield.trailingAnchor)
        ])

        cover.frame = view.bounds
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.isHidden = true
        view.addSubview(cover)

        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
        center.addObserver(self, selector: #selector(didTakeScreenshot), name: UIApplication.userDidTakeScreenshotNotification, object: nil)
        center.addObserver(self, selector: #selector(captureChanged), name: UIScreen.capturedDidChangeNotification, object: nil)

        webView.load(URLRequest(url: siteURL))
        updateRecordingCover()
    }

    override var prefersStatusBarHidden: Bool { examActive }
    override var prefersHomeIndicatorAutoHidden: Bool { examActive }
    // During a test the first swipe from an edge only shows the indicator; a second is needed
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { examActive ? .all : [] }

    /// `window.QuizoraApp`, the same interface the Android app offers (client/src/nativeApp.js).
    private var bridgeScript: String {
        """
        (function () {
          if (window.QuizoraApp) return;
          var post = function (m) { try { window.webkit.messageHandlers.quizora.postMessage(m); } catch (e) {} };
          window.QuizoraApp = Object.freeze({
            platform: 'ios',
            startExam: function () { post('startExam'); },
            endExam: function () { post('endExam'); },
            version: function () { return '\(version)'; },
            captureProtected: function () { return \(CaptureShield.isProtected(shield)); }
          });
        })();
        """
    }

    private func sendToPage(_ script: String) {
        webView?.evaluateJavaScript(script, completionHandler: nil)
    }

    // MARK: - Focus and background, reported to the page

    @objc private func willResignActive() {
        sendToPage("window.__quizoraFocus=false;window.dispatchEvent(new Event('blur'));")
        cover.show(message: nil)   // blank app-switcher preview
    }

    @objc private func didBecomeActive() {
        updateRecordingCover()
        sendToPage("window.__quizoraFocus=true;window.dispatchEvent(new Event('focus'));")
        if awaitingExamReady {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.reportExamReady() }
        }
    }

    @objc private func didEnterBackground() {
        sendToPage("window.__quizoraHidden=true;document.dispatchEvent(new Event('visibilitychange'));")
    }

    @objc private func willEnterForeground() {
        sendToPage("window.__quizoraHidden=false;document.dispatchEvent(new Event('visibilitychange'));")
    }

    // MARK: - Screenshots and screen recording

    @objc private func didTakeScreenshot() {
        reportCapture(kind: "screenshot")
    }

    @objc private func captureChanged() {
        updateRecordingCover()
        if UIScreen.main.isCaptured { reportCapture(kind: "recording") }
    }

    private func reportCapture(kind: String) {
        sendToPage("window.dispatchEvent(new CustomEvent('quizora-screen-capture',{detail:{kind:'\(kind)'}}));")
    }

    /// Cover the page while the screen is being recorded or mirrored.
    private func updateRecordingCover() {
        if UIScreen.main.isCaptured {
            cover.show(message: "Screen recording or mirroring is on.\nTurn it off in Control Centre to continue.")
        } else if UIApplication.shared.applicationState == .active || cover.message != nil {
            cover.hide()
        }
    }

    // MARK: - Exam lock-down, switched on and off by the website

    private func startExam() {
        guard isOnSite(webView.url) else { return }
        examActive = true
        awaitingExamReady = true
        if UIScreen.main.isCaptured { reportCapture(kind: "recording") }

        if assessmentModeAvailable, assessmentSession == nil {
            let session = AEAssessmentSession(configuration: AEAssessmentConfiguration())
            session.delegate = self
            assessmentSession = session
            session.begin()   // iOS shows a short transition; reportExamReady() follows
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.reportExamReady() }
        }
    }

    private func endExam() {
        guard examActive else { return }
        examActive = false
        awaitingExamReady = false
        if let session = assessmentSession, session.isActive { session.end() }
        assessmentSession = nil
        assessmentActive = false
    }

    /// Tells the page the lock-down has settled: it starts watching for focus loss only now,
    /// so the assessment-mode transition doesn't count as a warning.
    private func reportExamReady() {
        guard awaitingExamReady, examActive, UIApplication.shared.applicationState == .active else { return }
        awaitingExamReady = false
        sendToPage("window.dispatchEvent(new CustomEvent('quizora-exam-ready',{detail:{pinned:\(assessmentActive)}}));")
    }

    // MARK: - Helpers

    private func isOnSite(_ url: URL?) -> Bool {
        guard let url, url.scheme == "https", let host = url.host else { return false }
        return host.caseInsensitiveCompare(siteURL.host ?? "") == .orderedSame
    }

    private func openOutside(_ url: URL) {
        guard !examActive, let scheme = url.scheme?.lowercased(),
              ["http", "https", "mailto", "tel"].contains(scheme) else { return }
        UIApplication.shared.open(url)
    }

    private func showOfflinePage(failedURL: URL?) {
        let retry: URL
        if let failedURL, isOnSite(failedURL) { retry = failedURL } else { retry = siteURL }
        let safe = retry.absoluteString.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
        let html = """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;
        justify-content:center;height:90vh;margin:0;padding:24px;text-align:center;color:#333}
        h2{color:#F96332}button{margin-top:16px;padding:12px 28px;border:0;border-radius:8px;
        background:#F96332;color:#fff;font-size:16px}</style></head><body>
        <h2>No internet connection</h2>
        <p>Quizora couldn't reach the server. Check your Wi-Fi or mobile data and try again.</p>
        <button onclick="location.href='\(safe)'">Try again</button></body></html>
        """
        webView.loadHTMLString(html, baseURL: siteURL)
    }

    private func share(fileAt url: URL) {
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
        present(sheet, animated: true)
    }
}

// MARK: - Messages from the page

extension WebViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // Only Quizora pages may lock the app
        guard message.frameInfo.isMainFrame, isOnSite(message.frameInfo.request.url ?? webView.url),
              let command = message.body as? String else { return }
        switch command {
        case "startExam": startExam()
        case "endExam": endExam()
        default: break
        }
    }
}

// MARK: - Assessment mode

extension WebViewController: AEAssessmentSessionDelegate {
    func assessmentSessionDidBegin(_ session: AEAssessmentSession) {
        assessmentActive = true
        if UIApplication.shared.applicationState == .active {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.reportExamReady() }
        }
    }

    func assessmentSession(_ session: AEAssessmentSession, failedToBeginWithError error: Error) {
        // Not allowed on this device or build: the website's own warnings still apply
        assessmentActive = false
        assessmentSession = nil
        reportExamReady()
    }

    func assessmentSession(_ session: AEAssessmentSession, wasInterruptedWithError error: Error) {
        assessmentActive = false
        assessmentSession = nil
        if examActive {
            sendToPage("window.__quizoraFocus=false;window.dispatchEvent(new Event('blur'));")
        }
    }

    func assessmentSessionDidEnd(_ session: AEAssessmentSession) {
        assessmentActive = false
    }
}

// MARK: - Browser behaviour

extension WebViewController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        if navigationAction.shouldPerformDownload { return decisionHandler(.download) }
        // Embedded frames (e.g. videos in a question) load as in a browser
        if let target = navigationAction.targetFrame, !target.isMainFrame { return decisionHandler(.allow) }
        let scheme = url.scheme?.lowercased() ?? ""
        if isOnSite(url) || ["about", "blob", "data"].contains(scheme) { return decisionHandler(.allow) }
        decisionHandler(.cancel)
        openOutside(url)   // never during a test
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleLoadError(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadError(error)
    }

    private func handleLoadError(_ error: Error) {
        let nsError = error as NSError
        // Cancelled loads and ones we turned into downloads or Safari links aren't failures
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain", nsError.code == 102 { return }
        let failed = nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL
        #if DEBUG
        NSLog("QuizoraSmoke failed %@", nsError.localizedDescription)
        #endif
        showOfflinePage(failedURL: failed)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        #if DEBUG
        // Read by .github/scripts/ios-smoke-test.sh
        NSLog("QuizoraSmoke loaded %@ title=%@ shield=%@", webView.url?.absoluteString ?? "-",
              webView.title ?? "-", CaptureShield.isProtected(shield) ? "on" : "off")
        #endif
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}

extension WebViewController: WKDownloadDelegate {
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let destination = folder.appendingPathComponent(suggestedFilename.isEmpty ? "download" : suggestedFilename)
        downloadDestinations[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        share(fileAt: url)   // Save to Files, AirDrop, mail…
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
    }
}

extension WebViewController: WKUIDelegate {
    /// Links with target="_blank": Quizora pages open here, anything else in Safari.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isOnSite(url) { webView.load(navigationAction.request) } else { openOutside(url) }
        }
        return nil
    }

    /// Camera for webcam proctoring, for Quizora pages only. iOS asks the student once.
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        let onSite = origin.protocol == "https" && origin.host.caseInsensitiveCompare(siteURL.host ?? "") == .orderedSame
        decisionHandler(onSite && type == .camera ? .grant : .deny)
    }

    // alert(), confirm() and prompt() need native dialogs in a WKWebView

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        presentDialog(alert) { completionHandler() }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        presentDialog(alert) { completionHandler(false) }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text)
        })
        presentDialog(alert) { completionHandler(nil) }
    }

    /// Presents a page dialog, or answers it straight away if another one is on screen.
    private func presentDialog(_ alert: UIAlertController, otherwise fallback: @escaping () -> Void) {
        guard presentedViewController == nil, viewIfLoaded?.window != nil else { return fallback() }
        present(alert, animated: true)
    }
}

// MARK: - Small helpers

/// WKUserContentController keeps its handlers alive; this avoids a retain cycle.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

/// Plain cover with an optional message.
private final class CoverView: UIView {
    private let label = UILabel()
    private(set) var message: String?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .white
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = UIColor(red: 0.2, green: 0.2, blue: 0.2, alpha: 1)
        label.font = .preferredFont(forTextStyle: .headline)
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        NSLayoutConstraint.activate([
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 32),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -32)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(message: String?) {
        // A recording message stays until recording stops
        if self.message != nil, message == nil { return }
        self.message = message
        label.text = message
        isHidden = false
        superview?.bringSubviewToFront(self)
    }

    func hide() {
        message = nil
        isHidden = true
    }
}
