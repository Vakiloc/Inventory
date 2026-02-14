package com.inventory.android.security

import android.content.Context
import android.util.Log
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.CreateCredentialCancellationException

open class WebAuthnManager(private val context: Context) {
    private val credentialManager = CredentialManager.create(context)

    open suspend fun createPasskey(activityContext: Context, optionsJson: String): String? {
        Log.d("InvApp", "createPasskey called with options: $optionsJson")
        try {
            val request = CreatePublicKeyCredentialRequest(optionsJson)
            val result = credentialManager.createCredential(activityContext, request)
            
            Log.d("InvApp", "createPasskey result: $result")

            val response = result as? CreatePublicKeyCredentialResponse
            return response?.registrationResponseJson
        } catch (e: CreateCredentialCancellationException) {
            Log.w("InvApp", "CreateCredentialCancellationException: ${e.message}")
            throw e
        } catch (e: CreateCredentialException) {
            Log.e("InvApp", "CreateCredentialException: ${e.type} - ${e.message}", e)
            throw e
        } catch (e: Exception) {
            Log.e("InvApp", "Unexpected error during createPasskey: ${e.javaClass.simpleName} - ${e.message}", e)
            throw e
        }
    }

    open suspend fun getPasskey(optionsJson: String): String? {
        Log.d("InvApp", "getPasskey called with options: $optionsJson")
        try {
            val option = GetPublicKeyCredentialOption(optionsJson)
            val request = GetCredentialRequest.Builder()
                .addCredentialOption(option)
                .setPreferImmediatelyAvailableCredentials(false)
                .build()

            val result = credentialManager.getCredential(context, request)
            
            Log.d("InvApp", "getPasskey result: $result")
            
            val cred = result.credential
            if (cred is PublicKeyCredential) {
                return cred.authenticationResponseJson
            }
            return null
        } catch (e: GetCredentialException) {
             Log.e("InvApp", "GetCredentialException: ${e.type} - ${e.message}", e)
             throw e
        } catch (e: Exception) {
            Log.e("InvApp", "Unexpected error during getPasskey: ${e.javaClass.simpleName} - ${e.message}", e)
            throw e
        }
    }
}
