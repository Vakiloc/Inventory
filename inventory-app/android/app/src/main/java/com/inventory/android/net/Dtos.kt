package com.inventory.android.net

// Matches server snapshot + item/barcode payloads.

data class PingDto(
  val ok: Boolean,
  val name: String,
  val time: String
)

data class MetaDto(
  val dbPath: String,
  val serverTimeMs: Long,
  val inventoryId: String? = null,
  val auth: AuthDto? = null
)

data class AuthDto(
  val role: String? = null,
  val device_id: String? = null
)

data class ExportSnapshotDto(
  val schema: Int,
  val exported_at_ms: Long,
  val categories: List<CategoryDto> = emptyList(),
  val locations: List<LocationDto> = emptyList(),
  val items: List<ItemDto> = emptyList(),
  val item_barcodes: List<ItemBarcodeDto> = emptyList()
)

data class CategoryDto(
  val category_id: Int,
  val name: String
)

data class CategoriesResponseDto(
  val categories: List<CategoryDto> = emptyList()
)

data class CategoryResponseDto(
  val category: CategoryDto
)

data class CategoryUpsertRequestDto(
  val name: String
)

data class LocationDto(
  val location_id: Int,
  val name: String,
  val parent_id: Int?
)

data class LocationsResponseDto(
  val locations: List<LocationDto> = emptyList()
)

data class LocationResponseDto(
  val location: LocationDto
)

data class LocationUpsertRequestDto(
  val name: String,
  val parent_id: Int? = null
)

data class ItemDto(
  val item_id: Int,
  val name: String,
  val description: String?,
  val quantity: Int,
  val barcode: String?,
  val barcode_corrupted: Int = 0,
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

data class ItemBarcodeDto(
  val barcode: String,
  val item_id: Int,
  val created_at: Long
)

data class ItemBarcodesSinceResponse(
  val serverTimeMs: Long,
  val barcodes: List<ItemBarcodeDto>
)

data class ItemsResponseDto(
  val items: List<ItemDto> = emptyList(),
  val deleted: List<Int> = emptyList(),
  val serverTimeMs: Long
)

data class ItemUpsertRequestDto(
  val name: String,
  val description: String? = null,
  val quantity: Int = 1,
  val barcode: String? = null,
  val barcode_corrupted: Int? = null,
  val category_id: Int? = null,
  val location_id: Int? = null,
  val purchase_date: String? = null,
  val warranty_info: String? = null,
  val value: Double? = null,
  val serial_number: String? = null,
  val photo_path: String? = null,
  val last_modified: Long? = null,
  val deleted: Int? = null
)

data class ItemResponseDto(
  val item: ItemDto
)

data class ScanEventDto(
  val event_id: String,
  val barcode: String,
  val delta: Int,
  val scanned_at: Long,
  val item_id: Int? = null,
  val override: Boolean? = null
)

data class ApplyScansRequest(
  val events: List<ScanEventDto>
)

data class ApplyScanResultDto(
  val status: String,
  val event_id: String,
  val item: ItemDto? = null,
  val reason: String? = null
)

data class ApplyScansResponse(
  val serverTimeMs: Long,
  val results: List<ApplyScanResultDto>
)

data class PairingPayloadDto(
  val baseUrl: String,
  val token: String? = null,
  val code: String? = null,
  val expires_at_ms: Long? = null,
  val ips: List<String>? = null
)

data class PairExchangeRequestDto(
  val code: String,
  val device_id: String,
  val pubkey: String,
  val name: String? = null
)

data class PairExchangeResponseDto(
  val token: String,
  val device_id: String,
  val role: String
)

data class InventoryDto(
  val id: String,
  val name: String
)

data class InventoriesResponseDto(
  val activeId: String? = null,
  val inventories: List<InventoryDto> = emptyList()
)

data class OkDto(
  val ok: Boolean
)

// WebAuthn
data class WebAuthnRegistrationOptionsRequest(
    val token: String? = null,
    val user: WebAuthnUserDto? = null
)

data class WebAuthnUserDto(
    val username: String
)

data class WebAuthnRegistrationVerifyRequest(
    val response: com.google.gson.JsonObject,
    val friendlyName: String,
    val token: String? = null
)

data class WebAuthnCancellationRequest(
    val token: String
)

data class WebAuthnAuthenticationVerifyRequest(
    val response: com.google.gson.JsonObject
)

data class WebAuthnVerifyResponse(
    val verified: Boolean,
    val token: String? = null,
    val userId: Int? = null
)

