import UIKit

/// A view whose contents iOS leaves out of screenshots, screen recordings, AirPlay
/// mirroring and the app-switcher preview: they show a blank area instead.
///
/// iOS has no public switch for this (Android's FLAG_SECURE), but it already hides the
/// text of password fields from captures. The view a secure UITextField draws its text into
/// keeps that protection for anything placed inside it, so the app puts the website there.
/// If a future iOS changes the text field's internals, `makeSecureContainer()` returns nil
/// and the app falls back to an ordinary view (the screenshot/recording warnings still work).
enum CaptureShield {
    static func makeContainer() -> UIView {
        let enabled = Bundle.main.object(forInfoDictionaryKey: "QuizoraBlockScreenCapture") as? Bool ?? true
        if enabled, let secure = makeSecureContainer() {
            return secure
        }
        return UIView()
    }

    /// True when the website is inside a capture-protected container.
    static func isProtected(_ view: UIView) -> Bool {
        String(describing: type(of: view)).contains("Canvas")
    }

    private static func makeSecureContainer() -> UIView? {
        let field = UITextField()
        field.isSecureTextEntry = true
        guard let canvas = field.subviews.first(where: {
            String(describing: type(of: $0)).contains("Canvas")
        }) else { return nil }
        canvas.subviews.forEach { $0.removeFromSuperview() }
        canvas.removeFromSuperview()
        canvas.isUserInteractionEnabled = true
        canvas.backgroundColor = .white
        canvas.translatesAutoresizingMaskIntoConstraints = false
        return canvas
    }
}
