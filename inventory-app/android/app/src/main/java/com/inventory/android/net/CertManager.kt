package com.inventory.android.net

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

object CertManager {
    private const val TAG = "CertManager"
    private const val CERT_NAME = "Inventory Root CA"

    // Unsafe client just to download the cert (chicken & egg)
    private val unsafeClient: OkHttpClient by lazy {
        val trustAllCerts = arrayOf<TrustManager>(object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
            override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        })

        val sslContext = SSLContext.getInstance("SSL")
        sslContext.init(null, trustAllCerts, java.security.SecureRandom())

        OkHttpClient.Builder()
            .sslSocketFactory(sslContext.socketFactory, trustAllCerts[0] as X509TrustManager)
            .hostnameVerifier { _, _ -> true }
            .connectTimeout(10, TimeUnit.SECONDS)
            .build()
    }

    private val systemClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .build()
    }

    suspend fun checkSystemTrust(url: String): Boolean? = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder().url(url).head().build()
            systemClient.newCall(request).execute().close()
            true
        } catch (e: Exception) {
            // If SSL handshake fails, it's not trusted
            if (e is javax.net.ssl.SSLHandshakeException || 
                e is java.security.cert.CertPathValidatorException ||
                e.cause is javax.net.ssl.SSLHandshakeException ||
                e.cause is java.security.cert.CertPathValidatorException) {
                return@withContext false
            }
            // Other connectivity errors (timeout, dns, etc)
            null
        }
    }

    /**
     * Downloads root.crt from the server using the raw IP.
     * Returns the file path or null if failed.
     */
    suspend fun downloadRootCert(context: Context, ip: String, port: Int): File? = withContext(Dispatchers.IO) {
        try {
            val url = "https://$ip:$port/root.crt"
            Log.d(TAG, "Downloading Root CA from $url")
            
            val request = Request.Builder().url(url).build()
            val response = unsafeClient.newCall(request).execute()
            
            if (!response.isSuccessful) {
                Log.e(TAG, "Failed to download cert: ${response.code}")
                return@withContext null
            }

            val bytes = response.body?.bytes()
            if (bytes == null) return@withContext null

            val file = File(context.cacheDir, "root.crt")
            file.writeBytes(bytes)
            Log.d(TAG, "Root CA saved to ${file.absolutePath}")
            return@withContext file
        } catch (e: Exception) {
            Log.e(TAG, "Download exception", e)
            return@withContext null
        }
    }

    suspend fun saveToDownloads(context: Context, ip: String, port: Int): Boolean = withContext(Dispatchers.IO) {
        try {
            val url = "https://$ip:$port/root.crt"
            val request = Request.Builder().url(url).build()
            val response = unsafeClient.newCall(request).execute()
            val bytes = response.body?.bytes() ?: return@withContext false

            val filename = "inventory-root.crt"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val contentValues = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
                    put(MediaStore.MediaColumns.MIME_TYPE, "application/x-x509-ca-cert")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val resolver = context.contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
                if (uri != null) {
                    resolver.openOutputStream(uri)?.use { it.write(bytes) }
                    return@withContext true
                }
            } else {
                val target = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), filename)
                target.writeBytes(bytes)
                return@withContext true
            }
            false
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save to downloads", e)
            false
        }
    }

    /**
     * Creates an intent to install the certificate using FileProvider.
     */
    fun getInstallCertIntent(context: Context, certFile: File): Intent {
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.provider",
            certFile
        )
        val intent = Intent(Intent.ACTION_VIEW)
        intent.setDataAndType(uri, "application/x-x509-ca-cert")
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return intent
    }

    // Deprecated: use getInstallCertIntent and handle result in UI
    fun installRootCert(activity: Activity, certFile: File) {
        val intent = getInstallCertIntent(activity, certFile)
        activity.startActivity(intent)
    }
}
