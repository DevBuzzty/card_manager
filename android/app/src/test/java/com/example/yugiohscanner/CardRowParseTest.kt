package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CollectionRepository
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Spec G4 §6 -- das Kartenmodell liest price_first_ed und cm_first_ed_factor; fehlend oder null ergibt null. */
class CardRowParseTest {
    @Test fun `liest 1st-Ed-Felder`() {
        val rows = CollectionRepository.parse(JSONArray("""[
            {"id":"1","set_code":"MAMO-DE020","language":"DE","rarity":"Ultra Rare","quantity":1,"price":73.85,"price_first_ed":77.87,"cm_first_ed_factor":1.0545},
            {"id":"2","set_code":"X-1","price":1.0,"price_first_ed":null,"cm_first_ed_factor":null},
            {"id":"3","set_code":"X-2","price":2.0}
        ]"""))
        assertEquals(77.87, rows[0].priceFirstEd!!, 1e-9)
        assertEquals(1.0545, rows[0].cmFirstEdFactor!!, 1e-9)
        assertNull(rows[1].priceFirstEd); assertNull(rows[1].cmFirstEdFactor)
        assertNull(rows[2].priceFirstEd); assertNull(rows[2].cmFirstEdFactor)
    }
}
