package com.example.yugiohscanner

import com.example.yugiohscanner.ml.isWebLink
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebLinkTest {
    @Test fun `nur http und https, Gross-Klein egal, getrimmt`() {
        for (u in listOf("https://www.ebay.de/itm/1", "http://x.de", "HTTPS://X.DE", "  https://x.de/a  ", "Http://x")) assertTrue(u, isWebLink(u))
    }
    @Test fun `andere Schemata und Leeres werden abgelehnt`() {
        for (u in listOf(null, "", "   ", "intent://scan#Intent;end", "file:///sdcard/a.jpg", "content://x/y", "javascript:alert(1)",
            "market://details?id=x", "tel:123", "www.ebay.de", "https:", "ftp://x.de", "xhttps://x.de")) assertFalse(u.toString(), isWebLink(u))
    }
}
