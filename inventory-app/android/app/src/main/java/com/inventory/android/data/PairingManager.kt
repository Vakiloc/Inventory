package com.inventory.android.data

import android.util.Log
import com.inventory.android.net.ApiClient
import com.inventory.android.net.ApiService
import com.inventory.android.net.PairExchangeRequestDto
import com.inventory.android.net.PairingPayloadDto
import com.inventory.android.net.WebAuthnRegistrationOptionsRequest
import com.inventory.android.net.WebAuthnRegistrationVerifyRequest
import com.inventory.android.net.WebAuthnCancellationRequest
import com.inventory.android.net.WebAuthnUserDto
import com.inventory.android.security.DeviceIdentity
import com.inventory.android.security.WebAuthnManager
import com.google.gson.JsonParser
import com.google.gson.JsonObject
import kotlinx.coroutines.flow.first
import com.google.gson.GsonBuilder
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class PairingManager(
  private val prefs: Prefs,
  private val webAuthnManager: WebAuthnManager,
  private val identityProvider: suspend () -> DeviceIdentity.Identity = { DeviceIdentity().getOrCreate() },
  private val apiServiceForBaseUrl: suspend (String, List<String>?) -> ApiService = { baseUrl, _ ->
    val logging = HttpLoggingInterceptor().apply {
      level = HttpLoggingInterceptor.Level.BASIC
    }
    val client = OkHttpClient.Builder()
      .addInterceptor(logging)
      .build()

    val gson = GsonBuilder().create()

    Retrofit.Builder()
      .baseUrl(baseUrl.trim().removeSuffix("/") + "/")
      .client(client)
      .addConverterFactory(GsonConverterFactory.create(gson))
      .build()
      .create(ApiService::class.java)
  }
) {

  suspend fun pairFromPayload(activityContext: android.content.Context, payload: PairingPayloadDto): Result<Unit> {
    return runCatching {
      val baseUrl = payload.baseUrl.trim()
      val legacyToken = payload.token?.trim()?.takeIf { it.isNotBlank() }
      val code = payload.code?.trim()?.takeIf { it.isNotBlank() }

      Log.d("InvApp", "Starting pairing flow for base url: $baseUrl")
      Log.d("InvApp", "Legacy Token: $legacyToken, Code: $code")

      if (baseUrl.isBlank() || (legacyToken == null && code == null)) {
        throw IllegalArgumentException("invalid_pairing_payload")
      }

      val token = if (legacyToken != null) {
        legacyToken
      } else {
        // WebAuthn Registration Flow
        val api = apiServiceForBaseUrl(baseUrl, payload.ips)
        
        // 1. Get Options
        Log.d("InvApp", "Requesting registration options...")
        val optionsJsonObj = api.registerOptions(WebAuthnRegistrationOptionsRequest(token = code))
        val optionsJson = optionsJsonObj.toString()
        
        Log.d("InvApp", "Received options, invoking WebAuthnManager...")
        
        // 2. Create Passkey
        val credentialJson = try {
          webAuthnManager.createPasskey(activityContext, optionsJson)
            ?: throw Exception("webauthn_cancelled")
        } catch (e: Exception) {
           Log.e("InvApp", "WebAuthn flow failed: ${e.message}", e)
           try {
             if (code != null) {
                api.registerCancel(WebAuthnCancellationRequest(token = code))
             }
           } catch (i: Exception) { /* ignore */ }
           throw e
        }
          
        Log.d("InvApp", "WebAuthn completed, credential JSON length: ${credentialJson.length}")
        val responseJsonObj = JsonParser.parseString(credentialJson).asJsonObject
        
        // 3. Verify
        Log.d("InvApp", "Verifying registration...")
        val verifyRes = api.registerVerify(WebAuthnRegistrationVerifyRequest(
          response = responseJsonObj,
          friendlyName = "Android Device",
          token = code
        ))
        
        if (!verifyRes.verified || verifyRes.token == null) {
          throw Exception("verification_failed")
        }
        
        Log.d("InvApp", "Pairing success!")
        verifyRes.token
      }

      // Only commit paired mode after we have a token.
      prefs.setPairing(baseUrl, token)
      prefs.setAppMode(AppMode.Paired)

      // New pairing should always start clean.
      prefs.resetSyncState()

      // Default inventory selection: keep existing selection (if any).
      // If nothing set, inventory middleware will use desktop's active inventory.
      if (prefs.inventoryIdFlow.first()?.isBlank() == true) {
        prefs.setInventoryId(null)
      }
    }.onFailure { e ->
        Log.e("InvApp", "Pairing failed: ${e.javaClass.simpleName} - ${e.message}")
    }
  }
}
