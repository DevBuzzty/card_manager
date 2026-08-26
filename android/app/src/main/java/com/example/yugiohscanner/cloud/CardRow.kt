package com.example.yugiohscanner.cloud

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CardRow(
    val id: String,
    @SerialName("set_code") val setCode: String = "Unknown",
    val language: String = "DE",
    val name: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    val rarity: String? = null,
    val quantity: Int = 0,
    val price: Double? = null,
    val deleted: Boolean = false,
)
