/**
 * Firebase Cloud Messaging (FCM) & Device Token Manager
 * Supports:
 * - Android Native FCM Token Sync via Javascript Interface (SamiBridge)
 * - Device Token Lifecycle (Multi-device, Login, Switch Account, Logout)
 * - Deep Link Routing for Messages, Channels, and Sami Direct Chats
 * - Outgoing Push Dispatch Queue (fcm_outbox) for serverless & backend FCM execution
 * - PWA Service Worker Push Notifications
 */

import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from './firebase';

export const FCM_TOKENS_COLLECTION = 'user_fcm_tokens';
export const FCM_OUTBOX_COLLECTION = 'fcm_outbox';
const DEVICE_ID_STORAGE_KEY = 'sami_device_unique_id';

export interface SamiAndroidBridge {
  getFcmToken?: () => string;
  checkNotificationPermission?: () => boolean;
  requestNotificationPermission?: () => void;
  openNotificationSettings?: () => void;
  syncUserSession?: (userId: number, username: string) => void;
  onLogout?: () => void;
}

declare global {
  interface Window {
    SamiBridge?: SamiAndroidBridge;
    registerAndroidFcmToken?: (token: string, userId: number, username: string) => void;
    dispatchNotificationDeepLink?: (detail: {
      channelId?: string | null;
      partnerId?: number | null;
      chatType?: 'channel' | 'private';
      messageId?: string | null;
      senderName?: string;
    }) => void;
  }
}

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'unknown_device';
  let devId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!devId) {
    devId = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, devId);
  }
  return devId;
}

/**
 * Registers an FCM token for the currently logged-in user in Firestore.
 * Supports multiple devices per user account.
 */
export async function registerUserFcmToken(
  userId: number,
  username: string,
  token: string,
  platform: 'android' | 'web' = 'android'
): Promise<void> {
  if (!userId || !token) return;
  const deviceId = getOrCreateDeviceId();
  const docId = `token_${userId}_${deviceId}`;
  const now = Date.now();

  try {
    await setDoc(
      doc(db, FCM_TOKENS_COLLECTION, docId),
      {
        id: docId,
        token,
        userId,
        username,
        deviceId,
        platform,
        deviceModel:
          typeof navigator !== 'undefined'
            ? navigator.userAgent.substring(0, 100)
            : 'unknown',
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[FCM] Error saving token to Firestore:', err);
  }
}

/**
 * Removes or unlinks the FCM token when a user logs out so this device stops receiving that user's notifications.
 */
export async function unregisterUserFcmToken(userId: number): Promise<void> {
  if (!userId) return;
  const deviceId = getOrCreateDeviceId();
  const docId = `token_${userId}_${deviceId}`;
  try {
    await deleteDoc(doc(db, FCM_TOKENS_COLLECTION, docId));
  } catch {
    // Ignore delete errors
  }

  // Notify native Android layer if present
  if (typeof window !== 'undefined' && window.SamiBridge?.onLogout) {
    try {
      window.SamiBridge.onLogout();
    } catch {
      // Ignore
    }
  }
}

/**
 * Syncs user session to native Android bridge (so the native FCM service knows the active user).
 */
export function syncUserSessionToNative(userId: number, username: string): void {
  if (typeof window === 'undefined') return;
  if (window.SamiBridge?.syncUserSession) {
    try {
      window.SamiBridge.syncUserSession(userId, username);
    } catch (e) {
      console.warn('[FCM] Error syncing session to native bridge', e);
    }
  }

  // Also, if Android bridge has a saved token, register it in Firestore immediately
  if (window.SamiBridge?.getFcmToken) {
    try {
      const nativeToken = window.SamiBridge.getFcmToken();
      if (nativeToken) {
        void registerUserFcmToken(userId, username, nativeToken, 'android');
      }
    } catch {
      // Ignore
    }
  }
}

/**
 * Checks system notification permissions and returns status.
 */
export function checkNotificationPermissionStatus(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (typeof window === 'undefined') return 'unsupported';

  // Check native Android bridge first
  if (window.SamiBridge?.checkNotificationPermission) {
    try {
      const isGranted = window.SamiBridge.checkNotificationPermission();
      return isGranted ? 'granted' : 'denied';
    } catch {
      // Fallback to web
    }
  }

  if (!('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Requests notification permission from user with graceful fallback.
 */
export async function requestNotificationPermission(): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  if (typeof window === 'undefined') return 'unsupported';

  // Check if running inside Android WebView with bridge
  if (window.SamiBridge?.requestNotificationPermission) {
    try {
      window.SamiBridge.requestNotificationPermission();
      // Give time for prompt, then re-check
      const granted = window.SamiBridge.checkNotificationPermission?.() ?? false;
      return granted ? 'granted' : 'denied';
    } catch {
      // Fallback
    }
  }

  if (!('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const perm = await Notification.requestPermission();
    return perm;
  } catch {
    return 'denied';
  }
}

/**
 * Opens system app notification settings (e.g. if notifications were blocked by Android OS).
 */
export function openAppNotificationSettings(): void {
  if (typeof window === 'undefined') return;
  if (window.SamiBridge?.openNotificationSettings) {
    try {
      window.SamiBridge.openNotificationSettings();
    } catch {
      // Ignore
    }
  }
}

/**
 * Dispatches deep link navigation event into the app.
 */
export function dispatchNotificationDeepLink(detail: {
  channelId?: string | null;
  partnerId?: number | null;
  chatType?: 'channel' | 'private';
  messageId?: string | null;
  senderName?: string;
}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('app_open_chat_message', { detail }));
}

/**
 * Dispatches an FCM push notification task to the devices of the target recipient users.
 * Writes to Firestore collection `fcm_outbox` so any server-side dispatcher / cloud worker sends real push messages,
 * and also looks up recipient FCM tokens.
 */
export async function dispatchPushNotificationToRecipients(params: {
  title: string;
  body: string;
  targetUserIds: number[];
  senderId: number;
  senderName: string;
  channelId?: string | null;
  partnerId?: number | null;
  chatType?: 'channel' | 'private';
  messageId?: string | null;
}): Promise<void> {
  const { targetUserIds, senderId } = params;
  const filteredTargets = targetUserIds.filter((id) => id > 0 && id !== senderId);
  if (filteredTargets.length === 0) return;

  try {
    const now = Date.now();
    const outboxId = `fcm_${now}_${senderId}_${Math.random().toString(36).substring(2, 8)}`;

    // Query active device tokens for target users
    const tokensSnap = await getDocs(
      query(
        collection(db, FCM_TOKENS_COLLECTION),
        where('userId', 'in', filteredTargets.slice(0, 30))
      )
    );

    const recipientTokens: string[] = [];
    tokensSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (typeof data.token === 'string' && data.token.trim()) {
        recipientTokens.push(data.token.trim());
      }
    });

    // Write push dispatch job to fcm_outbox
    await setDoc(doc(db, FCM_OUTBOX_COLLECTION, outboxId), {
      id: outboxId,
      title: params.title,
      body: params.body,
      targetUserIds: filteredTargets,
      recipientTokens: Array.from(new Set(recipientTokens)),
      senderId: params.senderId,
      senderName: params.senderName,
      channelId: params.channelId || null,
      partnerId: params.partnerId || null,
      chatType: params.chatType || 'channel',
      messageId: params.messageId || null,
      status: 'pending',
      createdAt: now,
    });
  } catch (err) {
    console.warn('[FCM] Error dispatching push notification outbox job:', err);
  }
}

// Global hook for Android WebView to pass FCM token into web layer
if (typeof window !== 'undefined') {
  window.registerAndroidFcmToken = (
    token: string,
    userId: number,
    username: string
  ) => {
    if (!token) return;
    const activeUserId = userId > 0 ? userId : Number(localStorage.getItem('sami_active_uid') || 0);
    const activeUsername = username || localStorage.getItem('sami_active_uname') || '';
    if (activeUserId > 0) {
      void registerUserFcmToken(activeUserId, activeUsername, token, 'android');
    }
  };

  window.dispatchNotificationDeepLink = (detail) => {
    dispatchNotificationDeepLink(detail);
  };
}
