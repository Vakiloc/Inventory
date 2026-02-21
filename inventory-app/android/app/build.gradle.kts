plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("com.google.devtools.ksp")
}

import org.gradle.api.tasks.Copy

android {
  namespace = "com.inventory.android"
  compileSdk = 34

  val envVersionCode = System.getenv("VERSION_CODE")?.toIntOrNull()
  val envVersionName = System.getenv("VERSION_NAME")

  val keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
  val keystorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
  val keyAlias = System.getenv("ANDROID_KEY_ALIAS")
  val keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
  val hasSigning = !keystorePath.isNullOrBlank() &&
    !keystorePassword.isNullOrBlank() &&
    !keyAlias.isNullOrBlank() &&
    !keyPassword.isNullOrBlank()

  val releaseSigning = signingConfigs.maybeCreate("release").apply {
    if (hasSigning) {
      storeFile = file(keystorePath!!)
      storePassword = keystorePassword
      this.keyAlias = keyAlias
      this.keyPassword = keyPassword
    }
  }

  defaultConfig {
    applicationId = "com.inventory.android"
    minSdk = 26
    targetSdk = 34
    versionCode = envVersionCode ?: 1
    versionName = envVersionName ?: "0.1.0"

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro"
      )

      if (hasSigning) {
        signingConfig = releaseSigning
      }
    }
  }

  buildFeatures {
    compose = true
  }

  composeOptions {
    kotlinCompilerExtensionVersion = "1.5.8"
  }

  packaging {
    resources {
      excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
  }

  kotlinOptions {
    jvmTarget = "11"
  }

  // Ensure javac target matches Kotlin/KSP (avoids JVM target validation errors)
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
  }
}

tasks.register<Copy>("copyReleaseApk") {
  dependsOn("assembleRelease")
  from(layout.buildDirectory.dir("outputs/apk/release"))
  include("*.apk")
  into(layout.projectDirectory.dir("artifacts"))
  rename { "app-release.apk" }
}

dependencies {
  val composeBom = platform("androidx.compose:compose-bom:2024.02.00")
  implementation(composeBom)
  androidTestImplementation(composeBom)

  implementation("androidx.core:core-ktx:1.12.0")
  implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
  implementation("androidx.activity:activity-compose:1.8.2")
  implementation("org.slf4j:slf4j-android:1.7.36")

  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-tooling-preview")
  debugImplementation("androidx.compose.ui:ui-tooling")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.material:material-icons-extended")
  implementation("androidx.navigation:navigation-compose:2.7.7")

  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

  // Local storage
  implementation("androidx.datastore:datastore-preferences:1.0.0")

  // Background sync
  implementation("androidx.work:work-runtime-ktx:2.9.0")

  // Room
  implementation("androidx.room:room-runtime:2.6.1")
  implementation("androidx.room:room-ktx:2.6.1")
  ksp("androidx.room:room-compiler:2.6.1")

  // Networking
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
  implementation("com.squareup.retrofit2:retrofit:2.11.0")
  implementation("com.squareup.retrofit2:converter-gson:2.11.0")

  // WebAuthn / Passkeys
  implementation("androidx.credentials:credentials:1.2.2")
  implementation("androidx.credentials:credentials-play-services-auth:1.2.2")

  // QR/Barcode scanning
  implementation("com.journeyapps:zxing-android-embedded:4.3.0")
  implementation("com.google.zxing:core:3.5.4")

  testImplementation("junit:junit:4.13.2")

  androidTestImplementation("androidx.test.ext:junit:1.2.1")
  androidTestImplementation("androidx.test:runner:1.6.2")
  androidTestImplementation("androidx.test:rules:1.6.1")
  androidTestImplementation("androidx.work:work-testing:2.9.0")

  androidTestImplementation("org.mockito:mockito-android:5.10.0")
  androidTestImplementation("org.mockito.kotlin:mockito-kotlin:5.2.1")
}
