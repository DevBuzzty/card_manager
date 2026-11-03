import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

// Spec 2026-11-03 §8.2 -- Versionsnummer aus Builddatum und Git, damit am Geraet erkennbar ist, welcher Stand laeuft.
// versionCode steigt mit der Build-Uhrzeit (UTC, minutengenau) und haengt NICHT am Git-Zustand: Zweigwechsel, Squash oder
// reset --soft am selben Tag ergeben keine kleinere Nummer (sonst INSTALL_FAILED_VERSION_DOWNGRADE). Ohne git: "nogit".
fun git(vararg a: String): String? = runCatching {
    providers.exec { commandLine("git", *a); isIgnoreExitValue = true }.standardOutput.asText.get().trim().ifEmpty { null }
}.getOrNull()
val buildZeit: LocalDateTime = LocalDateTime.now(ZoneOffset.UTC)
val buildTag: LocalDate = buildZeit.toLocalDate()
val tage = ChronoUnit.DAYS.between(LocalDate.of(2026, 1, 1), buildTag).toInt()
val minuteDesTages = buildZeit.hour * 60 + buildZeit.minute
val gitCount = git("rev-list", "--count", "HEAD")?.toIntOrNull() ?: 0
val gitSha = git("rev-parse", "--short=7", "HEAD") ?: "nogit"
val gitDirty = git("status", "--porcelain", "--untracked-files=no") != null

android {
    namespace = "com.example.yugiohscanner"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.yugiohscanner"
        minSdk = 26
        targetSdk = 34
        versionCode = 1_000 + tage * 1_440 + minuteDesTages     // z. B. 442 412 am 03.11.2026 12:52 UTC, > altes 1; Grenze 2,1e9 erst in ~4000 Jahren
        versionName = "${buildTag.toString().replace("-", ".")}-$gitCount-$gitSha" + if (gitDirty) "+" else ""   // "2026.11.03-1025-d4da262+"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
        buildConfigField("String", "SUPABASE_URL", "\"${localProps.getProperty("supabase.url", "")}\"")
        buildConfigField("String", "SUPABASE_KEY", "\"${localProps.getProperty("supabase.key", "")}\"")
    }

    buildTypes {
        release {
            // Performance: die Release-Variante ist am Geraet ein Vielfaches fluessiger als Debug (Compose).
            // Mit dem Debug-Schluessel signiert, damit assembleRelease direkt eine installierbare APK liefert
            // (persoenliche App, kein Play-Store) und ueber einen Debug-Build derselben Maschine passt.
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    // Performance: installiert die Baseline-Profile der Compose-Bibliotheken auch bei per Kabel/Datei
    // installierten APKs (der Play Store macht das sonst selbst) -- weniger Ruckeln in den ersten Sekunden.
    implementation("androidx.profileinstaller:profileinstaller:1.3.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("androidx.navigation:navigation-compose:2.7.7")
    implementation(platform("androidx.compose:compose-bom:2024.02.02"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")

    // CameraX
    val cameraxVersion = "1.3.1"
    implementation("androidx.camera:camera-core:${cameraxVersion}")
    implementation("androidx.camera:camera-camera2:${cameraxVersion}")
    implementation("androidx.camera:camera-lifecycle:${cameraxVersion}")
    implementation("androidx.camera:camera-view:${cameraxVersion}")

    // ML Kit Text Recognition
    implementation("com.google.android.gms:play-services-mlkit-text-recognition:19.0.0")

    // Socket.io
    implementation("io.socket:socket.io-client:2.1.0")

    // ONNX Runtime (on-device inference: detector + embedder)
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.20.0")

    // Supabase access via plain REST with OkHttp — avoids supabase-kt's Kotlin/Ktor
    // version coupling (the SDK is built against much newer Kotlin than this project uses).
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // Async card images
    implementation("io.coil-kt:coil-compose:2.6.0")

    // Icons
    implementation("androidx.compose.material:material-icons-extended")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    androidTestImplementation(platform("androidx.compose:compose-bom:2024.02.02"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
