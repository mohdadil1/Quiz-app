import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val siteUrl = (project.findProperty("quizoraUrl") as String?)?.trimEnd('/')
    ?: "https://quiz-app-sigma-lemon-97.vercel.app"

// Release signing: from environment variables (CI secrets) or android/keystore.properties.
// Without them, only the debug APK can be built. See android/README.md.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(env: String, prop: String): String? =
    System.getenv(env)?.takeIf { it.isNotBlank() } ?: keystoreProps.getProperty(prop)
val releaseStoreFile = signingValue("QUIZORA_KEYSTORE_FILE", "storeFile")

android {
    namespace = "com.quizora.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.quizora.app"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("QUIZORA_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("QUIZORA_VERSION_NAME") ?: "1.0"
        buildConfigField("String", "SITE_URL", "\"$siteUrl\"")
    }

    signingConfigs {
        if (releaseStoreFile != null) {
            create("release") {
                storeFile = file(releaseStoreFile)
                storePassword = signingValue("QUIZORA_KEYSTORE_PASSWORD", "storePassword")
                keyAlias = signingValue("QUIZORA_KEY_ALIAS", "keyAlias")
                keyPassword = signingValue("QUIZORA_KEY_PASSWORD", "keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
}
