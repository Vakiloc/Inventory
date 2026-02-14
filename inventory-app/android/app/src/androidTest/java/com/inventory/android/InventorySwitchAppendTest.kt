package com.inventory.android

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.InventoryRepository
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

open class SwitchTestFakeApiService : ApiService {
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
class InventorySwitchAppendTest {
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
  fun switchInventoryClearAndBootstrap_clearsDb_setsInventoryId_and_bootstraps() = runBlocking {
    prefs.setPairing("http://127.0.0.1:3000", "test")
    prefs.setBootstrapped(true)

    // Seed local data + pending
    db.itemsDao().upsertAll(
      listOf(
        ItemDto(
          item_id = 1,
          name = "Local",
          description = null,
          quantity = 1,
          barcode = null,
          category_id = null,
          location_id = null,
          purchase_date = null,
          warranty_info = null,
          value = null,
          serial_number = null,
          photo_path = null,
          deleted = 0,
          last_modified = 1
        ).let {
          com.inventory.android.data.ItemEntity(
            item_id = it.item_id,
            name = it.name,
            description = it.description,
            quantity = it.quantity,
            barcode = it.barcode,
            barcode_corrupted = it.barcode_corrupted,
            category_id = it.category_id,
            location_id = it.location_id,
            purchase_date = it.purchase_date,
            warranty_info = it.warranty_info,
            value = it.value,
            serial_number = it.serial_number,
            photo_path = it.photo_path,
            deleted = it.deleted,
            last_modified = it.last_modified
          )
        }
      )
    )

    val now = System.currentTimeMillis()
    val fake = object : SwitchTestFakeApiService() {
      override suspend fun ping(): PingDto = PingDto(ok = true, name = "fake", time = "now")
      override suspend fun meta(): MetaDto = MetaDto(dbPath = "mem", serverTimeMs = now)
      override suspend fun listInventories(): InventoriesResponseDto =
        InventoriesResponseDto(activeId = "a", inventories = listOf(InventoryDto("a", "A")))

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
              item_id = 42,
              name = "Remote",
              description = null,
              quantity = 2,
              barcode = null,
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

      override suspend fun importSnapshot(req: ExportSnapshotDto): OkDto = OkDto(true)

      override suspend fun registerOptions(req: WebAuthnRegistrationOptionsRequest) = throw UnsupportedOperationException("not used")
      override suspend fun registerVerify(req: WebAuthnRegistrationVerifyRequest) = throw UnsupportedOperationException("not used")
      override suspend fun authOptions(req: Map<String, String>) = throw UnsupportedOperationException("not used")
      override suspend fun authVerify(req: WebAuthnAuthenticationVerifyRequest) = throw UnsupportedOperationException("not used")

      override suspend fun listItems(since: Long, includeDeleted: Int): ItemsResponseDto =
        ItemsResponseDto(serverTimeMs = now, items = emptyList(), deleted = emptyList())

      override suspend fun createItem(req: ItemUpsertRequestDto): ItemResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun updateItem(id: Int, req: ItemUpsertRequestDto): ItemResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun listItemBarcodesSince(since: Long): ItemBarcodesSinceResponse =
        ItemBarcodesSinceResponse(serverTimeMs = now, barcodes = emptyList())

      override suspend fun listCategories(): CategoriesResponseDto = CategoriesResponseDto(emptyList())
      override suspend fun createCategory(req: CategoryUpsertRequestDto): CategoryResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun listLocations(): LocationsResponseDto = LocationsResponseDto(emptyList())
      override suspend fun createLocation(req: LocationUpsertRequestDto): LocationResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun applyScans(req: ApplyScansRequest): ApplyScansResponse =
        ApplyScansResponse(serverTimeMs = now, results = emptyList())
    }

    val repo = InventoryRepository(db, prefs) { fake }
    val r = repo.switchInventoryClearAndBootstrap("inv-2")
    assertTrue(r.isSuccess)

    assertEquals("inv-2", prefs.inventoryIdFlow.first())
    assertTrue(prefs.bootstrappedFlow.first())

    val items = db.itemsDao().listAll()
    assertEquals(1, items.size)
    assertEquals(42, items[0].item_id)
  }

  @Test
  fun appendLocalToInventory_bootstraps_then_flushes_pending_creates() = runBlocking {
    prefs.setBootstrapped(false)

    val now = System.currentTimeMillis()

    val fake = object : SwitchTestFakeApiService() {
      override suspend fun ping(): PingDto = PingDto(ok = true, name = "fake", time = "now")
      override suspend fun meta(): MetaDto = MetaDto(dbPath = "mem", serverTimeMs = now)
      override suspend fun listInventories(): InventoriesResponseDto =
        InventoriesResponseDto(activeId = "a", inventories = listOf(InventoryDto("a", "A")))

      override suspend fun exchangePairing(req: PairExchangeRequestDto): PairExchangeResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun exportSnapshot(): ExportSnapshotDto {
        return ExportSnapshotDto(
          schema = 1,
          exported_at_ms = now,
          categories = emptyList(),
          locations = emptyList(),
          items = emptyList(),
          item_barcodes = emptyList()
        )
      }

      override suspend fun importSnapshot(req: ExportSnapshotDto): OkDto = OkDto(true)

      override suspend fun registerOptions(req: WebAuthnRegistrationOptionsRequest) = throw UnsupportedOperationException("not used")
      override suspend fun registerVerify(req: WebAuthnRegistrationVerifyRequest) = throw UnsupportedOperationException("not used")
      override suspend fun authOptions(req: Map<String, String>) = throw UnsupportedOperationException("not used")
      override suspend fun authVerify(req: WebAuthnAuthenticationVerifyRequest) = throw UnsupportedOperationException("not used")

      override suspend fun listItems(since: Long, includeDeleted: Int): ItemsResponseDto =
        ItemsResponseDto(serverTimeMs = now, items = emptyList(), deleted = emptyList())

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
        ItemBarcodesSinceResponse(serverTimeMs = now, barcodes = emptyList())

      override suspend fun listCategories(): CategoriesResponseDto = CategoriesResponseDto(emptyList())
      override suspend fun createCategory(req: CategoryUpsertRequestDto): CategoryResponseDto {
        val c = CategoryDto(category_id = 1, name = req.name)
        return CategoryResponseDto(c)
      }

      override suspend fun listLocations(): LocationsResponseDto = LocationsResponseDto(emptyList())
      override suspend fun createLocation(req: LocationUpsertRequestDto): LocationResponseDto {
        val l = LocationDto(location_id = 1, name = req.name, parent_id = req.parent_id)
        return LocationResponseDto(l)
      }

      override suspend fun applyScans(req: ApplyScansRequest): ApplyScansResponse =
        ApplyScansResponse(serverTimeMs = now, results = emptyList())

}

    val repo = InventoryRepository(db, prefs) { fake }

    // Create local data while unpaired so it gets queued as a pending create.
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
    assertTrue("submitItemForm should succeed", created.isSuccess)
    val pendingBefore = repo.pendingCreatesCount()
    assertTrue("expected pending creates > 0, got $pendingBefore", pendingBefore > 0)

    // Now pair so append can sync and flush the pending create.
    prefs.setPairing("http://127.0.0.1:3000", "test")

    val r = repo.appendLocalToInventory("inv-a")
    assertTrue("appendLocalToInventory should succeed: ${r.exceptionOrNull()?.message}", r.isSuccess)

    assertEquals("inv-a", prefs.inventoryIdFlow.first())

    // Pending creates should have flushed and temp item should be replaced with server id.
    val pendingAfter = repo.pendingCreatesCount()
    assertEquals("pending creates should flush after append", 0, pendingAfter)
    val items = db.itemsDao().listAll()
    val ids = items.map { it.item_id }.sorted()
    assertTrue("expected server item id 10; local ids=$ids", items.any { it.item_id == 10 })
  }

  @Test
  fun appendLocalToInventory_whenUnpaired_fails_without_mutating_inventoryId_or_clearing_pending() = runBlocking {
    prefs.setBootstrapped(false)

    val now = System.currentTimeMillis()
    val fake = object : SwitchTestFakeApiService() {
      override suspend fun ping(): PingDto = PingDto(ok = true, name = "fake", time = "now")
      override suspend fun meta(): MetaDto = MetaDto(dbPath = "mem", serverTimeMs = now)
      override suspend fun listInventories(): InventoriesResponseDto =
        InventoriesResponseDto(activeId = "a", inventories = listOf(InventoryDto("a", "A")))

      override suspend fun exchangePairing(req: PairExchangeRequestDto): PairExchangeResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun exportSnapshot(): ExportSnapshotDto =
        throw UnsupportedOperationException("not used")

      override suspend fun importSnapshot(req: ExportSnapshotDto): OkDto = OkDto(true)

      override suspend fun registerOptions(req: WebAuthnRegistrationOptionsRequest) = throw UnsupportedOperationException("not used")
      override suspend fun registerVerify(req: WebAuthnRegistrationVerifyRequest) = throw UnsupportedOperationException("not used")
      override suspend fun authOptions(req: Map<String, String>) = throw UnsupportedOperationException("not used")
      override suspend fun authVerify(req: WebAuthnAuthenticationVerifyRequest) = throw UnsupportedOperationException("not used")

      override suspend fun listItems(since: Long, includeDeleted: Int): ItemsResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun createItem(req: ItemUpsertRequestDto): ItemResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun updateItem(id: Int, req: ItemUpsertRequestDto): ItemResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun listItemBarcodesSince(since: Long): ItemBarcodesSinceResponse =
        throw UnsupportedOperationException("not used")

      override suspend fun listCategories(): CategoriesResponseDto = CategoriesResponseDto(emptyList())
      override suspend fun createCategory(req: CategoryUpsertRequestDto): CategoryResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun listLocations(): LocationsResponseDto = LocationsResponseDto(emptyList())
      override suspend fun createLocation(req: LocationUpsertRequestDto): LocationResponseDto =
        throw UnsupportedOperationException("not used")

      override suspend fun applyScans(req: ApplyScansRequest): ApplyScansResponse =
        ApplyScansResponse(serverTimeMs = now, results = emptyList())
    }

    val repo = InventoryRepository(db, prefs) { fake }

    // Create local data while unpaired so it gets queued as a pending create.
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
    assertTrue("submitItemForm should succeed", created.isSuccess)
    val pendingBefore = repo.pendingCreatesCount()
    assertTrue("expected pending creates > 0, got $pendingBefore", pendingBefore > 0)

    val invBefore = prefs.inventoryIdFlow.first()
    val r = repo.appendLocalToInventory("inv-a")
    assertTrue("appendLocalToInventory should fail when unpaired", r.isFailure)

    // Should not partially switch inventory or clear pending queues.
    assertEquals(invBefore, prefs.inventoryIdFlow.first())
    val pendingAfter = repo.pendingCreatesCount()
    assertEquals(pendingBefore, pendingAfter)
  }
}
