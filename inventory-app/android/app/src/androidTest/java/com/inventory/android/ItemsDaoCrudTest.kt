package com.inventory.android

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.ItemEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ItemsDaoCrudTest {
  private lateinit var db: AppDatabase

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
      .allowMainThreadQueries()
      .build()
  }

  @After
  fun tearDown() {
    db.close()
  }

  @Test
  fun addItem_upsertThenVisibleInFiltered() = runBlocking {
    val now = System.currentTimeMillis()
    db.itemsDao().upsertAll(
      listOf(
        ItemEntity(
          item_id = 1,
          name = "Widget",
          description = null,
          quantity = 3,
          barcode = "123",
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

    val items = db.itemsDao().observeFiltered(null, null, null).first()
    assertEquals(1, items.size)
    assertEquals("Widget", items[0].name)
  }

  @Test
  fun editItem_upsertSameIdUpdatesFields() = runBlocking {
    val now = System.currentTimeMillis()
    db.itemsDao().upsertAll(
      listOf(
        ItemEntity(
          item_id = 1,
          name = "Widget",
          description = null,
          quantity = 1,
          barcode = null,
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

    db.itemsDao().upsertAll(
      listOf(
        ItemEntity(
          item_id = 1,
          name = "Widget v2",
          description = "Updated",
          quantity = 9,
          barcode = null,
          barcode_corrupted = 0,
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
      )
    )

    val items = db.itemsDao().observeFiltered(null, null, null).first()
    assertEquals(1, items.size)
    assertEquals("Widget v2", items[0].name)
    assertEquals(9, items[0].quantity)
    assertEquals("Updated", items[0].description)
  }

  @Test
  fun deleteItem_markDeletedHidesFromQueries() = runBlocking {
    val now = System.currentTimeMillis()
    db.itemsDao().upsertAll(
      listOf(
        ItemEntity(
          item_id = 1,
          name = "Widget",
          description = null,
          quantity = 1,
          barcode = null,
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

    db.itemsDao().upsertAll(
      listOf(
        ItemEntity(
          item_id = 1,
          name = "Widget",
          description = null,
          quantity = 1,
          barcode = null,
          barcode_corrupted = 0,
          category_id = null,
          location_id = null,
          purchase_date = null,
          warranty_info = null,
          value = null,
          serial_number = null,
          photo_path = null,
          deleted = 1,
          last_modified = now + 1
        )
      )
    )

    val items = db.itemsDao().observeFiltered(null, null, null).first()
    assertTrue(items.isEmpty())
  }
}
