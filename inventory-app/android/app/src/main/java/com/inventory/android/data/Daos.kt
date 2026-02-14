package com.inventory.android.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

data class ItemIdName(
  val item_id: Int,
  val name: String
)

@Dao
interface ItemsDao {
  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertAll(items: List<ItemEntity>)

  @Query("SELECT MIN(item_id) FROM items")
  suspend fun minId(): Int?

  @Query("SELECT * FROM items WHERE deleted = 0 ORDER BY name COLLATE NOCASE ASC")
  fun observeAll(): Flow<List<ItemEntity>>

  @Query("SELECT * FROM items WHERE deleted = 0 ORDER BY name COLLATE NOCASE ASC")
  suspend fun listAll(): List<ItemEntity>

  @Query("SELECT * FROM items WHERE item_id = :id")
  suspend fun getById(id: Int): ItemEntity?

  @Query("SELECT item_id FROM items WHERE deleted = 0 AND barcode = :barcode LIMIT 1")
  suspend fun findItemIdByPrimaryBarcode(barcode: String): Int?

  @Query("SELECT item_id, name FROM items WHERE deleted = 0 AND barcode = :barcode ORDER BY item_id ASC")
  suspend fun listItemsByPrimaryBarcode(barcode: String): List<ItemIdName>

  @Query(
    """
    SELECT item_id, name FROM items
    WHERE deleted = 0 AND barcode = :barcode
    UNION
    SELECT i.item_id, i.name FROM item_barcodes b
    JOIN items i ON i.item_id = b.item_id
    WHERE i.deleted = 0 AND b.barcode = :barcode
    ORDER BY item_id ASC
    """
  )
  suspend fun listItemsByAnyBarcode(barcode: String): List<ItemIdName>

  @Query(
    """
    SELECT i.item_id FROM item_barcodes b
    JOIN items i ON i.item_id = b.item_id
    WHERE i.deleted = 0 AND b.barcode = :barcode
    LIMIT 1
    """
  )
  suspend fun findItemIdByAltBarcode(barcode: String): Int?

  @Query(
    """
    SELECT * FROM items
    WHERE deleted = 0 AND (
      name LIKE :q
      OR barcode LIKE :q
      OR serial_number LIKE :q
    )
    ORDER BY name COLLATE NOCASE ASC
    """
  )
  suspend fun search(q: String): List<ItemEntity>

  @Query(
    """
    SELECT * FROM items
    WHERE deleted = 0 AND (
      name LIKE :q
      OR barcode LIKE :q
      OR serial_number LIKE :q
    )
    ORDER BY name COLLATE NOCASE ASC
    """
  )
  fun observeSearch(q: String): Flow<List<ItemEntity>>

  @Query(
    """
    SELECT * FROM items
    WHERE deleted = 0
      AND (:q IS NULL OR name LIKE :q OR barcode LIKE :q OR serial_number LIKE :q)
      AND (:categoryId IS NULL OR category_id = :categoryId)
      AND (:locationId IS NULL OR location_id = :locationId)
    ORDER BY name COLLATE NOCASE ASC
    """
  )
  fun observeFiltered(q: String?, categoryId: Int?, locationId: Int?): Flow<List<ItemEntity>>

  @Query("UPDATE items SET quantity = :qty, last_modified = :lm WHERE item_id = :id")
  suspend fun setQuantity(id: Int, qty: Int, lm: Long)

  @Query("UPDATE items SET category_id = :newId WHERE category_id = :oldId")
  suspend fun remapCategoryId(oldId: Int, newId: Int)

  @Query("UPDATE items SET location_id = :newId WHERE location_id = :oldId")
  suspend fun remapLocationId(oldId: Int, newId: Int)

  @Query("DELETE FROM items WHERE item_id = :id")
  suspend fun deleteById(id: Int)
}

@Dao
interface CategoriesDao {
  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertAll(items: List<CategoryEntity>)

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertOne(item: CategoryEntity)

  @Query("SELECT MIN(category_id) FROM categories")
  suspend fun minId(): Int?

  @Query("DELETE FROM categories WHERE category_id = :id")
  suspend fun deleteById(id: Int)

  @Query("SELECT * FROM categories")
  suspend fun listAll(): List<CategoryEntity>

  @Query("SELECT * FROM categories ORDER BY name COLLATE NOCASE ASC")
  fun observeAll(): Flow<List<CategoryEntity>>
}

@Dao
interface LocationsDao {
  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertAll(items: List<LocationEntity>)

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertOne(item: LocationEntity)

  @Query("SELECT MIN(location_id) FROM locations")
  suspend fun minId(): Int?

  @Query("UPDATE locations SET parent_id = :newParentId WHERE parent_id = :oldParentId")
  suspend fun remapParentId(oldParentId: Int, newParentId: Int)

  @Query("DELETE FROM locations WHERE location_id = :id")
  suspend fun deleteById(id: Int)

  @Query("SELECT * FROM locations")
  suspend fun listAll(): List<LocationEntity>

  @Query("SELECT * FROM locations ORDER BY name COLLATE NOCASE ASC")
  fun observeAll(): Flow<List<LocationEntity>>
}

@Dao
interface BarcodesDao {
  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertAll(items: List<ItemBarcodeEntity>)

  @Query("SELECT item_id FROM item_barcodes WHERE barcode = :barcode")
  suspend fun findItemIdByAltBarcode(barcode: String): Int?

  @Query("SELECT * FROM item_barcodes ORDER BY created_at DESC LIMIT 1")
  suspend fun newest(): ItemBarcodeEntity?

  @Query("SELECT * FROM item_barcodes")
  suspend fun listAll(): List<ItemBarcodeEntity>
}

@Dao
interface PendingScanDao {
  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsert(ev: PendingScanEventEntity)

  @Query("SELECT COUNT(*) FROM pending_scan_events WHERE state = 'pending'")
  suspend fun countPending(): Int

  @Query("SELECT * FROM pending_scan_events WHERE state = 'pending' ORDER BY scanned_at ASC LIMIT :limit")
  suspend fun listPending(limit: Int): List<PendingScanEventEntity>

  @Query("UPDATE pending_scan_events SET state = :state, last_attempt_at = :attempt WHERE event_id = :eventId")
  suspend fun setState(eventId: String, state: String, attempt: Long)
}

@Dao
interface PendingCategoryCreateDao {
  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsert(row: PendingCategoryCreateEntity)

  @Query("SELECT * FROM pending_category_creates WHERE state IN ('pending','error') ORDER BY created_at ASC LIMIT :limit")
  suspend fun listPending(limit: Int): List<PendingCategoryCreateEntity>

  @Query("SELECT COUNT(*) FROM pending_category_creates WHERE state IN ('pending','error')")
  suspend fun countPending(): Int

  @Query("UPDATE pending_category_creates SET state = :state, last_attempt_at = :attempt WHERE client_id = :clientId")
  suspend fun setState(clientId: String, state: String, attempt: Long)
}

@Dao
interface PendingLocationCreateDao {
  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsert(row: PendingLocationCreateEntity)

  @Query("SELECT * FROM pending_location_creates WHERE state IN ('pending','blocked','error') ORDER BY created_at ASC LIMIT :limit")
  suspend fun listPending(limit: Int): List<PendingLocationCreateEntity>

  @Query("SELECT COUNT(*) FROM pending_location_creates WHERE state IN ('pending','blocked','error')")
  suspend fun countPending(): Int

  @Query("UPDATE pending_location_creates SET state = :state, last_attempt_at = :attempt WHERE client_id = :clientId")
  suspend fun setState(clientId: String, state: String, attempt: Long)
}

@Dao
interface PendingItemCreateDao {
  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsert(row: PendingItemCreateEntity)

  @Query("SELECT * FROM pending_item_creates WHERE state IN ('pending','blocked','error') ORDER BY created_at ASC LIMIT :limit")
  suspend fun listPending(limit: Int): List<PendingItemCreateEntity>

  @Query("SELECT COUNT(*) FROM pending_item_creates WHERE state IN ('pending','blocked','error')")
  suspend fun countPending(): Int

  @Query("UPDATE pending_item_creates SET state = :state, last_attempt_at = :attempt WHERE client_id = :clientId")
  suspend fun setState(clientId: String, state: String, attempt: Long)
}

@Dao
interface PendingItemUpdateDao {
  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsert(row: PendingItemUpdateEntity)

  @Query("SELECT * FROM pending_item_updates WHERE state IN ('pending','blocked','error') ORDER BY created_at ASC LIMIT :limit")
  suspend fun listPending(limit: Int): List<PendingItemUpdateEntity>

  @Query("SELECT COUNT(*) FROM pending_item_updates WHERE state IN ('pending','blocked','error')")
  suspend fun countPending(): Int

  @Query("UPDATE pending_item_updates SET state = :state, last_attempt_at = :attempt WHERE client_id = :clientId")
  suspend fun setState(clientId: String, state: String, attempt: Long)
}

@Dao
interface CorruptedDao {
  @Query("SELECT * FROM corrupted_barcodes ORDER BY last_seen_at DESC LIMIT :limit")
  suspend fun recent(limit: Int): List<CorruptedBarcodeEntity>

  @Query("SELECT * FROM corrupted_barcodes WHERE resolved_barcode IS NULL ORDER BY last_seen_at DESC LIMIT :limit")
  suspend fun unresolved(limit: Int): List<CorruptedBarcodeEntity>

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun insert(row: CorruptedBarcodeEntity)

  @Update
  suspend fun update(row: CorruptedBarcodeEntity)

  @Transaction
  suspend fun bumpOrInsert(raw: String, now: Long) {
    val existing = findUnresolvedByRaw(raw)
    if (existing == null) {
      insert(
        CorruptedBarcodeEntity(
          raw_barcode = raw,
          first_seen_at = now,
          last_seen_at = now,
          count = 1,
          resolved_barcode = null
        )
      )
    } else {
      update(existing.copy(last_seen_at = now, count = existing.count + 1))
    }
  }

  @Query("SELECT * FROM corrupted_barcodes WHERE raw_barcode = :raw AND resolved_barcode IS NULL ORDER BY last_seen_at DESC LIMIT 1")
  suspend fun findUnresolvedByRaw(raw: String): CorruptedBarcodeEntity?

  @Query("UPDATE corrupted_barcodes SET resolved_barcode = :resolved WHERE id = :id")
  suspend fun markResolved(id: Int, resolved: String)
}
