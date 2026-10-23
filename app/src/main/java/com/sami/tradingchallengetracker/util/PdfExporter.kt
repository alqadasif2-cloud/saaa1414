package com.sami.tradingchallengetracker.util

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import androidx.core.content.FileProvider
import com.sami.tradingchallengetracker.data.ChallengeEntity
import com.sami.tradingchallengetracker.data.TradeEntity
import com.sami.tradingchallengetracker.data.TradeType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import kotlin.math.abs

object PdfExporter {

    private const val PAGE_WIDTH = 595
    private const val PAGE_HEIGHT = 842
    private const val MARGIN = 36f

    /**
     * Generates a genuine multi-page A4 PDF report file in context.cacheDir/reports/Sami_Trading_Report.pdf
     */
    fun createPdfReportFile(
        context: Context,
        challenge: ChallengeEntity,
        trades: List<TradeEntity>
    ): File {
        val reportsDir = File(context.cacheDir, "reports")
        if (!reportsDir.exists() && !reportsDir.mkdirs()) {
            throw IllegalStateException("تعذر إنشاء مجلد التقارير المؤقت.")
        }

        val pdfFile = File(reportsDir, "Sami_Trading_Report.pdf")
        if (pdfFile.exists()) {
            pdfFile.delete()
        }

        var totalProfits = 0L
        var totalLosses = 0L
        var netResult = 0L
        var completedCount = 0
        var failedCount = 0

        for (t in trades) {
            if (t.resultCents > 0) {
                totalProfits += t.resultCents
            } else if (t.resultCents < 0) {
                totalLosses += abs(t.resultCents)
            }
            if (t.type == TradeType.WIN) {
                completedCount++
            } else {
                failedCount++
            }
            netResult += t.resultCents
        }

        val remainingCount = (150 - completedCount).coerceAtLeast(0)
        val progress = Money.calculateProgress(challenge.currentBalanceCents, challenge.targetBalanceCents)
        val reportDate = Money.formatDateTime(System.currentTimeMillis())

        val document = PdfDocument()

        try {
            val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                style = Paint.Style.FILL
            }
            val cardPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#F8FAFC")
                style = Paint.Style.FILL
            }
            val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#CBD5E1")
                style = Paint.Style.STROKE
                strokeWidth = 1f
            }
            val headerBarPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#0F172A")
                style = Paint.Style.FILL
            }
            val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#0F172A")
                textSize = 18f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                textAlign = Paint.Align.CENTER
            }
            val subtitlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#64748B")
                textSize = 10f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
                textAlign = Paint.Align.CENTER
            }
            val sectionTitlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#0F172A")
                textSize = 12f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                textAlign = Paint.Align.RIGHT
            }
            val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#475569")
                textSize = 10.5f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
                textAlign = Paint.Align.RIGHT
            }
            val valuePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#0F172A")
                textSize = 10.5f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                textAlign = Paint.Align.LEFT
            }
            val tableHeaderTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                textSize = 10f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                textAlign = Paint.Align.CENTER
            }
            val cellTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#1E293B")
                textSize = 9.5f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
                textAlign = Paint.Align.CENTER
            }
            val winTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#059669")
                textSize = 9.5f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                textAlign = Paint.Align.CENTER
            }
            val lossTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#DC2626")
                textSize = 9.5f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                textAlign = Paint.Align.CENTER
            }

            var pageNumber = 1
            var pageInfo = PdfDocument.PageInfo.Builder(PAGE_WIDTH, PAGE_HEIGHT, pageNumber).create()
            var page = document.startPage(pageInfo)
            var canvas: Canvas = page.canvas
            canvas.drawRect(0f, 0f, PAGE_WIDTH.toFloat(), PAGE_HEIGHT.toFloat(), bgPaint)

            var y = MARGIN + 16f
            val contentWidth = PAGE_WIDTH - (MARGIN * 2f)
            val rightEdge = PAGE_WIDTH - MARGIN
            val leftEdge = MARGIN

            // Header
            canvas.drawText("Sami • متتبع رحلة التداول الشخصية", PAGE_WIDTH / 2f, y, subtitlePaint)
            y += 22f
            canvas.drawText("تقرير رحلة التداول (150 محطة)", PAGE_WIDTH / 2f, y, titlePaint)
            y += 12f
            canvas.drawLine(leftEdge, y, rightEdge, y, borderPaint)
            y += 20f

            // Trader & Challenge Summary Box
            canvas.drawText("معلومات المتداول والرحلة", rightEdge, y, sectionTitlePaint)
            y += 8f

            val infoBoxHeight = 148f
            val infoRect = RectF(leftEdge, y, rightEdge, y + infoBoxHeight)
            canvas.drawRoundRect(infoRect, 8f, 8f, cardPaint)
            canvas.drawRoundRect(infoRect, 8f, 8f, borderPaint)

            val infoRows = listOf(
                "اسم المتداول:" to challenge.userName.ifBlank { "المتداول" },
                "رأس المال الابتدائي:" to Money.format(challenge.initialCapitalCents),
                "الرصيد الحالي:" to Money.format(challenge.currentBalanceCents),
                "الهدف النهائي:" to Money.format(challenge.targetBalanceCents),
                "نسبة التقدم نحو الهدف:" to "${String.format(Locale.US, "%.2f", progress)}%",
                "الصفقات المنجزة / المتبقية / الفاشلة:" to "منجزة: $completedCount | متبقية: $remainingCount | فاشلة: $failedCount",
                "تاريخ إنشاء التقرير:" to reportDate
            )

            var rowY = y + 18f
            for ((label, value) in infoRows) {
                canvas.drawText(label, rightEdge - 12f, rowY, labelPaint)
                canvas.drawText(value, leftEdge + 12f, rowY, valuePaint)
                rowY += 19f
            }

            y += infoBoxHeight + 20f

            // Performance Summary Box
            canvas.drawText("ملخص الأداء المالي", rightEdge, y, sectionTitlePaint)
            y += 8f

            val statsRect = RectF(leftEdge, y, rightEdge, y + 48f)
            canvas.drawRoundRect(statsRect, 8f, 8f, cardPaint)
            canvas.drawRoundRect(statsRect, 8f, 8f, borderPaint)

            val colWidth = contentWidth / 3f
            // Column 1 (Right): Total Profits
            canvas.drawText("إجمالي الأرباح", rightEdge - (colWidth * 0.5f), y + 18f, subtitlePaint)
            canvas.drawText(Money.format(totalProfits, true), rightEdge - (colWidth * 0.5f), y + 36f, winTextPaint)

            // Column 2 (Center): Total Losses
            val formattedLoss = if (totalLosses > 0L) "-${Money.format(totalLosses)}" else "$0.00"
            canvas.drawText("إجمالي الخسائر", PAGE_WIDTH / 2f, y + 18f, subtitlePaint)
            canvas.drawText(formattedLoss, PAGE_WIDTH / 2f, y + 36f, lossTextPaint)

            // Column 3 (Left): Net Result
            canvas.drawText("صافي النتائج", leftEdge + (colWidth * 0.5f), y + 18f, subtitlePaint)
            val netPaint = if (netResult >= 0L) winTextPaint else lossTextPaint
            canvas.drawText(Money.format(netResult, true), leftEdge + (colWidth * 0.5f), y + 36f, netPaint)

            y += 68f

            // Trades Table Header helper
            fun drawTradesTableHeader(targetCanvas: Canvas, topY: Float): Float {
                val headerRect = RectF(leftEdge, topY, rightEdge, topY + 24f)
                targetCanvas.drawRoundRect(headerRect, 4f, 4f, headerBarPaint)

                val c1 = rightEdge - (contentWidth * 0.08f)
                val c2 = rightEdge - (contentWidth * 0.25f)
                val c3 = rightEdge - (contentWidth * 0.46f)
                val c4 = rightEdge - (contentWidth * 0.68f)
                val c5 = rightEdge - (contentWidth * 0.89f)

                val textY = topY + 16f
                targetCanvas.drawText("#", c1, textY, tableHeaderTextPaint)
                targetCanvas.drawText("النتيجة", c2, textY, tableHeaderTextPaint)
                targetCanvas.drawText("الرصيد السابق", c3, textY, tableHeaderTextPaint)
                targetCanvas.drawText("الرصيد الجديد", c4, textY, tableHeaderTextPaint)
                targetCanvas.drawText("التاريخ", c5, textY, tableHeaderTextPaint)

                return topY + 24f
            }

            canvas.drawText("سجل الصفقات (${trades.size})", rightEdge, y, sectionTitlePaint)
            y += 8f
            y = drawTradesTableHeader(canvas, y)

            if (trades.isEmpty()) {
                val emptyRect = RectF(leftEdge, y, rightEdge, y + 36f)
                canvas.drawRect(emptyRect, cardPaint)
                canvas.drawRect(emptyRect, borderPaint)
                canvas.drawText("لا توجد صفقات مسجلة حتى الآن", PAGE_WIDTH / 2f, y + 22f, subtitlePaint)
            } else {
                val rowHeight = 22f
                val maxBottomY = PAGE_HEIGHT - MARGIN - 24f

                val c1 = rightEdge - (contentWidth * 0.08f)
                val c2 = rightEdge - (contentWidth * 0.25f)
                val c3 = rightEdge - (contentWidth * 0.46f)
                val c4 = rightEdge - (contentWidth * 0.68f)
                val c5 = rightEdge - (contentWidth * 0.89f)

                for ((index, t) in trades.withIndex()) {
                    if (y + rowHeight > maxBottomY) {
                        document.finishPage(page)
                        pageNumber++
                        pageInfo = PdfDocument.PageInfo.Builder(PAGE_WIDTH, PAGE_HEIGHT, pageNumber).create()
                        page = document.startPage(pageInfo)
                        canvas = page.canvas
                        canvas.drawRect(0f, 0f, PAGE_WIDTH.toFloat(), PAGE_HEIGHT.toFloat(), bgPaint)
                        y = MARGIN
                        y = drawTradesTableHeader(canvas, y)
                    }

                    if (index % 2 == 1) {
                        canvas.drawRect(leftEdge, y, rightEdge, y + rowHeight, cardPaint)
                    }
                    canvas.drawLine(leftEdge, y + rowHeight, rightEdge, y + rowHeight, borderPaint)

                    val textY = y + 15f
                    val isWin = t.type == TradeType.WIN
                    canvas.drawText("${t.tradeNumber}", c1, textY, cellTextPaint)
                    canvas.drawText(
                        Money.format(t.resultCents, true),
                        c2,
                        textY,
                        if (isWin) winTextPaint else lossTextPaint
                    )
                    canvas.drawText(Money.format(t.oldBalanceCents), c3, textY, cellTextPaint)
                    canvas.drawText(Money.format(t.newBalanceCents), c4, textY, cellTextPaint)
                    canvas.drawText(Money.formatDateTime(t.timestamp), c5, textY, cellTextPaint)

                    y += rowHeight
                }
            }

            document.finishPage(page)

            FileOutputStream(pdfFile).use { out ->
                document.writeTo(out)
                out.flush()
            }
        } finally {
            document.close()
        }

        if (!pdfFile.exists() || pdfFile.length() <= 0L) {
            throw IllegalStateException("تعذر إنشاء ملف PDF للتقرير.")
        }

        return pdfFile
    }

    /**
     * Generates the PDF report on IO thread and launches the Android share sheet safely on Main thread.
     */
    suspend fun shareReport(
        context: Context,
        challenge: ChallengeEntity,
        trades: List<TradeEntity>,
        onError: (String) -> Unit = {}
    ) {
        try {
            val pdfFile = withContext(Dispatchers.IO) {
                createPdfReportFile(context, challenge, trades)
            }

            val authority = "${context.packageName}.fileprovider"
            val uri = FileProvider.getUriForFile(context, authority, pdfFile)

            withContext(Dispatchers.Main) {
                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                    type = "application/pdf"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    putExtra(Intent.EXTRA_SUBJECT, "تقرير رحلة التداول - Sami")
                    putExtra(
                        Intent.EXTRA_TEXT,
                        "تقرير رحلة التداول (${challenge.userName.ifBlank { "المتداول" }})"
                    )
                    clipData = ClipData.newRawUri("Sami_Trading_Report.pdf", uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }

                val chooserIntent = Intent.createChooser(shareIntent, "مشاركة تقرير رحلة التداول (PDF)").apply {
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    if (context !is Activity) {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                }

                // Explicitly grant URI permission to resolved activities for older Android versions (API 24-29)
                try {
                    val resInfoList = context.packageManager.queryIntentActivities(
                        shareIntent,
                        PackageManager.MATCH_DEFAULT_ONLY
                    )
                    for (resolveInfo in resInfoList) {
                        val packageName = resolveInfo.activityInfo?.packageName ?: continue
                        context.grantUriPermission(
                            packageName,
                            uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                        )
                    }
                } catch (_: Exception) {
                }

                context.startActivity(chooserIntent)
            }
        } catch (t: Throwable) {
            withContext(Dispatchers.Main) {
                onError("تعذر مشاركة التقرير: ${t.localizedMessage ?: "خطأ غير متوقع"}")
            }
        }
    }
}
