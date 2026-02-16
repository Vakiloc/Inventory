package com.inventory.android

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.google.gson.Gson
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.AppMode
import com.inventory.android.data.InventoryRepository
import com.inventory.android.data.Prefs
import com.inventory.android.i18n.LocalAppLocale
import com.inventory.android.i18n.t
import com.inventory.android.net.ApiClient
import com.inventory.android.sync.SyncScheduler
import com.inventory.android.ui.HomeScreen
import com.inventory.android.ui.ModeScreen
import com.inventory.android.ui.PairScreen
import com.inventory.android.ui.ScanScreen
import com.inventory.android.ui.SettingsScreen
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import java.util.Locale

sealed class BottomTab(val route: String, val icon: ImageVector, val labelKey: String) {
  object Items : BottomTab("items", Icons.Filled.Inventory2, "home.items.title")
  object Scan : BottomTab("scan", Icons.Filled.CameraAlt, "home.scan.title")
  object Settings : BottomTab("settings", Icons.Filled.Settings, "pairing.title")
}

private val bottomTabs = listOf(BottomTab.Items, BottomTab.Scan, BottomTab.Settings)

@Composable
fun InventoryApp() {
  val nav = rememberNavController()
  val context = LocalContext.current

  val prefs = remember { Prefs(context) }
  val db = remember { AppDatabase.get(context) }
  val apiClient = remember {
    ApiClient(
      context = context,
      baseUrlProvider = { prefs.baseUrlFlow.first() },
      tokenProvider = { prefs.tokenFlow.first() },
      inventoryIdProvider = { prefs.inventoryIdFlow.first() },
      localeProvider = { prefs.localeFlow.first() }
    )
  }
  val repo = remember { InventoryRepository(db, prefs, apiClient) }

  val appLocale = prefs.localeFlow.collectAsState(initial = null)
  val localeOverride = appLocale.value?.trim()?.takeIf { it.isNotBlank() }
  val effectiveLocale = localeOverride ?: Locale.getDefault().language.lowercase()

  val startRoute = remember {
    runBlocking {
      computeStartRoute(repo, prefs)
    }
  }

  CompositionLocalProvider(LocalAppLocale provides effectiveLocale) {
    NavHost(navController = nav, startDestination = startRoute) {
      // One-time setup screens (no bottom nav)
      composable("mode") {
        ModeScreen(
          prefs = prefs,
          onGoPair = {
            nav.navigate("pair") {
              popUpTo("mode") { inclusive = true }
            }
          },
          onGoHome = {
            nav.navigate("main") {
              popUpTo("mode") { inclusive = true }
            }
          }
        )
      }

      composable("pair") {
        PairScreen(
          gson = Gson(),
          onPaired = {
            nav.navigate("main") {
              popUpTo("pair") { inclusive = true }
            }
          },
          prefs = prefs
        )
      }

      // Main app with bottom navigation
      composable("main") {
        MainScaffold(repo = repo, prefs = prefs, onGoPair = {
          nav.navigate("pair")
        })

        LaunchedEffect(Unit) {
          if (repo.isPaired()) {
            SyncScheduler.schedulePeriodic(context)
          }
        }

        // If pairing got cleared while app is running, bounce back.
        LaunchedEffect(Unit) {
          prefs.baseUrlFlow
            .combine(prefs.tokenFlow) { baseUrl, token ->
              !baseUrl.isNullOrBlank() && !token.isNullOrBlank()
            }
            .collect { paired ->
              if (!paired) {
                val appMode = AppMode.fromRaw(prefs.appModeFlow.first())
                // In LocalOnly mode, being unpaired is expected; stay on main.
                if (appMode == AppMode.LocalOnly) return@collect

                val dest = if (appMode == AppMode.Paired) "pair" else "mode"
                nav.navigate(dest) {
                  popUpTo("main") { inclusive = true }
                }
              }
            }
        }
      }

      // Keep old "home" route for backward compat — redirect to "main"
      composable("home") {
        LaunchedEffect(Unit) {
          nav.navigate("main") {
            popUpTo("home") { inclusive = true }
          }
        }
      }

      // Keep old "pairing" route for backward compat — redirect to main (settings tab)
      composable("pairing") {
        LaunchedEffect(Unit) {
          nav.navigate("main") {
            popUpTo("pairing") { inclusive = true }
          }
        }
      }
    }
  }
}

@Composable
private fun MainScaffold(
  repo: InventoryRepository,
  prefs: Prefs,
  onGoPair: () -> Unit
) {
  val innerNav = rememberNavController()
  val navBackStackEntry by innerNav.currentBackStackEntryAsState()
  val currentRoute = navBackStackEntry?.destination?.route

  Scaffold(
    bottomBar = {
      NavigationBar {
        bottomTabs.forEach { tab ->
          NavigationBarItem(
            icon = { Icon(tab.icon, contentDescription = t(tab.labelKey)) },
            label = { Text(t(tab.labelKey)) },
            selected = currentRoute == tab.route,
            onClick = {
              if (currentRoute != tab.route) {
                innerNav.navigate(tab.route) {
                  popUpTo(innerNav.graph.startDestinationId) { saveState = true }
                  launchSingleTop = true
                  restoreState = true
                }
              }
            }
          )
        }
      }
    }
  ) { innerPadding ->
    NavHost(
      navController = innerNav,
      startDestination = BottomTab.Items.route,
      modifier = Modifier.padding(innerPadding)
    ) {
      composable(BottomTab.Items.route) {
        HomeScreen(repo = repo, prefs = prefs)
      }
      composable(BottomTab.Scan.route) {
        ScanScreen(repo = repo, prefs = prefs)
      }
      composable(BottomTab.Settings.route) {
        SettingsScreen(repo = repo, prefs = prefs, onGoPair = onGoPair)
      }
    }
  }
}

internal suspend fun computeStartRoute(repo: InventoryRepository, prefs: Prefs): String {
  val mode = AppMode.fromRaw(prefs.appModeFlow.first())
  if (mode == null) {
    // Backwards-compatible: if already paired, treat as paired mode.
    if (repo.isPaired()) {
      prefs.setAppMode(AppMode.Paired)
      return "main"
    }
    return "mode"
  }

  return when (mode) {
    AppMode.LocalOnly -> "main"
    AppMode.Paired -> if (repo.isPaired()) "main" else "pair"
  }
}
