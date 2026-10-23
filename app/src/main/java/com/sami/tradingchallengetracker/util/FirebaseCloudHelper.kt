package com.sami.tradingchallengetracker.util

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.storage.FirebaseStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

object FirebaseCloudHelper {
    private const val PROJECT_ID = "majestic-interface-ksmzh"
    private const val APP_ID = "1:462035009117:web:ef127abfd25d8ff2ec17b4"
    private const val API_KEY = "AIzaSyAR7YwgIFze6BcmUm7WTCSM30crDrMSTKk"
    private const val STORAGE_BUCKET = "majestic-interface-ksmzh.firebasestorage.app"
    private const val FIRESTORE_DB_ID = "ai-studio-c1d1b606-9578-42a6-b7b2-17faaec47f72"

    private val mediaByteCache = ConcurrentHashMap<String, ByteArray>()

    @Synchronized
    fun ensureInitialized(context: Context): FirebaseApp {
        val existing = FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
        if (existing != null) return existing

        val options = FirebaseOptions.Builder()
            .setProjectId(PROJECT_ID)
            .setApplicationId(APP_ID)
            .setApiKey(API_KEY)
            .setStorageBucket(STORAGE_BUCKET)
            .build()

        return FirebaseApp.initializeApp(context.applicationContext, options)
    }

    fun getFirestore(context: Context): FirebaseFirestore {
        val app = ensureInitialized(context)
        return try {
            FirebaseFirestore.getInstance(app, FIRESTORE_DB_ID)
        } catch (_: Exception) {
            FirebaseFirestore.getInstance(app)
        }
    }

    fun getStorage(context: Context): FirebaseStorage {
        val app = ensureInitialized(context)
        return FirebaseStorage.getInstance(app)
    }

    fun createCameraOutputUri(context: Context): Uri {
        val cameraDir = File(context.cacheDir, "camera_captures").apply { mkdirs() }
        val file = File(cameraDir, "capture_${System.currentTimeMillis()}.jpg")
        return FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            file
        )
    }

    private fun compressUriToJpegBytes(context: Context, uri: Uri, maxDim: Int = 1920, quality: Int = 90): ByteArray {
        val rotationDegrees = try {
            context.contentResolver.openInputStream(uri)?.use { exifStream ->
                val exif = ExifInterface(exifStream)
                when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> 0f
                }
            } ?: 0f
        } catch (_: Exception) {
            0f
        }

        val inputStream = context.contentResolver.openInputStream(uri)
            ?: throw IllegalArgumentException("تعذر فتح ملف الصورة")
        val decoded = inputStream.use { BitmapFactory.decodeStream(it) }
            ?: throw IllegalArgumentException("تعذر قراءة الصورة")

        val oriented = if (rotationDegrees != 0f) {
            try {
                val matrix = Matrix().apply { postRotate(rotationDegrees) }
                Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
            } catch (_: Exception) {
                decoded
            }
        } else {
            decoded
        }

        var width = oriented.width
        var height = oriented.height
        if (width > height) {
            if (width > maxDim) {
                height = ((height.toFloat() * maxDim.toFloat()) / width.toFloat()).toInt().coerceAtLeast(1)
                width = maxDim
            }
        } else {
            if (height > maxDim) {
                width = ((width.toFloat() * maxDim.toFloat()) / height.toFloat()).toInt().coerceAtLeast(1)
                height = maxDim
            }
        }

        val scaled = if (width != oriented.width || height != oriented.height) {
            Bitmap.createScaledBitmap(oriented, width, height, true)
        } else {
            oriented
        }

        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
        var bytes = out.toByteArray()

        // Ensure payload stays within Firestore document limits if fallback storage is used
        if (bytes.size > 700_000) {
            val fallbackOut = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 80, fallbackOut)
            bytes = fallbackOut.toByteArray()
        }
        return bytes
    }

    suspend fun uploadImageToCloud(
        context: Context,
        imageUri: Uri,
        folder: String,
        uploaderId: Int
    ): Pair<String, String> = withContext(Dispatchers.IO) {
        val jpegBytes = compressUriToJpegBytes(context, imageUri, 1920, 90)
        val now = System.currentTimeMillis()
        val mediaId = "${folder}_${uploaderId}_${now}_${UUID.randomUUID().toString().take(6)}"
        val storagePath = "$folder/$mediaId.jpg"

        mediaByteCache[mediaId] = jpegBytes

        try {
            withTimeout(3500L) {
                val storageRef = getStorage(context).reference.child(storagePath)
                storageRef.putBytes(jpegBytes).await()
                val downloadUrl = storageRef.downloadUrl.await().toString()
                Pair(downloadUrl, storagePath)
            }
        } catch (_: Exception) {
            val base64Str = Base64.encodeToString(jpegBytes, Base64.NO_WRAP)
            val dataUrl = "data:image/jpeg;base64,$base64Str"

            val db = getFirestore(context)
            db.collection("media_files").document(mediaId).set(
                mapOf(
                    "id" to mediaId,
                    "dataUrl" to dataUrl,
                    "folder" to folder,
                    "uploaderId" to uploaderId,
                    "createdAt" to now
                )
            ).await()

            val encodedPath = URLEncoder.encode(storagePath, "UTF-8")
            val encodedMediaId = URLEncoder.encode(mediaId, "UTF-8")
            val cloudUrl = "https://firebasestorage.googleapis.com/v0/b/$STORAGE_BUCKET/o/$encodedPath?alt=media&mediaId=$encodedMediaId"
            Pair(cloudUrl, storagePath)
        }
    }

    fun extractMediaId(url: String?): String? {
        if (url.isNullOrBlank()) return null
        if (url.startsWith("cloud-media://")) {
            return url.removePrefix("cloud-media://").trim()
        }
        val regex = Regex("[?&]mediaId=([^&]+)")
        val match = regex.find(url)
        return match?.groupValues?.getOrNull(1)
    }

    fun extractStoragePath(url: String?): String? {
        if (url.isNullOrBlank()) return null
        val regex = Regex("/o/([^?]+)")
        val match = regex.find(url) ?: return null
        return try {
            java.net.URLDecoder.decode(match.groupValues[1], "UTF-8")
        } catch (_: Exception) {
            null
        }
    }

    suspend fun resolveImageModel(context: Context, url: String?): Any? = withContext(Dispatchers.IO) {
        if (url.isNullOrBlank()) return@withContext null
        val mediaId = extractMediaId(url) ?: return@withContext url

        mediaByteCache[mediaId]?.let { return@withContext it }

        try {
            val snap = getFirestore(context).collection("media_files").document(mediaId).get().await()
            if (!snap.exists()) return@withContext null
            val dataUrl = snap.getString("dataUrl")
            if (!dataUrl.isNullOrBlank() && dataUrl.contains(",")) {
                val base64Part = dataUrl.substringAfter(",")
                val bytes = Base64.decode(base64Part, Base64.DEFAULT)
                mediaByteCache[mediaId] = bytes
                return@withContext bytes
            }
        } catch (_: Exception) {
        }
        return@withContext url
    }

    suspend fun resolveImageBytes(context: Context, url: String?): ByteArray? = withContext(Dispatchers.IO) {
        if (url.isNullOrBlank()) return@withContext null

        // 1. Check mediaId in memory cache or Firestore media_files
        val mediaId = extractMediaId(url)
        if (!mediaId.isNullOrBlank()) {
            mediaByteCache[mediaId]?.let { return@withContext it }
            try {
                val snap = getFirestore(context).collection("media_files").document(mediaId).get().await()
                if (snap.exists()) {
                    val dataUrl = snap.getString("dataUrl")
                    if (!dataUrl.isNullOrBlank() && dataUrl.contains(",")) {
                        val base64Part = dataUrl.substringAfter(",")
                        val bytes = Base64.decode(base64Part, Base64.DEFAULT)
                        mediaByteCache[mediaId] = bytes
                        return@withContext bytes
                    }
                }
            } catch (_: Exception) {
            }
        }

        // 2. Check if data URL directly
        if (url.startsWith("data:") && url.contains(",")) {
            return@withContext try {
                val base64Part = url.substringAfter(",")
                Base64.decode(base64Part, Base64.DEFAULT)
            } catch (_: Exception) {
                null
            }
        }

        // 3. Check if content:// or file:// URI
        if (url.startsWith("content://") || url.startsWith("file://")) {
            return@withContext try {
                context.contentResolver.openInputStream(Uri.parse(url))?.use { it.readBytes() }
            } catch (_: Exception) {
                null
            }
        }

        // 4. Try Firebase Storage path if available
        val storagePath = extractStoragePath(url)
        if (!storagePath.isNullOrBlank()) {
            try {
                val bytes = getStorage(context).reference.child(storagePath).getBytes(15L * 1024L * 1024L).await()
                if (bytes.isNotEmpty()) return@withContext bytes
            } catch (_: Exception) {
            }
        }

        // 5. Fallback to direct HTTP/HTTPS stream download
        if (url.startsWith("http://") || url.startsWith("https://")) {
            return@withContext try {
                val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 8000
                    readTimeout = 8000
                    doInput = true
                    connect()
                }
                connection.inputStream.use { it.readBytes() }
            } catch (_: Exception) {
                null
            }
        }

        return@withContext null
    }

    suspend fun saveImageToGallery(context: Context, imageUrl: String?): Result<String> = withContext(Dispatchers.IO) {
        try {
            if (imageUrl.isNullOrBlank()) {
                return@withContext Result.failure(IllegalArgumentException("رابط الصورة غير صالح"))
            }

            val bytes = resolveImageBytes(context, imageUrl)
                ?: return@withContext Result.failure(IllegalStateException("تعذر تحميل بيانات الصورة لحفظها"))

            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                ?: return@withContext Result.failure(IllegalStateException("تعذر معالجة ملف الصورة"))

            val fileName = "Sami_Chat_${System.currentTimeMillis()}.jpg"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = context.contentResolver
                val contentValues = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/SamiTrading")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
                val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                val itemUri = resolver.insert(collection, contentValues)
                    ?: return@withContext Result.failure(IllegalStateException("تعذر إنشاء ملف الصورة في المعرض"))

                resolver.openOutputStream(itemUri)?.use { outStream ->
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 95, outStream)
                    outStream.flush()
                } ?: return@withContext Result.failure(IllegalStateException("تعذر كتابة الصورة في المعرض"))

                contentValues.clear()
                contentValues.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(itemUri, contentValues, null, null)
            } else {
                @Suppress("DEPRECATION")
                val picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
                val appDir = File(picturesDir, "SamiTrading").apply {
                    if (!exists()) mkdirs()
                }
                val outFile = File(appDir, fileName)
                FileOutputStream(outFile).use { outStream ->
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 95, outStream)
                    outStream.flush()
                }
                MediaScannerConnection.scanFile(
                    context,
                    arrayOf(outFile.absolutePath),
                    arrayOf("image/jpeg"),
                    null
                )
            }

            Result.success("تم حفظ الصورة في المعرض بنجاح")
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteCloudImage(context: Context, imageUrl: String?, storagePath: String? = null) = withContext(Dispatchers.IO) {
        val resolvedPath = storagePath ?: extractStoragePath(imageUrl)
        if (!resolvedPath.isNullOrBlank()) {
            try {
                getStorage(context).reference.child(resolvedPath).delete().await()
            } catch (_: Exception) {
            }
        }
        val mediaId = extractMediaId(imageUrl)
        if (!mediaId.isNullOrBlank()) {
            mediaByteCache.remove(mediaId)
            try {
                getFirestore(context).collection("media_files").document(mediaId).delete().await()
            } catch (_: Exception) {
            }
        }
    }

    suspend fun deleteMultipleCloudImages(context: Context, imageUrls: List<String?>) = withContext(Dispatchers.IO) {
        imageUrls.filter { !it.isNullOrBlank() }.forEach { url ->
            deleteCloudImage(context, url, null)
        }
    }

    suspend fun syncUserChallengeToFirestore(
        context: Context,
        userId: Int,
        challenge: com.sami.tradingchallengetracker.data.ChallengeEntity,
        trades: List<com.sami.tradingchallengetracker.data.TradeEntity>
    ) = withContext(Dispatchers.IO) {
        try {
            val completedCount = trades.count { it.type == com.sami.tradingchallengetracker.data.TradeType.WIN }
            val failedCount = trades.count { it.type == com.sami.tradingchallengetracker.data.TradeType.LOSS }
            val remainingCount = (150 - completedCount).coerceAtLeast(0)

            val challengeMap = mapOf(
                "id" to challenge.id,
                "userName" to challenge.userName,
                "initialCapitalCents" to challenge.initialCapitalCents,
                "currentBalanceCents" to challenge.currentBalanceCents,
                "targetBalanceCents" to challenge.targetBalanceCents,
                "tradeCount" to challenge.tradeCount,
                "challengeStarted" to challenge.challengeStarted,
                "createdAt" to challenge.createdAt,
                "updatedAt" to challenge.updatedAt
            )
            val tradesList = trades.map { t ->
                mapOf(
                    "id" to t.id,
                    "challengeId" to t.challengeId,
                    "tradeNumber" to t.tradeNumber,
                    "resultCents" to t.resultCents,
                    "oldBalanceCents" to t.oldBalanceCents,
                    "newBalanceCents" to t.newBalanceCents,
                    "type" to t.type.name,
                    "attachmentPath" to t.attachmentPath,
                    "timestamp" to t.timestamp
                )
            }
            val totalMilestones = 150 + failedCount
            val milestonesList = (1..totalMilestones).map { num ->
                val trade = trades.find { it.tradeNumber == num }
                mapOf(
                    "id" to "${challenge.id}_milestone_$num",
                    "challengeId" to challenge.id,
                    "milestoneNumber" to num,
                    "profitCents" to trade?.resultCents,
                    "balanceCents" to trade?.newBalanceCents,
                    "status" to (trade?.type?.name ?: "PENDING"),
                    "tradeId" to trade?.id,
                    "timestamp" to trade?.timestamp,
                    "attachmentPath" to trade?.attachmentPath
                )
            }
            getFirestore(context).collection("user_challenges").document(userId.toString()).set(
                mapOf(
                    "userId" to userId,
                    "username" to challenge.userName,
                    "challenge" to challengeMap,
                    "completedCount" to completedCount,
                    "remainingCount" to remainingCount,
                    "failedCount" to failedCount,
                    "trades" to tradesList,
                    "milestones" to milestonesList,
                    "settings" to mapOf(
                        "userName" to challenge.userName,
                        "initialCapitalCents" to challenge.initialCapitalCents,
                        "targetBalanceCents" to challenge.targetBalanceCents
                    ),
                    "updatedAt" to challenge.updatedAt
                )
            ).await()
        } catch (_: Exception) {
        }
    }

    suspend fun fetchUserChallengeFromFirestore(
        context: Context,
        userId: Int
    ): Pair<com.sami.tradingchallengetracker.data.ChallengeEntity, List<com.sami.tradingchallengetracker.data.TradeEntity>>? = withContext(Dispatchers.IO) {
        try {
            val snap = getFirestore(context).collection("user_challenges").document(userId.toString()).get().await()
            if (!snap.exists()) return@withContext null
            val data = snap.data ?: return@withContext null
            val chMap = data["challenge"] as? Map<*, *> ?: return@withContext null

            val chId = chMap["id"] as? String ?: return@withContext null
            val challenge = com.sami.tradingchallengetracker.data.ChallengeEntity(
                id = chId,
                userId = userId,
                userName = (chMap["userName"] as? String) ?: "",
                initialCapitalCents = (chMap["initialCapitalCents"] as? Number)?.toLong() ?: 10000L,
                currentBalanceCents = (chMap["currentBalanceCents"] as? Number)?.toLong() ?: 10000L,
                targetBalanceCents = (chMap["targetBalanceCents"] as? Number)?.toLong() ?: 300000L,
                tradeCount = (chMap["tradeCount"] as? Number)?.toInt() ?: 0,
                challengeStarted = (chMap["challengeStarted"] as? Boolean) ?: false,
                createdAt = (chMap["createdAt"] as? Number)?.toLong() ?: System.currentTimeMillis(),
                updatedAt = (chMap["updatedAt"] as? Number)?.toLong() ?: System.currentTimeMillis()
            )

            val rawTrades = data["trades"] as? List<*> ?: emptyList<Any>()
            val trades = rawTrades.mapNotNull { item ->
                val m = item as? Map<*, *> ?: return@mapNotNull null
                val tId = m["id"] as? String ?: return@mapNotNull null
                val typeStr = m["type"] as? String ?: "WIN"
                com.sami.tradingchallengetracker.data.TradeEntity(
                    id = tId,
                    challengeId = chId,
                    tradeNumber = (m["tradeNumber"] as? Number)?.toInt() ?: 1,
                    resultCents = (m["resultCents"] as? Number)?.toLong() ?: 0L,
                    oldBalanceCents = (m["oldBalanceCents"] as? Number)?.toLong() ?: 0L,
                    newBalanceCents = (m["newBalanceCents"] as? Number)?.toLong() ?: 0L,
                    type = if (typeStr == "LOSS") com.sami.tradingchallengetracker.data.TradeType.LOSS else com.sami.tradingchallengetracker.data.TradeType.WIN,
                    attachmentPath = m["attachmentPath"] as? String,
                    timestamp = (m["timestamp"] as? Number)?.toLong() ?: System.currentTimeMillis()
                )
            }
            Pair(challenge, trades)
        } catch (_: Exception) {
            null
        }
    }
}

@Composable
fun CloudAsyncImage(
    imageUrl: String?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var resolvedModel by remember(imageUrl) { mutableStateOf<Any?>(null) }
    var isLoading by remember(imageUrl) { mutableStateOf(!imageUrl.isNullOrBlank()) }

    LaunchedEffect(imageUrl) {
        if (imageUrl.isNullOrBlank()) {
            resolvedModel = null
            isLoading = false
        } else {
            isLoading = true
            resolvedModel = FirebaseCloudHelper.resolveImageModel(context, imageUrl)
            isLoading = false
        }
    }

    if (isLoading || resolvedModel == null) {
        Box(
            modifier = modifier.background(Color(0xFF0F172A)),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = Color(0xFFFFD700)
            )
        }
    } else {
        AsyncImage(
            model = resolvedModel,
            contentDescription = contentDescription,
            modifier = modifier,
            contentScale = contentScale
        )
    }
}
