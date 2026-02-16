package com.inventory.android.net

import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PUT
import retrofit2.http.POST
import retrofit2.http.Query
import retrofit2.http.Path

interface ApiService {
  @GET("/api/ping")
  suspend fun ping(): PingDto

  @GET("/api/meta")
  suspend fun meta(): MetaDto

  @GET("/api/inventories")
  suspend fun listInventories(): InventoriesResponseDto

  @POST("/api/pair/exchange")
  suspend fun exchangePairing(@Body req: PairExchangeRequestDto): PairExchangeResponseDto

  @GET("/api/export")
  suspend fun exportSnapshot(): ExportSnapshotDto

  @POST("/api/import")
  suspend fun importSnapshot(@Body req: ExportSnapshotDto): OkDto

  @GET("/api/items")
  suspend fun listItems(
    @Query("since") since: Long,
    @Query("includeDeleted") includeDeleted: Int = 1
  ): ItemsResponseDto

  @POST("/api/items")
  suspend fun createItem(@Body req: ItemUpsertRequestDto): ItemResponseDto

  @PUT("/api/items/{id}")
  suspend fun updateItem(@Path("id") id: Int, @Body req: ItemUpsertRequestDto): ItemResponseDto

  @DELETE("/api/items/{id}")
  suspend fun deleteItem(@Path("id") id: Int): ItemResponseDto

  @GET("/api/item-barcodes")
  suspend fun listItemBarcodesSince(@Query("since") since: Long): ItemBarcodesSinceResponse

  @GET("/api/categories")
  suspend fun listCategories(): CategoriesResponseDto

  @POST("/api/categories")
  suspend fun createCategory(@Body req: CategoryUpsertRequestDto): CategoryResponseDto

  @GET("/api/locations")
  suspend fun listLocations(): LocationsResponseDto

  @POST("/api/locations")
  suspend fun createLocation(@Body req: LocationUpsertRequestDto): LocationResponseDto

  @POST("/api/scans/apply")
  suspend fun applyScans(@Body req: ApplyScansRequest): ApplyScansResponse

  @POST("/auth/webauthn/registration/options")
  suspend fun registerOptions(@Body req: WebAuthnRegistrationOptionsRequest): com.google.gson.JsonObject

  @POST("/auth/webauthn/registration/verify")
  suspend fun registerVerify(@Body req: WebAuthnRegistrationVerifyRequest): WebAuthnVerifyResponse

  @POST("/auth/webauthn/registration/cancel")
  suspend fun registerCancel(@Body req: WebAuthnCancellationRequest): com.google.gson.JsonObject

  @POST("/auth/webauthn/authentication/options")
  suspend fun authOptions(@Body req: Map<String, String>): com.google.gson.JsonObject

  @POST("/auth/webauthn/authentication/verify")
  suspend fun authVerify(@Body req: WebAuthnAuthenticationVerifyRequest): WebAuthnVerifyResponse
}
