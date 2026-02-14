package com.inventory.android.net

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.util.Log
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import java.net.InetAddress
import kotlin.coroutines.resume

object DiscoveryResolver {
    private const val TAG = "DiscoveryResolver"
    private const val SERVICE_TYPE = "_http._tcp."

    // sslip.io magic domain helper
    // 192.168.1.5 -> 192-168-1-5.sslip.io
    fun getSslipDomain(ip: String): String {
        return "${ip.replace(".", "-")}.sslip.io"
    }

    suspend fun resolve(context: Context, hostname: String): String? {
        // If it's already an IP, return it
        if (isIpAddress(hostname)) return hostname

        // Handle sslip.io domains by extracting the IP from the subdomain
        // e.g. 192-168-1-13.sslip.io -> 192.168.1.13
        if (hostname.contains("sslip.io", ignoreCase = true)) {
            val ipMatch = Regex("(\\d{1,3})-(\\d{1,3})-(\\d{1,3})-(\\d{1,3})").find(hostname)
            if (ipMatch != null) {
                return ipMatch.value.replace("-", ".")
            }
        }
        
        // If it's a .local name, try mDNS
        if (hostname.endsWith(".local", ignoreCase = true)) {
            Log.d(TAG, "Resolving .local hostname: $hostname")
            // Retry logic
            repeat(3) { attempt -> 
                val result = resolveMdns(context, hostname)
                if (result != null) return result
                Log.d(TAG, "mDNS attempt ${attempt + 1} failed, retrying...")
                kotlinx.coroutines.delay(500)
            }
        }
        
        return null
    }

    private fun isIpAddress(hostname: String): Boolean {
        return try {
            // Basic IPv4 or IPv6 check
            hostname.matches(Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")) || hostname.contains(":")
        } catch (e: Exception) { false }
    }

    private suspend fun resolveMdns(context: Context, hostname: String): String? {
        val targetName = hostname.substringBeforeLast(".local", hostname)
        val expectedServiceName = "inventory-$targetName"
        
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val multicastLock = wifiManager.createMulticastLock("mDNSLock")
        multicastLock.setReferenceCounted(true)
        multicastLock.acquire()

        return try {
             withTimeoutOrNull(3000) { // 3 seconds per attempt
                 suspendCancellableCoroutine { continuation ->
                     val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
                     
                     var discoveryListener: NsdManager.DiscoveryListener? = null
                     
                     discoveryListener = object : NsdManager.DiscoveryListener {
                         override fun onDiscoveryStarted(regType: String) {}

                         override fun onServiceFound(service: NsdServiceInfo) {
                             if (service.serviceType.contains("_http._tcp") && 
                                 service.serviceName.startsWith(expectedServiceName, ignoreCase = true)) {
                                 
                                 nsdManager.resolveService(service, object : NsdManager.ResolveListener {
                                     override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}

                                     override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                                         if (serviceInfo.serviceName.startsWith(expectedServiceName, ignoreCase = true)) {
                                             val host = serviceInfo.host
                                             if (host != null && !host.isLoopbackAddress) {
                                                  if (continuation.isActive) {
                                                      continuation.resume(host.hostAddress)
                                                      discoveryListener?.let { stopDiscoverySafe(nsdManager, it) }
                                                  }
                                             }
                                         }
                                     }
                                 })
                             }
                         }

                         override fun onServiceLost(service: NsdServiceInfo) {}
                         override fun onDiscoveryStopped(serviceType: String) {}
                         override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                             if (continuation.isActive) continuation.resume(null)
                         }
                         override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
                     }
                     
                     nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener!!)
                     
                     continuation.invokeOnCancellation {
                         discoveryListener?.let { stopDiscoverySafe(nsdManager, it) }
                     }
                 }
             }
        } catch (e: Exception) {
            Log.e(TAG, "mDNS error", e)
            null
        } finally {
            if (multicastLock.isHeld) {
                multicastLock.release()
            }
        }
    }

    private fun stopDiscoverySafe(manager: NsdManager, listener: NsdManager.DiscoveryListener) {
        try {
            // Use reflection to call stopDiscovery to avoid unexplained compilation error
            val method = NsdManager::class.java.getMethod("stopDiscovery", NsdManager.DiscoveryListener::class.java)
            method.invoke(manager, listener)
        } catch (e: Exception) {
            // Ignore if already stopped or failed
        }
    }
}
