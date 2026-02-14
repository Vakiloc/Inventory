pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    mavenCentral()
  }
}

rootProject.name = "InventoryAndroid"
include(":app")

// Windows + OneDrive can hold file locks under the project directory (app/build/...),
// causing Gradle tasks to fail with "Unable to delete directory".
// Put build outputs in the OS temp directory instead.
// COMMENTED OUT TO FIX KSP ERROR: "this and base files have different roots"
// gradle.beforeProject {
//   val tmp = System.getProperty("java.io.tmpdir") ?: "."
//   val safePath = project.path.trim(':').replace(':', '_').ifBlank { "root" }
//   project.buildDir = file("$tmp/inventory-android-build/$safePath")
// }
