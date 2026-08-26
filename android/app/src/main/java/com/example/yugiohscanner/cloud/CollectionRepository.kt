package com.example.yugiohscanner.cloud

import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.filter.FilterOperation
import io.github.jan.supabase.postgrest.query.filter.FilterOperator

object CollectionRepository {

    suspend fun loadCards(): List<CardRow> =
        SupabaseCloud.db().from("cards")
            .select(Columns.ALL) {
                filter { eq("deleted", false); gt("quantity", 0) }
            }
            .decodeList<CardRow>()

    suspend fun setQuantity(row: CardRow, qty: Int) {
        SupabaseCloud.db().from("cards").update(mapOf("quantity" to qty)) {
            filter { keyFilter(row) }
        }
    }

    suspend fun softDelete(row: CardRow) {
        SupabaseCloud.db().from("cards").update(mapOf("deleted" to true)) {
            filter { keyFilter(row) }
        }
    }

    // NOTE: the receiver type of the `filter { }` lambda (i.e. the type this extension function
    // must be declared on) is version-sensitive in supabase-kt — it has been named
    // PostgrestFilterBuilder in some releases and FilterBuilder/PostgrestRequestBuilder-scoped
    // types in others. If "io.github.jan.supabase.postgrest.query.filter.PostgrestFilterBuilder"
    // doesn't resolve, let Android Studio autocomplete `filter { }` above and change this
    // receiver type to match — the eq(...) calls themselves are stable.
    private fun io.github.jan.supabase.postgrest.query.filter.PostgrestFilterBuilder.keyFilter(row: CardRow) {
        eq("id", row.id); eq("set_code", row.setCode); eq("language", row.language)
    }
}
