package com.sami.tradingchallengetracker.util

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.sami.tradingchallengetracker.MainActivity
import com.sami.tradingchallengetracker.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class SamiFirebaseMessagingService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "SamiFCM"
        const val CHANNEL_ID_CHANNELS = "sami_channel_messages"
        const val CHANNEL_ID_PRIVATE = "sami_private_messages"
        const val CHANNEL_ID_ALERTS = "sami_important_alerts"

        const val PREFS_NAME = "sami_fcm_prefs"
        const val KEY_FCM_TOKEN = "fcm_token"
        const val KEY_CURRENT_USER_ID = "sami_current_user_id"
        const val KEY_CURRENT_USERNAME = "sami_current_username"

        fun createNotificationChannels(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val notificationManager =
                    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

                val soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                val audioAttributes = AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
                    .build()

                // 1. Channel messages
                val channelsChannel = NotificationChannel(
                    CHANNEL_ID_CHANNELS,
                    "رسائل قنوات Sami",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "إشعارات الرسائل والتحليلات الجديدة في قنوات التداول"
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 150, 100, 150)
                    setSound(soundUri, audioAttributes)
                    setShowBadge(true)
                }

                // 2. Private messages & Sami Owner Direct
                val privateChannel = NotificationChannel(
                    CHANNEL_ID_PRIVATE,
                    "الرسائل الخاصة والقائد Sami",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "إشعارات المحادثات المباشرة مع القائد Sami والمشرفين"
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 200, 100, 200)
                    setSound(soundUri, audioAttributes)
                    setShowBadge(true)
                }

                // 3. System Alerts
                val alertsChannel = NotificationChannel(
                    CHANNEL_ID_ALERTS,
                    "تنبيهات هامة وإدارية",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "تنبيهات التحديثات والاشتراكات والإنذارات الإدارية"
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 250, 120, 250)
                    setSound(soundUri, audioAttributes)
                    setShowBadge(true)
                }

                notificationManager.createNotificationChannels(
                    listOf(channelsChannel, privateChannel, alertsChannel)
                )
            }
        }

        fun saveCurrentSession(context: Context, userId: Int, username: String) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putInt(KEY_CURRENT_USER_ID, userId)
                .putString(KEY_CURRENT_USERNAME, username)
                .apply()
        }

        fun clearCurrentSession(context: Context) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .remove(KEY_CURRENT_USER_ID)
                .remove(KEY_CURRENT_USERNAME)
                .apply()
        }

        fun getSavedToken(context: Context): String? {
            return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_FCM_TOKEN, null)
        }
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "New FCM Token received: $token")

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_FCM_TOKEN, token).apply()

        val userId = prefs.getInt(KEY_CURRENT_USER_ID, 0)
        val username = prefs.getString(KEY_CURRENT_USERNAME, "") ?: ""

        if (userId > 0) {
            syncTokenToFirestore(userId, username, token)
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        Log.d(TAG, "FCM message received from: ${remoteMessage.from}")

        val data = remoteMessage.data
        val title = data["title"]
            ?: remoteMessage.notification?.title
            ?: "تطبيق Sami للتداول"
        val body = data["body"]
            ?: remoteMessage.notification?.body
            ?: "وصلتك رسالة جديدة"

        val channelId = data["channelId"]
        val partnerId = data["partnerId"]?.toIntOrNull()
        val chatType = data["chatType"] ?: if (partnerId != null) "private" else "channel"
        val messageId = data["messageId"]
        val senderId = data["senderId"]?.toIntOrNull()
        val senderName = data["senderName"]

        // If message is from current user, don't show self-notification
        val currentUserId = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getInt(KEY_CURRENT_USER_ID, 0)
        if (senderId != null && senderId == currentUserId && currentUserId > 0) {
            return
        }

        showSystemNotification(
            title = title,
            body = body,
            channelId = channelId,
            partnerId = partnerId,
            chatType = chatType,
            messageId = messageId,
            senderName = senderName
        )
    }

    private fun showSystemNotification(
        title: String,
        body: String,
        channelId: String?,
        partnerId: Int?,
        chatType: String,
        messageId: String?,
        senderName: String?
    ) {
        createNotificationChannels(this)

        val targetChannelId = if (chatType == "private") {
            CHANNEL_ID_PRIVATE
        } else {
            CHANNEL_ID_CHANNELS
        }

        // Deep link Intent to open MainActivity and jump straight to the conversation/channel/message
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("deep_link_source", "fcm_notification")
            putExtra("channelId", channelId)
            if (partnerId != null) putExtra("partnerId", partnerId)
            putExtra("chatType", chatType)
            if (messageId != null) putExtra("messageId", messageId)
            if (senderName != null) putExtra("senderName", senderName)
        }

        val requestCode = (System.currentTimeMillis() % 100000).toInt()
        val pendingIntent = PendingIntent.getActivity(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

        val builder = NotificationCompat.Builder(this, targetChannelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setColor(0xFFFFD700.toInt()) // Royal Gold
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setSound(soundUri)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(pendingIntent)

        val notificationManager = NotificationManagerCompat.from(this)
        try {
            val notificationId = (messageId?.hashCode() ?: System.currentTimeMillis().toInt()) and 0x7FFFFFFF
            notificationManager.notify(notificationId, builder.build())
        } catch (e: SecurityException) {
            Log.w(TAG, "Notification permission denied: ${e.message}")
        }
    }

    private fun syncTokenToFirestore(userId: Int, username: String, token: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val db = FirebaseCloudHelper.getFirestore(applicationContext)
                val deviceId = getDeviceId(applicationContext)
                val docId = "token_${userId}_${deviceId}"
                val now = System.currentTimeMillis()

                val payload = hashMapOf(
                    "id" to docId,
                    "token" to token,
                    "userId" to userId,
                    "username" to username,
                    "deviceId" to deviceId,
                    "platform" to "android",
                    "deviceModel" to "${Build.MANUFACTURER} ${Build.MODEL}",
                    "updatedAt" to now,
                    "createdAt" to now
                )

                db.collection("user_fcm_tokens").document(docId).set(payload)
                Log.d(TAG, "Successfully synced FCM token to Firestore for user $userId")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to sync FCM token to Firestore: ${e.message}")
            }
        }
    }

    private fun getDeviceId(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        var devId = prefs.getString("sami_device_unique_id", null)
        if (devId == null) {
            devId = "dev_android_${System.currentTimeMillis()}_${java.util.UUID.randomUUID().toString().substring(0, 8)}"
            prefs.edit().putString("sami_device_unique_id", devId).apply()
        }
        return devId
    }
}
