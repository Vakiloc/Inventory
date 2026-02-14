package com.inventory.android.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
  entities = [
    ItemEntity::class,
    CategoryEntity::class,
    LocationEntity::class,
    ItemBarcodeEntity::class,
    PendingScanEventEntity::class,
    PendingCategoryCreateEntity::class,
    PendingLocationCreateEntity::class,
    PendingItemCreateEntity::class,
    PendingItemUpdateEntity::class,
    CorruptedBarcodeEntity::class
  ],
  version = 3,
  exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
  abstract fun itemsDao(): ItemsDao
  abstract fun categoriesDao(): CategoriesDao
  abstract fun locationsDao(): LocationsDao
  abstract fun barcodesDao(): BarcodesDao
  abstract fun pendingScanDao(): PendingScanDao
  abstract fun pendingCategoryCreateDao(): PendingCategoryCreateDao
  abstract fun pendingLocationCreateDao(): PendingLocationCreateDao
  abstract fun pendingItemCreateDao(): PendingItemCreateDao
  abstract fun pendingItemUpdateDao(): PendingItemUpdateDao
  abstract fun corruptedDao(): CorruptedDao

  companion object {
    @Volatile private var instance: AppDatabase? = null

    fun get(context: Context): AppDatabase {
      return instance ?: synchronized(this) {
        instance
          ?: Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, "inventory_mobile.db")
            .fallbackToDestructiveMigration()
            .build()
            .also { instance = it }
      }
    }

    /** Test helper: clears singleton instance and deletes the on-device DB file. */
    fun resetForTests(context: Context) {
      synchronized(this) {
        try {
          instance?.close()
        } catch (e: Exception) {
          // ignore
        }
        instance = null
      }
      try {
        context.applicationContext.deleteDatabase("inventory_mobile.db")
      } catch (e: Exception) {
        // ignore
      }
    }
  }
}
