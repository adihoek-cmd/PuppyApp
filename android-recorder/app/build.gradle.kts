plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.adihoek.puppylog.walk"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.adihoek.puppylog.walk"
        minSdk = 26
        targetSdk = 35
        versionCode = 7
        versionName = "2.5"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so it installs straight from Android Studio.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

// No libraries: only the Android framework + Kotlin stdlib (location via LocationManager,
// Firestore and the Strava Worker via plain HTTPS).
