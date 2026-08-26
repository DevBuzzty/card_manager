package com.example.yugiohscanner.cloud

// NOTE: if `postgrest.from("cards")` doesn't resolve, the index form `postgrest["cards"]` is the alternative.
import io.github.jan.supabase.postgrest.postgrest
// NOTE: if `Columns.ALL` doesn't resolve, use `Columns.type<CardRow>()`.
import io.github.jan.supabase.postgrest.query.Columns

object CollectionRepository {

    suspend fun loadCards(): List<CardRow> =
        SupabaseCloud.client().postgrest.from("cards")
            .select(Columns.ALL) {
                filter {
                    eq("deleted", false)
                    gt("quantity", 0)
                }
            }
            .decodeList<CardRow>()

    suspend fun setQuantity(row: CardRow, qty: Int) {
        SupabaseCloud.client().postgrest.from("cards").update({
            set("quantity", qty)
        }) {
            filter {
                eq("id", row.id)
                eq("set_code", row.setCode)
                eq("language", row.language)
            }
        }
    }

    suspend fun softDelete(row: CardRow) {
        SupabaseCloud.client().postgrest.from("cards").update({
            set("deleted", true)
        }) {
            filter {
                eq("id", row.id)
                eq("set_code", row.setCode)
                eq("language", row.language)
            }
        }
    }
}
