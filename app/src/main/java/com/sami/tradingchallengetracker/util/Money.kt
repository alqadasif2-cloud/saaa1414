package com.sami.tradingchallengetracker.util

import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object Money {

    fun normalizeArabicDigits(str: String): String {
        val arabic = charArrayOf('٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩')
        var result = str
        for (i in 0..9) {
            result = result.replace(arabic[i], ('0' + i))
        }
        return result
    }

    fun parseToCents(rawInput: String): Result<Long> {
        val trimmed = normalizeArabicDigits(rawInput.trim().replace("$", "").replace("،", ","))
        if (trimmed.isEmpty()) {
            return Result.failure(IllegalArgumentException("يرجى إدخال نتيجة الصفقة."))
        }

        val normalized = trimmed.replace(',', '.')
        val regex = Regex("""^([+-])?(\d+)(?:\.(\d{1,2}))?$""")
        val match = regex.find(normalized)
            ?: return Result.failure(IllegalArgumentException("يرجى إدخال رقم صحيح."))

        val sign = if (match.groupValues[1] == "-") -1L else 1L
        val whole = match.groupValues[2].toLongOrNull()
            ?: return Result.failure(IllegalArgumentException("قيمة عددية غير صحيحة."))
        val fractionPart = match.groupValues[3].padEnd(2, '0').take(2)
        val fraction = fractionPart.toLongOrNull() ?: 0L

        val totalCents = sign * (whole * 100L + fraction)
        if (totalCents == 0L) {
            return Result.failure(IllegalArgumentException("لا يمكن أن تكون نتيجة الصفقة صفراً."))
        }

        return Result.success(totalCents)
    }

    fun parseCapitalToCents(rawInput: String): Result<Long> {
        val trimmed = normalizeArabicDigits(rawInput.trim().replace("$", "").replace("،", ","))
        if (trimmed.isEmpty()) {
            return Result.failure(IllegalArgumentException("يرجى إدخال قيمة صحيحة."))
        }
        val normalized = trimmed.replace(',', '.')
        val regex = Regex("""^(\d+)(?:\.(\d{1,2}))?$""")
        val match = regex.find(normalized)
            ?: return Result.failure(IllegalArgumentException("يرجى إدخال رقم صحيح أكبر من صفر."))

        val whole = match.groupValues[1].toLongOrNull()
            ?: return Result.failure(IllegalArgumentException("قيمة غير صحيحة."))
        val fraction = match.groupValues[2].padEnd(2, '0').take(2).toLongOrNull() ?: 0L
        val totalCents = whole * 100L + fraction

        if (totalCents <= 0L) {
            return Result.failure(IllegalArgumentException("يجب أن تكون القيمة أكبر من صفر."))
        }

        return Result.success(totalCents)
    }

    fun format(cents: Long?, showSign: Boolean = false): String {
        if (cents == null) return "-"
        val isNegative = cents < 0
        val isPositive = cents > 0
        val absCents = Math.abs(cents)
        val dollars = absCents / 100
        val remainder = absCents % 100

        val symbols = DecimalFormatSymbols(Locale.US)
        val df = DecimalFormat("#,##0", symbols)
        val formattedDollars = df.format(dollars)
        val formattedNumber = "$$formattedDollars.${String.format(Locale.US, "%02d", remainder)}"

        return when {
            isNegative -> "-$formattedNumber"
            isPositive && showSign -> "+$formattedNumber"
            else -> formattedNumber
        }
    }

    fun formatDateTime(timestamp: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US)
        return sdf.format(Date(timestamp))
    }

    fun calculateProgress(currentCents: Long, targetCents: Long): Float {
        if (targetCents <= 0L) return 0f
        if (currentCents <= 0L) return 0f
        val pct = (currentCents.toFloat() / targetCents.toFloat()) * 100f
        return pct.coerceIn(0f, 100f)
    }
}
