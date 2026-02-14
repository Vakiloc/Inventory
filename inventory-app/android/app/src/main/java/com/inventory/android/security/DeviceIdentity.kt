package com.inventory.android.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.spec.ECGenParameterSpec

class DeviceIdentity(private val alias: String = "inventory_device_key") {
  fun getOrCreate(): Identity {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = ks.getEntry(alias, null) as? KeyStore.PrivateKeyEntry
    val pair = if (existing != null) {
      KeyPair(existing.certificate.publicKey, existing.privateKey)
    } else {
      generateEcKeypair()
    }

    val pubBytes = pair.public.encoded
    val pubBase64 = Base64.encodeToString(pubBytes, Base64.NO_WRAP)
    val deviceId = sha256Hex(pubBase64)

    return Identity(deviceId = deviceId, publicKeyBase64 = pubBase64)
  }

  private fun generateEcKeypair(): KeyPair {
    val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    val spec = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
    )
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA512)
      .build()

    gen.initialize(spec)
    return gen.generateKeyPair()
  }

  private fun sha256Hex(s: String): String {
    val d = MessageDigest.getInstance("SHA-256")
    val bytes = d.digest(s.toByteArray(Charsets.UTF_8))
    return bytes.joinToString("") { "%02x".format(it) }
  }

  data class Identity(
    val deviceId: String,
    val publicKeyBase64: String
  )
}
