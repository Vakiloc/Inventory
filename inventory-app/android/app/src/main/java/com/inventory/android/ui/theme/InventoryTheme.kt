package com.inventory.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Aligned to desktop renderer tokens in desktop/src/renderer/styles.css
private val Bg = Color(0xFF0B0F17)
private val Panel = Color(0xFF111827)
private val Muted = Color(0xFF9CA3AF)
private val Text = Color(0xFFE5E7EB)
private val Border = Color(0xFF1F2937)
private val Primary = Color(0xFF2563EB)
private val Danger = Color(0xFFDC2626)

// Success feedback: used for scan validation state.
private val Success = Color(0xFF16A34A)

private val InventoryDarkColorScheme = darkColorScheme(
  primary = Primary,
  onPrimary = Color.White,
  primaryContainer = Color(0xFF1D4ED8),
  onPrimaryContainer = Color(0xFFEFF6FF),

  error = Danger,
  onError = Color.White,
  errorContainer = Color(0xFF7F1D1D),
  onErrorContainer = Color(0xFFFEE2E2),

  background = Bg,
  onBackground = Text,

  surface = Panel,
  onSurface = Text,
  surfaceVariant = Color(0xFF0F172A),
  onSurfaceVariant = Muted,

  outline = Border,
  outlineVariant = Border,

  tertiary = Success,
  onTertiary = Color.White,
  tertiaryContainer = Color(0xFF14532D),
  onTertiaryContainer = Color(0xFFDCFCE7)
)

@Composable
fun InventoryTheme(content: @Composable () -> Unit) {
  MaterialTheme(
    colorScheme = InventoryDarkColorScheme,
    typography = MaterialTheme.typography,
    content = content
  )
}
