package com.inventory.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Aligned to desktop renderer tokens in desktop/src/renderer/styles.css

// Surface
private val Bg = Color(0xFF121210)
private val Panel = Color(0xFF1A1918)
private val SurfaceRaised = Color(0xFF232220)
private val SurfaceOverlay = Color(0xFF2D2B28)
private val Border = Color(0xFF3A3836)

// Text
private val Text = Color(0xFFE8E4DF)
private val TextSecondary = Color(0xFFB8B2AA)
private val Muted = Color(0xFF8C8580)

// Accent
private val Primary = Color(0xFF3D9B8F)
private val PrimaryMuted = Color(0xFF1E3A36)
private val Danger = Color(0xFFD45050)
private val Success = Color(0xFF5CA85C)
private val Warning = Color(0xFFD4A84D)

private val InventoryDarkColorScheme = darkColorScheme(
  primary = Primary,
  onPrimary = Color.White,
  primaryContainer = PrimaryMuted,
  onPrimaryContainer = Color(0xFFB0E8E0),

  error = Danger,
  onError = Color.White,
  errorContainer = Color(0xFF2E1616),
  onErrorContainer = Color(0xFFF5B0B0),

  background = Bg,
  onBackground = Text,

  surface = Panel,
  onSurface = Text,
  surfaceVariant = SurfaceRaised,
  onSurfaceVariant = Muted,

  outline = Border,
  outlineVariant = Border,

  tertiary = Success,
  onTertiary = Color.White,
  tertiaryContainer = Color(0xFF1E2E1E),
  onTertiaryContainer = Color(0xFFB3E5B3),

  secondary = Warning,
  onSecondary = Color.Black,
  secondaryContainer = Color(0xFF2E2816),
  onSecondaryContainer = Color(0xFFF5DFA0)
)

@Composable
fun InventoryTheme(content: @Composable () -> Unit) {
  MaterialTheme(
    colorScheme = InventoryDarkColorScheme,
    typography = MaterialTheme.typography,
    content = content
  )
}
