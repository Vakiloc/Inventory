package com.inventory.android.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "items")
data class ItemEntity(
  @PrimaryKey val item_id: Int,
  val name: String,
  val description: String?,
  val quantity: Int,
  val barcode: String?,
  val barcode_corrupted: Int,
  val category_id: Int?,
  val location_id: Int?,
  val purchase_date: String?,
  val warranty_info: String?,
  val value: Double?,
  val serial_number: String?,
  val photo_path: String?,
  val deleted: Int,
  val last_modified: Long
)

@Entity(tableName = "categories")
data class CategoryEntity(
  @PrimaryKey val category_id: Int,
  val name: String
)

@Entity(tableName = "locations")
data class LocationEntity(
  @PrimaryKey val location_id: Int,
  val name: String,
  val parent_id: Int?
)

@Entity(tableName = "item_barcodes")
data class ItemBarcodeEntity(
  @PrimaryKey val barcode: String,
  val item_id: Int,
  val created_at: Long
)

@Entity(tableName = "pending_scan_events")
data class PendingScanEventEntity(
  @PrimaryKey val event_id: String,
  val barcode: String,
  val delta: Int,
  val item_id: Int?,
  val override: Boolean,
  val scanned_at: Long,
  val state: String, // pending|sent|not_found|error
  val last_attempt_at: Long?
)

@Entity(tableName = "pending_item_updates")
data class PendingItemUpdateEntity(
  @PrimaryKey val client_id: String,
  val item_id: Int,
  val name: String,
  val description: String?,
  val quantity: Int,
  val barcode: String?,
  val barcode_corrupted: Int,
  val category_id: Int?,
  val location_id: Int?,
  val purchase_date: String?,
  val warranty_info: String?,
  val value: Double?,
  val serial_number: String?,
  val photo_path: String?,
  val last_modified: Long,
  val deleted: Int,
  val state: String, // pending|blocked|sent|error
  val created_at: Long,
  val last_attempt_at: Long?
)

@Entity(tableName = "pending_category_creates")
data class PendingCategoryCreateEntity(
  @PrimaryKey val client_id: String,
  val temp_category_id: Int,
  val name: String,
  val state: String, // pending|sent|error
  val created_at: Long,
  val last_attempt_at: Long?
)

@Entity(tableName = "pending_location_creates")
data class PendingLocationCreateEntity(
  @PrimaryKey val client_id: String,
  val temp_location_id: Int,
  val name: String,
  val parent_id: Int?, // can be temp (negative) or server (positive)
  val state: String, // pending|sent|blocked|error
  val created_at: Long,
  val last_attempt_at: Long?
)

@Entity(tableName = "pending_item_creates")
data class PendingItemCreateEntity(
  @PrimaryKey val client_id: String,
  val temp_item_id: Int,
  val name: String,
  val description: String?,
  val quantity: Int,
  val barcode: String?,
  val barcode_corrupted: Int,
  val category_id: Int?,
  val location_id: Int?,
  val purchase_date: String?,
  val warranty_info: String?,
  val value: Double?,
  val serial_number: String?,
  val photo_path: String?,
  val last_modified: Long,
  val state: String, // pending|sent|blocked|error
  val created_at: Long,
  val last_attempt_at: Long?
)

@Entity(tableName = "corrupted_barcodes")
data class CorruptedBarcodeEntity(
  @PrimaryKey(autoGenerate = true) val id: Int = 0,
  val raw_barcode: String,
  val first_seen_at: Long,
  val last_seen_at: Long,
  val count: Int,
  val resolved_barcode: String?
)
