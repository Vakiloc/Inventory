package com.inventory.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.inventory.android.data.AppDatabase
import com.inventory.android.data.ItemEntity
import com.inventory.android.i18n.t

@Composable
fun ItemList(query: String, categoryId: Int?, locationId: Int?) {
  val context = androidx.compose.ui.platform.LocalContext.current
  val db = remember { AppDatabase.get(context) }

  val q = query.trim().takeIf { it.isNotBlank() }?.let { "%$it%" }
  val itemsState = db.itemsDao().observeFiltered(q, categoryId, locationId)
    .collectAsState(initial = emptyList())
  val selected = remember { mutableStateOf<ItemEntity?>(null) }

  LazyColumn {
    items(itemsState.value) { it ->
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .clickable { selected.value = it }
          .padding(vertical = 10.dp, horizontal = 6.dp)
      ) {
        Column(modifier = Modifier.weight(1f)) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            if (it.barcode_corrupted == 1) {
              Icon(
                imageVector = Icons.Filled.Warning,
                contentDescription = t("item.field.barcode.corrupted"),
                tint = MaterialTheme.colorScheme.error
              )
              Spacer(Modifier.padding(4.dp))
            }
            Text(it.name, style = MaterialTheme.typography.bodyLarge)
          }
          Text(t("items.qtyFormat", "qty" to it.quantity), style = MaterialTheme.typography.bodySmall)
        }
        Text(t("items.idFormat", "id" to it.item_id), style = MaterialTheme.typography.bodySmall)
      }
    }
  }

  val item = selected.value
  if (item != null) {
    AlertDialog(
      onDismissRequest = { selected.value = null },
      confirmButton = {
        TextButton(onClick = { selected.value = null }) { Text(t("common.close")) }
      },
      title = { Text(item.name) },
      text = {
        Column {
          Text(t("item.detail.quantity", "qty" to item.quantity))
          if (item.barcode_corrupted == 1) {
            Text(t("item.detail.barcodeCorrupted"))
          } else if (!item.barcode.isNullOrBlank()) {
            Text(t("item.detail.barcode", "barcode" to item.barcode))
          }
          if (!item.serial_number.isNullOrBlank()) Text(t("item.detail.serial", "serial" to item.serial_number))
          val desc = item.description
          if (!desc.isNullOrBlank()) {
            Spacer(Modifier.padding(4.dp))
            Text(desc)
          }
        }
      }
    )
  }
}
