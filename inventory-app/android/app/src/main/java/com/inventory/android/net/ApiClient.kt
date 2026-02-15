package com.inventory.android.net

import android.util.Log
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.Dns
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import android.content.Context
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.Locale
import java.util.concurrent.TimeUnit
import com.inventory.android.net.DiscoveryResolver
import java.io.File
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

class ApiClient(
  private val context: Context,
  private val baseUrlProvider: suspend () -> String?,
  private val tokenProvider: suspend () -> String?,
  private val inventoryIdProvider: suspend () -> String? = { null },
  private val localeProvider: suspend () -> String? = { null },
  private val lanIps: List<String>? = null
) {
  private val gson: Gson = GsonBuilder().create()

  private fun isIpAddress(hostname: String): Boolean {
      // Basic IPv4 or IPv6 check
    return hostname.matches(Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")) || hostname.contains(":")
  }

  private fun buildOkHttp(dns: Dns? = null): OkHttpClient {
    val auth = Interceptor { chain ->
      val req = chain.request()
      val token = runCatching { kotlinx.coroutines.runBlocking { tokenProvider() } }.getOrNull()
      val invId = runCatching { kotlinx.coroutines.runBlocking { inventoryIdProvider() } }.getOrNull()
      val loc = runCatching { kotlinx.coroutines.runBlocking { localeProvider() } }.getOrNull()
      val next = if (!token.isNullOrBlank()) {
        req.newBuilder().header("Authorization", "Bearer $token")
      } else {
        req.newBuilder()
      }

      val localeHeader = (loc?.trim()?.takeIf { it.isNotBlank() } ?: Locale.getDefault().language).lowercase()
      next.header("Accept-Language", localeHeader)
      next.header("User-Agent", "InventoryApp/Android")

      if (!invId.isNullOrBlank()) {
        next.header("X-Inventory-Id", invId.trim())
      }

      chain.proceed(next.build())
    }

    val log = HttpLoggingInterceptor { msg ->
      Log.d("Api", msg)
    }.apply {
      level = HttpLoggingInterceptor.Level.BODY
    }

    val builder = OkHttpClient.Builder()
      .addInterceptor(auth)
      .addInterceptor(log)
      .connectTimeout(15, TimeUnit.SECONDS)
      .readTimeout(30, TimeUnit.SECONDS)
      .writeTimeout(30, TimeUnit.SECONDS)

    if (dns != null) {
      builder.dns(dns)
    }

    // Check for cached root CA to fix local dev SSL issues
    val certFile = File(context.cacheDir, "root.crt")
    if (certFile.exists()) {
        val tm = getLocalTrustManager(certFile)
        if (tm != null) {
            try {
                val sslContext = SSLContext.getInstance("TLS")
                sslContext.init(null, arrayOf(tm), java.security.SecureRandom())
                builder.sslSocketFactory(sslContext.socketFactory, tm)
                Log.i("ApiClient", "Applied custom trust manager for cached root.crt")
            } catch (e: Exception) {
                Log.e("ApiClient", "Failed to init SSL context", e)
            }
        }
    }

    return builder.build()
  }

  suspend fun createService(): ApiService {
    val base = baseUrlProvider()?.trim()?.removeSuffix("/")
      ?: throw IllegalStateException("Not paired: baseUrl is missing")
    
    var finalBaseUrl = base
    var dns: Dns? = null

    try {
      val uri = java.net.URI(base)
      val host = uri.host
      
      // Resolve Logic
      val resolvedIp = if (host != null) {
          DiscoveryResolver.resolve(context, host)
      } else null

      if (resolvedIp != null) {
           // Upgrade to sslip.io for WebAuthn + Offline support
           val sslipHost = DiscoveryResolver.getSslipDomain(resolvedIp)

           // If the original was .local or IP, we switch to sslip.io
           // If it was already sslip, we keep it.
           if (host != sslipHost) {
               finalBaseUrl = base.replace(host!!, sslipHost)
               Log.i("ApiClient", "Upgraded Host: $host -> $sslipHost (IP: $resolvedIp)")
           }

           // Force local resolution of sslip.io -> IP (Offline support)
           dns = PreResolvedDns(sslipHost, resolvedIp)
      } else if (!lanIps.isNullOrEmpty() && host != null) {
           // Use LAN IPs from QR payload for DNS pre-resolution.
           // This handles custom hostnames (e.g. duckdns.org) that resolve to
           // a public IP unreachable from the LAN.
           dns = PreResolvedDns(host, lanIps.first())
           Log.i("ApiClient", "Using LAN IP for $host: ${lanIps.first()}")
      } else {
           Log.w("ApiClient", "Could not resolve IP for $host. Proceeding with original URL.")
      }

    } catch (e: Exception) {
      Log.w("ApiClient", "Resolution failed for URL: $base", e)
    }

    val retrofit = Retrofit.Builder()
      .baseUrl(finalBaseUrl + "/")
      .client(buildOkHttp(dns))
      .addConverterFactory(GsonConverterFactory.create(gson))
      .build()

    return retrofit.create(ApiService::class.java)
  }
  
  // Expose check method for UI
  suspend fun checkConnection(): Boolean {
      try {
          createService().ping()
          return true
      } catch (e: Exception) {
          throw e // Propagate for handling
      }
  }

  private fun getLocalTrustManager(certFile: File): X509TrustManager? {
      try {
          // 1. Load Custom Cert
          val cf = CertificateFactory.getInstance("X.509")
          val ca = certFile.inputStream().use { cf.generateCertificate(it) as X509Certificate }

          // 2. Create KeyStore with Custom Cert
          // Use KeyStore.getDefaultType() - usually returns "BKS" on Android
          val keyStoreType = KeyStore.getDefaultType()
          val keyStore = KeyStore.getInstance(keyStoreType)
          keyStore.load(null, null)
          keyStore.setCertificateEntry("custom_root", ca)

          // 3. Init TrustManager with Custom KeyStore
          val customTmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
          customTmf.init(keyStore)
          val customTm = customTmf.trustManagers.firstOrNull { it is X509TrustManager } as? X509TrustManager ?: return null

          // 4. Get System TrustManager
          val sysTmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
          sysTmf.init(null as KeyStore?)
          val sysTm = sysTmf.trustManagers.firstOrNull { it is X509TrustManager } as? X509TrustManager ?: return null

          // 5. Combine
          return object : X509TrustManager {
              override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                  sysTm.checkClientTrusted(chain, authType)
              }

              override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                  try {
                      sysTm.checkServerTrusted(chain, authType)
                  } catch (e: Exception) {
                      customTm.checkServerTrusted(chain, authType)
                  }
              }

              override fun getAcceptedIssuers(): Array<X509Certificate> {
                  return sysTm.acceptedIssuers + customTm.acceptedIssuers
              }
          }
      } catch (e: Exception) {
          Log.e("ApiClient", "Error creating custom trust manager", e)
          return null
      }
  }

  private class PreResolvedDns(
    private val host: String,
    private val ip: String
  ) : Dns {
    override fun lookup(hostname: String): List<InetAddress> {
      if (hostname.equals(host, ignoreCase = true)) {
        try {
          return listOf(InetAddress.getByName(ip))
        } catch (e: UnknownHostException) {
          Log.w("ApiClient", "PreResolvedDns failed to parse IP: $ip", e)
        }
      }
      return Dns.SYSTEM.lookup(hostname)
    }
  }
}
