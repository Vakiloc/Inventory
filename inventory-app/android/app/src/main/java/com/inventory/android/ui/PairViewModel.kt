package com.inventory.android.ui

import android.app.Application
import android.content.Context
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.android.data.PairingManager
import com.inventory.android.data.Prefs
import com.inventory.android.i18n.I18n
import com.inventory.android.i18n.t
import com.inventory.android.net.ApiClient
import com.inventory.android.net.ApiService
import com.inventory.android.net.DiscoveryResolver
import com.inventory.android.net.PairingPayloadDto
import com.inventory.android.security.WebAuthnManager
import com.inventory.android.sync.SyncScheduler
import kotlinx.coroutines.launch
import java.net.URI
import javax.net.ssl.SSLHandshakeException
import java.security.cert.CertPathValidatorException

class PairViewModel(application: Application) : AndroidViewModel(application) {

    val status = mutableStateOf(I18n.t(application, "pair.status.scanQr"))
    val certErrorParams = mutableStateOf<CertErrorParams?>(null)

    // Lazy initialization of PairingManager using Application Context
    private val pairingManager by lazy {
        val context = application.applicationContext
        val prefs = Prefs(context)
        val apiFactory: suspend (String, List<String>?) -> ApiService = { baseUrl, lanIps ->
            ApiClient(
                context = context,
                baseUrlProvider = { baseUrl },
                tokenProvider = { null },
                lanIps = lanIps
            ).createService()
        }
        PairingManager(prefs, WebAuthnManager(context), apiServiceForBaseUrl = apiFactory)
    }

    fun resetCertError() {
        certErrorParams.value = null
    }

    fun pair(activityContext: Context, payload: PairingPayloadDto, onPaired: () -> Unit) {
        val baseUrl = payload.baseUrl.trim()
        val legacyToken = payload.token?.trim()?.takeIf { it.isNotBlank() }
        val code = payload.code?.trim()?.takeIf { it.isNotBlank() }

        if (baseUrl.isBlank() || (legacyToken == null && code == null)) {
            status.value = I18n.t(getApplication(), "pair.status.invalidJson")
            return
        }

        viewModelScope.launch {
            status.value = "Verifying Security..."
            val isTrusted = com.inventory.android.net.CertManager.checkSystemTrust(baseUrl)
            if (isTrusted == false) {
                 status.value = "Security Certificate Validation Failed"
                 try {
                        val uri = URI(baseUrl)
                        val host = uri.host
                        val port = if (uri.port > 0) uri.port else 443
                        val ip = DiscoveryResolver.resolve(getApplication(), host) ?: host

                        certErrorParams.value = CertErrorParams(ip, port)
                        return@launch
                 } catch (ex: Exception) {
                     // fallthrough
                 }
            }

            status.value = I18n.t(getApplication(), "pair.status.pairing")
            val result = pairingManager.pairFromPayload(activityContext, payload)

            result.onSuccess {
                SyncScheduler.schedulePeriodic(getApplication())
                SyncScheduler.enqueueNow(getApplication())
                status.value = I18n.t(getApplication(), "pair.status.paired")
                onPaired()
            }.onFailure { e ->
                // Check for SSL Handshake issues
                val cause = e.cause
                if (e is SSLHandshakeException || cause is SSLHandshakeException ||
                    e is CertPathValidatorException || cause is CertPathValidatorException
                ) {

                    status.value = "Security Certificate Validation Failed"
                    try {
                        val uri = URI(baseUrl)
                        val host = uri.host
                        val port = if (uri.port > 0) uri.port else 443
                        val ip = DiscoveryResolver.resolve(getApplication(), host) ?: host

                        certErrorParams.value = CertErrorParams(ip, port)
                    } catch (ex: Exception) {
                        // fallthrough
                    }
                } else {
                    val isWebAuthnError = e.javaClass.name.contains("androidx.credentials.exceptions") ||
                                          (e.message?.contains("Cancelled by user") == true)
                    
                    if (isWebAuthnError) {
                        status.value = "Pairing Failed: Passkey creation rejected/cancelled.\nNote: Android WebAuthn often requires a valid Public Certificate (System Store). User-installed certificates may be rejected by the system."
                    } else {
                        status.value = I18n.t(
                            getApplication(),
                            "pair.status.pairFailed",
                            mapOf("error" to (e.message ?: e::class.simpleName ?: ""))
                        )
                    }
                }
            }
        }
    }

    fun requestManualCertInstall(payload: PairingPayloadDto) {
        val baseUrl = payload.baseUrl.trim()

        if (baseUrl.isBlank()) {
            status.value = I18n.t(getApplication(), "pair.status.invalidJson")
            return
        }

        viewModelScope.launch {
            status.value = "Resolving Server Address..."
            try {
                val uri = URI(baseUrl)
                val host = uri.host
                val port = if (uri.port > 0) uri.port else 443
                val ip = DiscoveryResolver.resolve(getApplication(), host) ?: host

                certErrorParams.value = CertErrorParams(ip, port)
                status.value = "Please confirm installation."
            } catch (e: Exception) {
                status.value = "Error parsing URL: ${e.message}"
            }
        }
    }
}
