package com.inventory.android.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import com.google.gson.Gson
import com.inventory.android.i18n.I18n
import com.inventory.android.i18n.t
import com.inventory.android.data.Prefs
import com.inventory.android.net.PairingPayloadDto
import com.inventory.android.net.CertManager
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import androidx.activity.result.contract.ActivityResultContracts
import kotlinx.coroutines.launch
import android.app.Activity
import androidx.lifecycle.viewmodel.compose.viewModel

data class CertErrorParams(val ip: String, val port: Int)

@Composable
fun PairScreen(
  gson: Gson,
  prefs: Prefs,
  onPaired: () -> Unit
) {
  val scope = rememberCoroutineScope()
  val context = LocalContext.current
  val viewModel: PairViewModel = viewModel()
  
  // State from ViewModel
  val status = viewModel.status.value
  val certErrorParams = viewModel.certErrorParams.value
  val manualJson = remember { mutableStateOf("") }
  
  fun applyPayload(raw: String) {
    val contents = raw.trim()
    if (contents.isBlank()) {
      viewModel.status.value = I18n.t(context, "pair.status.pasteFirst")
      return
    }
    try {
      val payload = gson.fromJson(contents, PairingPayloadDto::class.java)
      viewModel.pair(context, payload, onPaired)
    } catch (e: Exception) {
      viewModel.status.value = I18n.t(
        context,
        "pair.status.invalidJsonWithError",
        mapOf("error" to (e.message ?: ""))
      )
    }
  }

  val certLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
     viewModel.status.value = "Certificate installation completed. Please retry pairing."
     viewModel.resetCertError()
  }

  val launcher = rememberLauncherForActivityResult(ScanContract()) { result ->
    val contents = result.contents
    if (contents.isNullOrBlank()) {
      viewModel.status.value = I18n.t(context, "pair.status.scanCancelled")
      return@rememberLauncherForActivityResult
    }

    applyPayload(contents)
  }
  
  // Certificate Trust Dialog
  if (certErrorParams != null) {
      AlertDialog(
          onDismissRequest = { viewModel.resetCertError() },
          title = { Text("Certificate Authority Required") },
          text = { 
              Column {
                Text("To enable secure WebAuthn (Passkeys), you must manually install the server's Certificate Authority.")
                Spacer(Modifier.padding(8.dp))
                Text("WARNING: Installing a CA certificate allows this server to monitor network traffic. Only proceed if you trust this server.")
                Spacer(Modifier.padding(8.dp))
                Text("1. Tap 'Download' below.")
                Text("2. Open Android Settings > Security > Encryption & Credentials > Install a certificate > CA certificate.")
                Text("3. Select 'inventory-root.crt' from Downloads.")
              }
          },
          confirmButton = {
              TextButton(onClick = {
                  val params = certErrorParams 
                  viewModel.resetCertError()
                  
                  scope.launch {
                      viewModel.status.value = "Downloading to Downloads folder..."
                      val success = CertManager.saveToDownloads(context, params.ip, params.port)
                      if (success) {
                          viewModel.status.value = "Saved to Downloads as inventory-root.crt"
                      } else {
                          viewModel.status.value = "Failed to save Certificate."
                      }
                  }
              }) {
                  Text("Download")
              }
          },
          dismissButton = {
              TextButton(onClick = { viewModel.resetCertError() }) {
                  Text("Cancel")
              }
          }
      )
  }

  Column(
    modifier = Modifier.fillMaxSize().padding(24.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally
  ) {
    Text(t("pair.title"), style = MaterialTheme.typography.headlineSmall)
    Spacer(Modifier.padding(8.dp))
    Text(status)
    Spacer(Modifier.padding(16.dp))

    Button(onClick = {
        val opts = ScanOptions()
        .setPrompt(I18n.t(context, "pair.prompt.scanQr"))
        .setBeepEnabled(false)
        .setOrientationLocked(true)
      launcher.launch(opts)
    }) {
      Text(t("pair.button.scanQr"))
    }

    Spacer(Modifier.padding(12.dp))
    Text(t("pair.orPaste"), style = MaterialTheme.typography.titleSmall)
    OutlinedTextField(
      value = manualJson.value,
      onValueChange = { manualJson.value = it },
      modifier = Modifier.fillMaxWidth(),
      label = { Text(t("pair.label.payloadShape")) },
      minLines = 3
    )
    Spacer(Modifier.padding(8.dp))
    Button(onClick = { applyPayload(manualJson.value) }) {
      Text(t("pair.button.usePasted"))
    }

    Spacer(Modifier.padding(8.dp))
    Button(onClick = {
        val raw = manualJson.value.trim()
        if (raw.isBlank()) {
            val opts = ScanOptions()
                .setPrompt(I18n.t(context, "pair.prompt.scanQr"))
                .setBeepEnabled(false)
                .setOrientationLocked(true)
            launcher.launch(opts)
        } else {
            try {
                val payload = gson.fromJson(raw, PairingPayloadDto::class.java)
                viewModel.requestManualCertInstall(payload)
            } catch (e: Exception) {
                viewModel.status.value = I18n.t(
                    context,
                    "pair.status.invalidJsonWithError",
                    mapOf("error" to (e.message ?: ""))
                )
            }
        }
    }) {
        Text("Install CA Certificate")
    }

    Spacer(Modifier.padding(8.dp))
    Text(
      t("pair.hint.offlineInitialSync"),
      style = MaterialTheme.typography.bodySmall
    )
  }
}
