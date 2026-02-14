package com.inventory.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.inventory.android.ui.theme.InventoryTheme

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent {
      InventoryTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
          InventoryApp()
        }
      }
    }
  }
}
