package com.inventory.android.data

enum class AppMode(val raw: String) {
  Paired("paired"),
  LocalOnly("local_only");

  companion object {
    fun fromRaw(raw: String?): AppMode? {
      return when (raw) {
        Paired.raw -> Paired
        LocalOnly.raw -> LocalOnly
        else -> null
      }
    }
  }
}
