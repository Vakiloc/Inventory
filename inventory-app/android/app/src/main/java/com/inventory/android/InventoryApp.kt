package com.inventory.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.google.gson.Gson
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.AppMode
import com.inventory.android.data.InventoryRepository
import com.inventory.android.data.Prefs
import com.inventory.android.net.ApiClient
import com.inventory.android.ui.HomeScreen
import com.inventory.android.ui.ModeScreen
import com.inventory.android.ui.PairScreen
import com.inventory.android.ui.PairingManagementScreen
import com.inventory.android.sync.SyncScheduler
import com.inventory.android.i18n.LocalAppLocale
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.runBlocking
import java.util.Locale

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
      composable("mode") {
        ModeScreen(
          prefs = prefs,
          onGoPair = {
            nav.navigate("pair") {
              popUpTo("mode") { inclusive = true }
            }
          },
          onGoHome = {
            nav.navigate("home") {
              popUpTo("mode") { inclusive = true }
            }
          }
        )
      }

      composable("pair") {
        PairScreen(
          gson = Gson(),
          onPaired = {
            nav.navigate("home") {
              popUpTo("pair") { inclusive = true }
            }
          },
          prefs = prefs
        )
      }

      composable("home") {
        HomeScreen(
          repo = repo,
          prefs = prefs,
          onGoPair = {
            nav.navigate("pair")
          },
          onGoPairing = {
            nav.navigate("pairing")
          }
        )

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
              // In LocalOnly mode, being unpaired is expected; stay on Home.
              if (appMode == AppMode.LocalOnly) return@collect

              val dest = if (appMode == AppMode.Paired) "pair" else "mode"
              nav.navigate(dest) {
                popUpTo("home") { inclusive = true }
              }
            }
          }
      }
    }

      composable("pairing") {
        PairingManagementScreen(
          repo = repo,
          prefs = prefs,
          onDone = {
          nav.popBackStack()
          }
        )
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
      return "home"
    }
    return "mode"
  }

  return when (mode) {
    AppMode.LocalOnly -> "home"
    AppMode.Paired -> if (repo.isPaired()) "home" else "pair"
  }
}
