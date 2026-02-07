package com.example.yugiohscanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CardCodeValidatorTest {

    @Test
    fun extractPasscode_valid8Digits_returnsPasscode() {
        val text = "89631139"
        val result = CardCodeValidator.extractPasscode(text)
        assertEquals("89631139", result)
    }

    @Test
    fun extractPasscode_valid8DigitsSurroundedByText_returnsPasscode() {
        val text = "The passcode is 89631139, please add it."
        val result = CardCodeValidator.extractPasscode(text)
        assertEquals("89631139", result)
    }

    @Test
    fun extractPasscode_7Digits_returnsNull() {
        val text = "1234567"
        val result = CardCodeValidator.extractPasscode(text)
        assertNull(result)
    }

    @Test
    fun extractPasscode_9Digits_returnsNull() {
        val text = "123456789"
        val result = CardCodeValidator.extractPasscode(text)
        assertNull(result)
    }

    @Test
    fun extractPasscode_8DigitsWithLetters_returnsNull() {
        val text = "A12345678"
        val result = CardCodeValidator.extractPasscode(text)
        assertNull(result)

        val text2 = "12345678B"
        val result2 = CardCodeValidator.extractPasscode(text2)
        assertNull(result2)
    }

    @Test
    fun extractPasscode_multipleCodes_returnsFirst() {
        val text = "Codes: 89631139 and 12345678"
        val result = CardCodeValidator.extractPasscode(text)
        assertEquals("89631139", result)
    }

    @Test
    fun extractPasscode_emptyString_returnsNull() {
        val text = ""
        val result = CardCodeValidator.extractPasscode(text)
        assertNull(result)
    }

    @Test
    fun extractPasscode_noDigits_returnsNull() {
        val text = "no digits here"
        val result = CardCodeValidator.extractPasscode(text)
        assertNull(result)
    }

    @Test
    fun extractPasscode_8DigitsWithNewlines_returnsPasscode() {
        val text = "First line\n89631139\nLast line"
        val result = CardCodeValidator.extractPasscode(text)
        assertEquals("89631139", result)
    }
}
