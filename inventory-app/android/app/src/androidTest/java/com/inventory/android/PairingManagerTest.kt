package com.inventory.android

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.PairingManager
import com.inventory.android.data.InventoryRepository
import com.inventory.android.data.Prefs
import com.inventory.android.security.WebAuthnManager
import com.inventory.android.security.DeviceIdentity
import com.inventory.android.net.*
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever
import org.mockito.kotlin.any
import org.mockito.kotlin.eq
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PairingManagerTest {
  private lateinit var prefs: Prefs
  private lateinit var db: AppDatabase
  private lateinit var mockWebAuthn: WebAuthnManager

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    prefs = Prefs(context)
    runBlocking { prefs.clearAll() }

    db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
      .allowMainThreadQueries()
      .build()
      
    // Mock the open WebAuthnManager class
    mockWebAuthn = mock()
  }

  @Test
  fun pairFromPayload_webAuthnSuccess_setsPairing() = runBlocking {
    val fakeToken = "d1.cred.mac"
    val fakeOptions = "{\"challenge\":\"123\"}"
    val fakeAttestation = "{\"id\":\"cred1\",\"response\":{}}"
    
    // Stub WebAuthn success
    whenever(mockWebAuthn.createPasskey(any(), eq(fakeOptions))).thenReturn(fakeAttestation)
    
    val mgr = PairingManager(
      prefs = prefs,
      webAuthnManager = mockWebAuthn,
      identityProvider = { DeviceIdentity.Identity(deviceId = "dev", publicKeyBase64 = "pk") },
      apiServiceForBaseUrl = { _, _ ->
        object : ApiService {
           // Mock registration flow
           override suspend fun registerOptions(req: WebAuthnRegistrationOptionsRequest): com.google.gson.JsonObject {
             return com.google.gson.JsonParser.parseString(fakeOptions).asJsonObject
           }
           override suspend fun registerVerify(req: WebAuthnRegistrationVerifyRequest): WebAuthnVerifyResponse {
             return WebAuthnVerifyResponse(verified = true, token = fakeToken)
           }
           override suspend fun registerCancel(req: WebAuthnCancellationRequest): com.google.gson.JsonObject {
             return com.google.gson.JsonObject()
           }
           
           // Unused stubs
           override suspend fun authOptions(req: Map<String, String>) = throw UnsupportedOperationException()
           override suspend fun authVerify(req: WebAuthnAuthenticationVerifyRequest) = throw UnsupportedOperationException()

           override suspend fun exchangePairing(req: PairExchangeRequestDto) = throw UnsupportedOperationException()
           override suspend fun ping() = throw UnsupportedOperationException()
           override suspend fun meta() = throw UnsupportedOperationException()
           override suspend fun listInventories() = throw UnsupportedOperationException()
           override suspend fun exportSnapshot() = throw UnsupportedOperationException()
           override suspend fun importSnapshot(req: ExportSnapshotDto) = throw UnsupportedOperationException()
           override suspend fun listItems(since: Long, includeDeleted: Int) = throw UnsupportedOperationException()
           override suspend fun createItem(req: ItemUpsertRequestDto) = throw UnsupportedOperationException()
           override suspend fun updateItem(id: Int, req: ItemUpsertRequestDto) = throw UnsupportedOperationException()
           override suspend fun listItemBarcodesSince(since: Long) = throw UnsupportedOperationException()
           override suspend fun listCategories() = throw UnsupportedOperationException()
           override suspend fun createCategory(req: CategoryUpsertRequestDto) = throw UnsupportedOperationException()
           override suspend fun listLocations() = throw UnsupportedOperationException()
           override suspend fun createLocation(req: LocationUpsertRequestDto) = throw UnsupportedOperationException()
           override suspend fun applyScans(req: ApplyScansRequest) = throw UnsupportedOperationException()
        }
      }
    )

    val r = mgr.pairFromPayload(ApplicationProvider.getApplicationContext(), PairingPayloadDto(baseUrl = "http://fake", code = "123456"))
    assertTrue("Should succeed", r.isSuccess)
    
    assertEquals("http://fake", prefs.baseUrlFlow.first())
    assertEquals(fakeToken, prefs.tokenFlow.first())
  }

  @Test
  fun pairFromPayload_webAuthnFail_clearsState() = runBlocking {
    // Stub WebAuthn failure (user cancellation or error)
    whenever(mockWebAuthn.createPasskey(any(), any())).thenThrow(RuntimeException("Cancelled"))

    val mgr = PairingManager(
      prefs = prefs,
      webAuthnManager = mockWebAuthn,
      identityProvider = { DeviceIdentity.Identity(deviceId = "dev", publicKeyBase64 = "pk") },
      apiServiceForBaseUrl = { _, _ ->
        object : ApiService {
           override suspend fun registerOptions(req: WebAuthnRegistrationOptionsRequest) = 
             com.google.gson.JsonParser.parseString("{}").asJsonObject
           
           override suspend fun registerCancel(req: WebAuthnCancellationRequest) = com.google.gson.JsonObject()
           
           // Should not be called if createPasskey fails
           override suspend fun registerVerify(req: WebAuthnRegistrationVerifyRequest) = throw UnsupportedOperationException()
           override suspend fun authOptions(req: Map<String, String>) = throw UnsupportedOperationException()
           override suspend fun authVerify(req: WebAuthnAuthenticationVerifyRequest) = throw UnsupportedOperationException()
           // Unused...
           override suspend fun exchangePairing(req: PairExchangeRequestDto) = throw UnsupportedOperationException()
           override suspend fun ping() = throw UnsupportedOperationException()
           override suspend fun meta() = throw UnsupportedOperationException()
           override suspend fun listInventories() = throw UnsupportedOperationException()
           override suspend fun exportSnapshot() = throw UnsupportedOperationException()
           override suspend fun importSnapshot(req: ExportSnapshotDto) = throw UnsupportedOperationException()
           override suspend fun listItems(since: Long, includeDeleted: Int) = throw UnsupportedOperationException()
           override suspend fun createItem(req: ItemUpsertRequestDto) = throw UnsupportedOperationException()
           override suspend fun updateItem(id: Int, req: ItemUpsertRequestDto) = throw UnsupportedOperationException()
           override suspend fun listItemBarcodesSince(since: Long) = throw UnsupportedOperationException()
           override suspend fun listCategories() = throw UnsupportedOperationException()
           override suspend fun createCategory(req: CategoryUpsertRequestDto) = throw UnsupportedOperationException()
           override suspend fun listLocations() = throw UnsupportedOperationException()
           override suspend fun createLocation(req: LocationUpsertRequestDto) = throw UnsupportedOperationException()
           override suspend fun applyScans(req: ApplyScansRequest) = throw UnsupportedOperationException()
        }
      }
    )

    val r = mgr.pairFromPayload(ApplicationProvider.getApplicationContext(), PairingPayloadDto(baseUrl = "http://fake", code = "123"))
    assertTrue(r.isFailure)

    assertEquals(null, prefs.baseUrlFlow.first())
    assertEquals(null, prefs.tokenFlow.first())
  }
}