plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}


// MOBILE-REL-01: release signing comes from keystore.properties (written by CI from GitHub Secrets) or the
// EDMN_* environment variables. The release build FAILS when no release keystore is configured: a release
// artifact is never signed with the debug key. Setup steps: docs/mobile/ANDROID_PLAY.md.
val relPropsFile = rootProject.file("keystore.properties")
val relProps = java.util.Properties()
if (relPropsFile.exists()) relPropsFile.inputStream().use { relProps.load(it) }

android {
    namespace = "com.edmneg.edmn_customer"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.edmneg.edmn_customer"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            keyAlias = relProps.getProperty("keyAlias") ?: System.getenv("EDMN_KEY_ALIAS")
            keyPassword = relProps.getProperty("keyPassword") ?: System.getenv("EDMN_KEY_PASSWORD")
            storeFile = (relProps.getProperty("storeFile") ?: System.getenv("EDMN_KEYSTORE_FILE"))?.let { file(it) }
            storePassword = relProps.getProperty("storePassword") ?: System.getenv("EDMN_KEYSTORE_PASSWORD")
        }
    }
    buildTypes {
        release {
            // MOBILE-REL-01: never the debug key. A release build without the release keystore fails loudly.
            check(signingConfigs.getByName("release").storeFile?.exists() == true) {
                "Release keystore not configured. Create keystore.properties per docs/mobile/ANDROID_PLAY.md " +
                    "or build via .github/workflows/android-play.yml. Debug keys are never used for release."
            }
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
