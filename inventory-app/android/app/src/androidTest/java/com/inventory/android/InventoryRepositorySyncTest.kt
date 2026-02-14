package com.inventory.android

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.InventoryRepository
import com.inventory.android.data.ItemEntity
import com.inventory.android.data.Prefs
import com.inventory.android.net.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

open class SyncTestFakeApiService : ApiService {
  override suspend fun ping(): PingDto = throw UnsupportedOperationException("ping")
  override suspend fun meta(): MetaDto = throw UnsupportedOperationException("meta")
  override suspend fun listInventories(): InventoriesResponseDto = throw UnsupportedOperationException("listInventories")
  override suspend fun exchangePairing(req: PairExchangeRequestDto): PairExchangeResponseDto = throw UnsupportedOperationException("exchangePairing")
  override suspend fun exportSnapshot(): ExportSnapshotDto = throw UnsupportedOperationException("exportSnapshot")
  override suspend fun importSnapshot(req: ExportSnapshotDto): OkDto = throw UnsupportedOperationException("importSnapshot")
  override suspend fun listItems(since: Long, includeDeleted: Int): ItemsResponseDto = throw UnsupportedOperationException("listItems")
  override suspend fun createItem(req: ItemUpsertRequestDto): ItemResponseDto = throw UnsupportedOperationException("createItem")
  override suspend fun updateItem(id: Int, req: ItemUpsertRequestDto): ItemResponseDto = throw UnsupportedOperationException("updateItem")
  override suspend fun listItemBarcodesSince(since: Long): ItemBarcodesSinceResponse = throw UnsupportedOperationException("listItemBarcodesSince")
  override suspend fun listCategories(): CategoriesResponseDto = throw UnsupportedOperationException("listCategories")
  override suspend fun createCategory(req: CategoryUpsertRequestDto): CategoryResponseDto = throw UnsupportedOperationException("createCategory")
  override suspend fun listLocations(): LocationsResponseDto = throw UnsupportedOperationException("listLocations")
  override suspend fun createLocation(req: LocationUpsertRequestDto): LocationResponseDto = throw UnsupportedOperationException("createLocation")
  override suspend fun applyScans(req: ApplyScansRequest): ApplyScansResponse = throw UnsupportedOperationException("applyScans")
  override suspend fun registerOptions(req: WebAuthnRegistrationOptionsRequest): com.google.gson.JsonObject = throw UnsupportedOperationException("registerOptions")
  override suspend fun registerVerify(req: WebAuthnRegistrationVerifyRequest): WebAuthnVerifyResponse = throw UnsupportedOperationException("registerVerify")
  override suspend fun registerCancel(req: WebAuthnCancellationRequest): com.google.gson.JsonObject = throw UnsupportedOperationException("registerCancel")
  override suspend fun authOptions(req: Map<String, String>): com.google.gson.JsonObject = throw UnsupportedOperationException("authOptions")
  override suspend fun authVerify(req: WebAuthnAuthenticationVerifyRequest): WebAuthnVerifyResponse = throw UnsupportedOperationException("authVerify")
}

@RunWith(AndroidJUnit4::class)
class InventoryRepositorySyncTest {
  private lateinit var db: AppDatabase
  private lateinit var prefs: Prefs

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    prefs = Prefs(context)
    runBlocking { prefs.clearAll() }

    db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
      .allowMainThreadQueries()
      .build()
  }

  @After
  fun tearDown() {
    db.close()
  }

  @Test
  fun syncOnce_whenNotBootstrapped_bootstrapsFromSnapshot() = runBlocking {
    prefs.setPairing("http://127.0.0.1:3000", "test")
    prefs.setBootstrapped(false)

    val now = System.currentTimeMillis()
    val fake = object : SyncTestFakeApiService() {
      override suspend fun ping(): PingDto = PingDto(ok = true, name = "fake", time = "now")
      override suspend fun meta(): MetaDto = MetaDto(dbPath = "mem", serverTimeMs = now)

      override suspend fun listInventories(): InventoriesResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun exchangePairing(req: PairExchangeRequestDto): PairExchangeResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun exportSnapshot(): ExportSnapshotDto {
        return ExportSnapshotDto(
          schema = 1,
          exported_at_ms = now,
          categories = emptyList(),
          locations = emptyList(),
          items = listOf(
            ItemDto(
              item_id = 1,
              name = "Widget",
              description = null,
              quantity = 2,
              barcode = "123",
              category_id = null,
              location_id = null,
              purchase_date = null,
              warranty_info = null,
              value = null,
              serial_number = null,
              photo_path = null,
              deleted = 0,
              last_modified = now
            )
          ),
          item_barcodes = emptyList()
        )
      }

      override suspend fun listItems(since: Long, includeDeleted: Int): ItemsResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun createItem(req: ItemUpsertRequestDto): ItemResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun updateItem(id: Int, req: ItemUpsertRequestDto): ItemResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun listItemBarcodesSince(since: Long): ItemBarcodesSinceResponse =
        throw UnsupportedOperationException("not used")

      override suspend fun listCategories(): CategoriesResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun createCategory(req: CategoryUpsertRequestDto): CategoryResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun listLocations(): LocationsResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun createLocation(req: LocationUpsertRequestDto): LocationResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun applyScans(req: ApplyScansRequest): ApplyScansResponse =
        throw UnsupportedOperationException("not used")

      override suspend fun importSnapshot(req: ExportSnapshotDto): OkDto =
        throw UnsupportedOperationException("not used")

      override suspend fun registerOptions(req: WebAuthnRegistrationOptionsRequest) = throw UnsupportedOperationException("not used")
      override suspend fun registerVerify(req: WebAuthnRegistrationVerifyRequest) = throw UnsupportedOperationException("not used")
      override suspend fun authOptions(req: Map<String, String>) = throw UnsupportedOperationException("not used")
      override suspend fun authVerify(req: WebAuthnAuthenticationVerifyRequest) = throw UnsupportedOperationException("not used")
    }

    val repo = InventoryRepository(db, prefs) { fake }

    // syncOnce now requires pairing unless in LocalOnly mode.
    prefs.setPairing("http://127.0.0.1:3000", "test")

    val r = repo.syncOnce()
    assertTrue(r.isSuccess)
    assertTrue(prefs.bootstrappedFlow.first())

    val items = db.itemsDao().observeFiltered(null, null, null).first()
    assertEquals(1, items.size)
    assertEquals("Widget", items[0].name)
    assertEquals(2, items[0].quantity)
  }

  @Test
  fun submitItemForm_upsertsIntoLocalDb() = runBlocking {
    prefs.setPairing("http://127.0.0.1:3000", "test")
    prefs.setBootstrapped(true)

    val now = System.currentTimeMillis()
    val fake = object : SyncTestFakeApiService() {
      override suspend fun ping(): PingDto = PingDto(ok = true, name = "fake", time = "now")
      override suspend fun meta(): MetaDto = MetaDto(dbPath = "mem", serverTimeMs = now)
      override suspend fun exportSnapshot(): ExportSnapshotDto = throw UnsupportedOperationException("not used")

      override suspend fun listInventories(): InventoriesResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun exchangePairing(req: PairExchangeRequestDto): PairExchangeResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun listItems(since: Long, includeDeleted: Int): ItemsResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun createItem(req: ItemUpsertRequestDto): ItemResponseDto {
        val item = ItemDto(
          item_id = 10,
          name = req.name,
          description = req.description,
          quantity = req.quantity,
          barcode = req.barcode,
          category_id = req.category_id,
          location_id = req.location_id,
          purchase_date = req.purchase_date,
          warranty_info = req.warranty_info,
          value = req.value,
          serial_number = req.serial_number,
          photo_path = req.photo_path,
          deleted = 0,
          last_modified = req.last_modified ?: now
        )
        return ItemResponseDto(item)
      }

      override suspend fun updateItem(id: Int, req: ItemUpsertRequestDto): ItemResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun listItemBarcodesSince(since: Long): ItemBarcodesSinceResponse =
        throw UnsupportedOperationException("not used")

      override suspend fun listCategories(): CategoriesResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun createCategory(req: CategoryUpsertRequestDto): CategoryResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun listLocations(): LocationsResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun createLocation(req: LocationUpsertRequestDto): LocationResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun applyScans(req: ApplyScansRequest): ApplyScansResponse =
        throw UnsupportedOperationException("not used")

      override suspend fun importSnapshot(req: ExportSnapshotDto): OkDto =
        throw UnsupportedOperationException("not used")

      override suspend fun registerOptions(req: WebAuthnRegistrationOptionsRequest) = throw UnsupportedOperationException("not used")
      override suspend fun registerVerify(req: WebAuthnRegistrationVerifyRequest) = throw UnsupportedOperationException("not used")
      override suspend fun authOptions(req: Map<String, String>) = throw UnsupportedOperationException("not used")
      override suspend fun authVerify(req: WebAuthnAuthenticationVerifyRequest) = throw UnsupportedOperationException("not used")
    }

    val repo = InventoryRepository(db, prefs) { fake }
    val created = repo.submitItemForm(
      itemId = null,
      name = "New Thing",
      description = "Desc",
      quantity = 3,
      value = null,
      categoryId = null,
      locationId = null,
      barcode = "999",
      barcodeCorrupted = false,
      serialNumber = null,
      purchaseDate = null,
      warrantyInfo = null,
      photoPath = null
    )

    assertTrue(created.isSuccess)

    val items = db.itemsDao().observeFiltered(null, null, null).first()
    val local = items.first { it.item_id == 10 }
    assertEquals("New Thing", local.name)
    assertEquals(3, local.quantity)
    assertEquals("999", local.barcode)
  }

  @Test
  fun overrideScan_queuesEventWithOverride_andPinsAltBarcodeLocally_andSendsOverrideOnApply() = runBlocking {
    val context = ApplicationProvider.getApplicationContext<Context>()
    prefs.setPairing("http://127.0.0.1:3000", "test")
    prefs.setBootstrapped(true)

    val now = System.currentTimeMillis()

    // Seed two items locally
    db.itemsDao().upsertAll(
      listOf(
        ItemEntity(
          item_id = 1,
          name = "Item A",
          description = null,
          quantity = 1,
          barcode = "OV-001",
          barcode_corrupted = 0,
          category_id = null,
          location_id = null,
          purchase_date = null,
          warranty_info = null,
          value = null,
          serial_number = null,
          photo_path = null,
          deleted = 0,
          last_modified = now
        ),
        ItemEntity(
          item_id = 2,
          name = "Chosen",
          description = null,
          quantity = 10,
          barcode = "CH-1",
          barcode_corrupted = 0,
          category_id = null,
          location_id = null,
          purchase_date = null,
          warranty_info = null,
          value = null,
          serial_number = null,
          photo_path = null,
          deleted = 0,
          last_modified = now
        )
      )
    )

    // Queue an override scan: barcode OV-001 should increment item 2 and pin OV-001 -> item 2 locally.
    val repo = InventoryRepository(db, prefs) {
      object : SyncTestFakeApiService() {
        override suspend fun ping(): PingDto = PingDto(ok = true, name = "fake", time = "now")
        override suspend fun meta(): MetaDto = MetaDto(dbPath = "mem", serverTimeMs = now)
        override suspend fun listInventories(): InventoriesResponseDto = throw UnsupportedOperationException("not used")
        override suspend fun exchangePairing(req: PairExchangeRequestDto): PairExchangeResponseDto =
          throw UnsupportedOperationException("not used")
        override suspend fun exportSnapshot(): ExportSnapshotDto = throw UnsupportedOperationException("not used")
        override suspend fun listItems(since: Long, includeDeleted: Int): ItemsResponseDto =
          throw UnsupportedOperationException("not used")
        override suspend fun createItem(req: ItemUpsertRequestDto): ItemResponseDto =
          throw UnsupportedOperationException("not used")
        override suspend fun updateItem(id: Int, req: ItemUpsertRequestDto): ItemResponseDto =
          throw UnsupportedOperationException("not used")
        override suspend fun listItemBarcodesSince(since: Long): ItemBarcodesSinceResponse =
          throw UnsupportedOperationException("not used")
        override suspend fun listCategories(): CategoriesResponseDto = throw UnsupportedOperationException("not used")
        override suspend fun createCategory(req: CategoryUpsertRequestDto): CategoryResponseDto =
          throw UnsupportedOperationException("not used")
        override suspend fun listLocations(): LocationsResponseDto = throw UnsupportedOperationException("not used")
        override suspend fun createLocation(req: LocationUpsertRequestDto): LocationResponseDto =
          throw UnsupportedOperationException("not used")

        override suspend fun applyScans(req: ApplyScansRequest): ApplyScansResponse {
          // Assert the override flag is sent.
          assertEquals(1, req.events.size)
          val ev = req.events[0]
          assertEquals("OV-001", ev.barcode)
          assertEquals(2, ev.item_id)
          assertEquals(true, ev.override)

          val updated = ItemDto(
            item_id = 2,
            name = "Chosen",
            description = null,
            quantity = 11,
            barcode = "CH-1",
            category_id = null,
            location_id = null,
            purchase_date = null,
            warranty_info = null,
            value = null,
            serial_number = null,
            photo_path = null,
            deleted = 0,
            last_modified = now + 1
          )

          return ApplyScansResponse(
            serverTimeMs = now,
            results = listOf(ApplyScanResultDto(status = "applied", event_id = ev.event_id, item = updated))
          )
        }

        override suspend fun importSnapshot(req: ExportSnapshotDto): OkDto =
          throw UnsupportedOperationException("not used")

        override suspend fun registerOptions(req: WebAuthnRegistrationOptionsRequest) = throw UnsupportedOperationException("not used")
        override suspend fun registerVerify(req: WebAuthnRegistrationVerifyRequest) = throw UnsupportedOperationException("not used")
        override suspend fun authOptions(req: Map<String, String>) = throw UnsupportedOperationException("not used")
        override suspend fun authVerify(req: WebAuthnAuthenticationVerifyRequest) = throw UnsupportedOperationException("not used")
      }
    }

    val q = repo.queueScanDeltaForItemId(2, "OV-001", 1, override = true)
    assertTrue(q is com.inventory.android.data.QueueScanResult.Queued)

    // Local pin: OV-001 should now resolve via alt mapping to item 2.
    val pinnedId = db.barcodesDao().findItemIdByAltBarcode("OV-001")
    assertEquals(2, pinnedId)

    // Pending event must include override flag
    val pending = db.pendingScanDao().listPending(10)
    assertEquals(1, pending.size)
    assertEquals(true, pending[0].override)

    val apply = repo.applyPendingScanEvents(limit = 10)
    assertTrue(apply.isSuccess)
  }
}
