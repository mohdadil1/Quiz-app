# The website calls these through window.QuizoraApp — keep their names
-keepclassmembers class com.quizora.app.MainActivity$ExamBridge {
    @android.webkit.JavascriptInterface <methods>;
}
