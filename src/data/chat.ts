// Comprehensive Cloud Community System:
// - Channels (with independent passwords, images, and allowed members)
// - Channel Messages (with Role Badges, Profile Avatars, and 48h auto-delete)
// - Permanent Private Chat with Owner Sami (never deleted after 48h)
// - Moderator Warnings (1..3) & Channel Kicks with Reports to Sami
// - Real-time Targeted Notifications

import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  where,
} from 'firebase/firestore';
import {
  db,
  uploadImageToCloud,
  deleteCloudImage,
  uploadFileToCloud,
  UploadedFileResult,
  playNotificationChime,
} from '../services/firebase';
import { dispatchPushNotificationToRecipients } from '../services/fcm';
import { UserRole } from '../types';
import { UserAccount } from './auth';

export interface CommunityChannel {
  id: string;
  name: string;
  imageUrl?: string | null;
  storagePath?: string | null;
  password: string;
  memberIds: number[];
  visibility?: 'visible' | 'hidden';
  allowedMemberIds?: number[];
  createdBy: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChatReplyInfo {
  id: string;
  senderName: string;
  text?: string;
  isDeleted?: boolean;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: number;
  senderName: string;
  senderRole?: UserRole;
  senderAvatarUrl?: string | null;
  text?: string;
  imageUrl?: string;
  storagePath?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  fileUrl?: string;
  timestamp: number;
  isEdited?: boolean;
  isDeleted?: boolean;
  deletedAt?: number;
  deletedBy?: number;
  replyToId?: string | null;
  replyToSenderName?: string | null;
  replyToText?: string | null;
  replyToIsDeleted?: boolean;
  updatedAt?: number;
}

export interface PrivateMessage {
  id: string;
  participantId: number; // The non-owner user/moderator in the conversation with Sami
  participantName: string;
  senderId: number;
  senderName: string;
  senderRole: UserRole;
  senderAvatarUrl?: string | null;
  receiverId: number;
  text?: string;
  imageUrl?: string;
  storagePath?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  fileUrl?: string;
  isReport?: boolean;
  timestamp: number;
  isEdited?: boolean;
  isDeleted?: boolean;
  deletedAt?: number;
  deletedBy?: number;
  replyToId?: string | null;
  replyToSenderName?: string | null;
  replyToText?: string | null;
  replyToIsDeleted?: boolean;
  updatedAt?: number;
}

export interface UserWarning {
  id: string;
  channelId: string;
  channelName: string;
  targetUserId: number;
  targetUserName: string;
  issuedById: number;
  issuedByName: string;
  issuedByRole: UserRole;
  reason: string;
  warningNumber: number;
  evidenceImageUrl?: string | null;
  actionType: 'warning' | 'kick';
  timestamp: number;
}

export interface CommunityNotification {
  id: string;
  type: 'channel_important' | 'private_message' | 'warning' | 'kick';
  title: string;
  body: string;
  senderId: number;
  senderName: string;
  senderRole: UserRole;
  senderAvatarUrl?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  chatType?: 'channel' | 'private';
  messageId?: string | null;
  imageUrl?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  privateChatWithUserId?: number | null;
  partnerId?: number | null;
  targetUserIds: number[];
  timestamp: number;
}

export const DEFAULT_CHANNEL_ID = 'channel_default_3000';

const CHANNELS_COLLECTION = 'community_channels';
const CHAT_COLLECTION = 'chat_messages';
const PRIVATE_MESSAGES_COLLECTION = 'private_messages';
const WARNINGS_COLLECTION = 'user_warnings';
const NOTIFICATIONS_COLLECTION = 'community_notifications';
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

/**
 * Deterministic high-contrast color palette for user names on dark backgrounds.
 * Owner Sami (userId === 1) always receives Royal Gold (#FFD700).
 */
const USER_NAME_COLOR_PALETTE: readonly string[] = [
  '#FFD700', // 1 - Royal Gold (Owner Sami)
  '#38BDF8', // 2 - Sky Blue
  '#34D399', // 3 - Emerald Green
  '#F472B6', // 4 - Pink Rose
  '#A78BFA', // 5 - Soft Violet
  '#FB923C', // 6 - Vibrant Orange
  '#2DD4BF', // 7 - Teal Cyan
  '#F87171', // 8 - Coral Red
  '#A3E635', // 9 - Lime Green
  '#60A5FA', // 10 - Royal Blue
  '#E879F9', // 11 - Fuchsia
  '#FBBF24', // 12 - Warm Amber
  '#22D3EE', // 13 - Bright Cyan
  '#FB7185', // 14 - Salmon Rose
  '#818CF8', // 15 - Indigo Light
  '#4ADE80', // 16 - Mint Green
  '#FDBA74', // 17 - Peach Gold
  '#C084FC', // 18 - Purple Orchid
  '#67E8F9', // 19 - Ice Aqua
  '#FDE047', // 20 - Lemon Yellow
];

export function getUserNameColor(userId: number | string): string {
  const paletteSize = USER_NAME_COLOR_PALETTE.length;
  if (typeof userId === 'number' && Number.isFinite(userId)) {
    if (userId === 1) return '#FFD700';
    const index = (((Math.trunc(userId) - 1) % paletteSize) + paletteSize) % paletteSize;
    return USER_NAME_COLOR_PALETTE[index];
  }
  const str = String(userId);
  const parsed = parseInt(str, 10);
  if (!Number.isNaN(parsed)) {
    if (parsed === 1) return '#FFD700';
    const index = (((parsed - 1) % paletteSize) + paletteSize) % paletteSize;
    return USER_NAME_COLOR_PALETTE[index];
  }
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  const index = ((hash % paletteSize) + paletteSize) % paletteSize;
  return USER_NAME_COLOR_PALETTE[index];
}

// ============================================================================
// CHANNELS MANAGEMENT
// ============================================================================

let channelSeedPromise: Promise<void> | null = null;

export async function ensureDefaultChannelInitialized(): Promise<void> {
  if (channelSeedPromise) return channelSeedPromise;
  channelSeedPromise = (async () => {
    try {
      const snap = await getDocs(collection(db, CHANNELS_COLLECTION));
      if (snap.empty) {
        const now = Date.now();
        const defaultMembers = Array.from({ length: 20 }, (_, i) => i + 1);
        await setDoc(doc(db, CHANNELS_COLLECTION, DEFAULT_CHANNEL_ID), {
          id: DEFAULT_CHANNEL_ID,
          name: 'دفعة الرحلة إلى 3000$',
          imageUrl: null,
          password: '3000',
          memberIds: defaultMembers,
          createdBy: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
    } catch {
      // Ignore offline errors
    } finally {
      channelSeedPromise = null;
    }
  })();
  return channelSeedPromise;
}

const DEFAULT_INITIAL_CHANNEL: CommunityChannel = {
  id: DEFAULT_CHANNEL_ID,
  name: 'دفعة الرحلة إلى 3000$',
  imageUrl: null,
  password: '3000',
  memberIds: Array.from({ length: 20 }, (_, i) => i + 1),
  visibility: 'visible',
  allowedMemberIds: Array.from({ length: 20 }, (_, i) => i + 1),
  createdBy: 1,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

function getChannelsCacheKey(userId?: number): string {
  return userId && userId > 0 ? `sami_u_${userId}_channels_cache_v3` : 'sami_cached_channels_v3';
}

export function getInitialChannelsFromCache(userId?: number): CommunityChannel[] {
  try {
    if (typeof localStorage === 'undefined') return [DEFAULT_INITIAL_CHANNEL];
    const key = getChannelsCacheKey(userId);
    const raw = localStorage.getItem(key) || localStorage.getItem('sami_cached_channels_v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Filter hidden channels if userId is specified and user is not owner
        if (userId && userId !== 1) {
          return parsed.filter((ch: CommunityChannel) => {
            if (ch.visibility === 'hidden') {
              const allowed = ch.allowedMemberIds || ch.memberIds || [];
              return allowed.includes(userId);
            }
            return true;
          });
        }
        return parsed;
      }
    }
  } catch {
    // Ignore cache error
  }
  return [DEFAULT_INITIAL_CHANNEL];
}

export function saveCachedChannels(channels: CommunityChannel[], userId?: number): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const key = getChannelsCacheKey(userId);
      localStorage.setItem(key, JSON.stringify(channels));
      localStorage.setItem('sami_cached_channels_v3', JSON.stringify(channels));
    }
  } catch {
    // Ignore quota errors
  }
}

export function subscribeToChannels(
  onChannelsChange: (channels: CommunityChannel[]) => void,
  userId?: number
): () => void {
  // 1. Immediately provide cached channels synchronously so UI never starts empty or with 0
  const initialCached = getInitialChannelsFromCache(userId);
  if (initialCached.length > 0) {
    onChannelsChange(initialCached);
  }

  void ensureDefaultChannelInitialized();

  return onSnapshot(
    collection(db, CHANNELS_COLLECTION),
    (snapshot) => {
      const list: CommunityChannel[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const rawMembers = Array.isArray(data.memberIds) ? data.memberIds : [];
        const memberIds = Array.from(
          new Set([1, ...rawMembers.map((m) => Number(m)).filter((n) => n > 0)])
        );
        const visibility: 'visible' | 'hidden' = data.visibility === 'hidden' ? 'hidden' : 'visible';
        const allowedMemberIds = Array.isArray(data.allowedMemberIds)
          ? Array.from(new Set([1, ...data.allowedMemberIds.map((m: unknown) => Number(m))]))
          : memberIds;

        // Never expose hidden channel data to unauthorized user
        if (userId && userId !== 1 && visibility === 'hidden' && !allowedMemberIds.includes(userId)) {
          return;
        }

        list.push({
          id: String(data.id || docSnap.id),
          name: String(data.name || 'قناة تداول'),
          imageUrl: typeof data.imageUrl === 'string' && data.imageUrl ? data.imageUrl : null,
          storagePath: typeof data.storagePath === 'string' ? data.storagePath : null,
          password: String(data.password ?? ''),
          memberIds,
          visibility,
          allowedMemberIds,
          createdBy: Number(data.createdBy || 1),
          createdAt: Number(data.createdAt || Date.now()),
          updatedAt: Number(data.updatedAt || Date.now()),
        });
      });
      list.sort((a, b) => a.createdAt - b.createdAt);
      if (list.length === 0) {
        list.push(DEFAULT_INITIAL_CHANNEL);
      }
      saveCachedChannels(list, userId);
      onChannelsChange(list);
    },
    () => {
      onChannelsChange(getInitialChannelsFromCache(userId));
    }
  );
}

export async function createCloudChannel(params: {
  name: string;
  password: string;
  memberIds: number[];
  visibility?: 'visible' | 'hidden';
  allowedMemberIds?: number[];
  imageFileOrDataUrl?: File | string | null;
}): Promise<CommunityChannel> {
  const now = Date.now();
  const channelId = `channel_${now}_${Math.random().toString(36).substring(2, 7)}`;
  let imageUrl: string | null = null;
  let storagePath: string | null = null;

  if (params.imageFileOrDataUrl) {
    const uploaded = await uploadImageToCloud(params.imageFileOrDataUrl, 'channel_images', 1);
    imageUrl = uploaded.imageUrl;
    storagePath = uploaded.storagePath;
  }

  const memberIds = Array.from(new Set([1, ...params.memberIds]));
  const visibility: 'visible' | 'hidden' = params.visibility === 'hidden' ? 'hidden' : 'visible';
  const allowedMemberIds = params.allowedMemberIds
    ? Array.from(new Set([1, ...params.allowedMemberIds]))
    : memberIds;

  const channel: CommunityChannel = {
    id: channelId,
    name: params.name.trim(),
    imageUrl,
    storagePath,
    password: params.password.trim(),
    memberIds,
    visibility,
    allowedMemberIds,
    createdBy: 1,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(db, CHANNELS_COLLECTION, channelId), {
    id: channel.id,
    name: channel.name,
    imageUrl: channel.imageUrl || null,
    storagePath: channel.storagePath || null,
    password: channel.password,
    memberIds: channel.memberIds,
    visibility: channel.visibility,
    allowedMemberIds: channel.allowedMemberIds,
    createdBy: 1,
    createdAt: now,
    updatedAt: now,
  });

  return channel;
}

export async function updateCloudChannel(
  channelId: string,
  updates: {
    name?: string;
    password?: string;
    memberIds?: number[];
    visibility?: 'visible' | 'hidden';
    allowedMemberIds?: number[];
    imageFileOrDataUrl?: File | string | null;
    removeImage?: boolean;
  }
): Promise<void> {
  const payload: Record<string, unknown> = {
    updatedAt: Date.now(),
  };

  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.password !== undefined) payload.password = updates.password.trim();
  if (updates.memberIds !== undefined) {
    const mems = Array.from(new Set([1, ...updates.memberIds]));
    payload.memberIds = mems;
    payload.allowedMemberIds = mems;
  }
  if (updates.visibility !== undefined) {
    payload.visibility = updates.visibility === 'hidden' ? 'hidden' : 'visible';
  }
  if (updates.allowedMemberIds !== undefined) {
    payload.allowedMemberIds = Array.from(new Set([1, ...updates.allowedMemberIds]));
  }
  if (updates.removeImage) {
    payload.imageUrl = null;
    payload.storagePath = null;
  } else if (updates.imageFileOrDataUrl) {
    const uploaded = await uploadImageToCloud(updates.imageFileOrDataUrl, 'channel_images', 1);
    payload.imageUrl = uploaded.imageUrl;
    payload.storagePath = uploaded.storagePath;
  }

  await updateDoc(doc(db, CHANNELS_COLLECTION, channelId), payload);
}

export async function deleteCloudChannel(channel: CommunityChannel): Promise<void> {
  await deleteDoc(doc(db, CHANNELS_COLLECTION, channel.id));
  if (channel.imageUrl || channel.storagePath) {
    await deleteCloudImage(channel.imageUrl, channel.storagePath);
  }
}

// ============================================================================
// CHANNEL MESSAGES (Auto-purged after 48 hours)
// ============================================================================

export function filterExpiredMessages(messages: ChatMessage[]): ChatMessage[] {
  const now = Date.now();
  return messages.filter((m) => now - m.timestamp < FORTY_EIGHT_HOURS_MS);
}

export async function purgeExpiredFirestoreMessages(expiredMessages: ChatMessage[]): Promise<void> {
  for (const msg of expiredMessages) {
    try {
      await deleteDoc(doc(db, CHAT_COLLECTION, msg.id));
      if (msg.imageUrl || msg.storagePath) {
        await deleteCloudImage(msg.imageUrl, msg.storagePath);
      }
    } catch {
      // Ignore
    }
  }
}

export async function sendChannelMessage(
  channel: CommunityChannel,
  sender: { id: number; displayName: string; role: UserRole; avatarUrl?: string | null },
  content: {
    text?: string;
    imageUrl?: string;
    imageFile?: File;
    fileAttachment?: UploadedFileResult | null;
  },
  replyTo?: ChatReplyInfo | null
): Promise<ChatMessage> {
  const now = Date.now();
  const msgId = `msg_${now}_${sender.id}_${Math.random().toString(36).substring(2, 8)}`;

  let cloudImageUrl: string | undefined;
  let storagePath: string | undefined;

  if (content.imageFile) {
    const uploaded = await uploadImageToCloud(content.imageFile, 'chat_images', sender.id);
    cloudImageUrl = uploaded.imageUrl;
    storagePath = uploaded.storagePath;
  } else if (content.imageUrl) {
    if (content.imageUrl.startsWith('data:')) {
      const uploaded = await uploadImageToCloud(content.imageUrl, 'chat_images', sender.id);
      cloudImageUrl = uploaded.imageUrl;
      storagePath = uploaded.storagePath;
    } else {
      cloudImageUrl = content.imageUrl;
    }
  }

  const trimmedText = content.text?.trim();

  const firestorePayload: Record<string, unknown> = {
    id: msgId,
    channelId: channel.id,
    senderId: sender.id,
    senderName: sender.displayName,
    senderRole: sender.role,
    senderAvatarUrl: sender.avatarUrl || null,
    timestamp: now,
  };

  if (trimmedText) firestorePayload.text = trimmedText;
  if (cloudImageUrl) firestorePayload.imageUrl = cloudImageUrl;
  if (storagePath) firestorePayload.storagePath = storagePath;

  if (content.fileAttachment) {
    firestorePayload.fileName = content.fileAttachment.fileName;
    firestorePayload.fileSize = content.fileAttachment.fileSize;
    firestorePayload.fileType = content.fileAttachment.fileType;
    firestorePayload.fileUrl = content.fileAttachment.fileUrl;
    if (content.fileAttachment.storagePath) {
      firestorePayload.storagePath = content.fileAttachment.storagePath;
    }
  }

  if (replyTo) {
    firestorePayload.replyToId = replyTo.id;
    firestorePayload.replyToSenderName = replyTo.senderName;
    firestorePayload.replyToText = replyTo.isDeleted
      ? 'تم حذف الرسالة الأصلية.'
      : replyTo.text || (replyTo as unknown as { imageUrl?: string }).imageUrl ? '📷 صورة' : '';
    firestorePayload.replyToIsDeleted = Boolean(replyTo.isDeleted);
  }

  await setDoc(doc(db, CHAT_COLLECTION, msgId), firestorePayload);

  // Broadcast notification to authorized channel members (excluding sender)
  const recipientPool = channel.visibility === 'hidden'
    ? (channel.allowedMemberIds || channel.memberIds || [])
    : (channel.memberIds || []);
  const targetIds = recipientPool.filter((uid) => uid !== sender.id);
  if (targetIds.length > 0) {
    const rolePrefix =
      sender.role === 'owner'
        ? '👑 القائد Sami'
        : sender.role === 'moderator'
        ? `🛡️ المشرف ${sender.displayName}`
        : sender.displayName;
    const notifBody = content.fileAttachment
      ? `📎 ملف: ${content.fileAttachment.fileName}`
      : cloudImageUrl
      ? '📷 صورة'
      : (trimmedText || 'رسالة جديدة');
    await emitCommunityNotification({
      type: 'channel_important',
      title: `${rolePrefix} • ${channel.name}`,
      body: notifBody,
      senderId: sender.id,
      senderName: sender.displayName,
      senderRole: sender.role,
      senderAvatarUrl: sender.avatarUrl || null,
      channelId: channel.id,
      channelName: channel.name,
      chatType: 'channel',
      messageId: msgId,
      fileName: content.fileAttachment?.fileName || null,
      fileUrl: content.fileAttachment?.fileUrl || null,
      targetUserIds: targetIds,
    });

    void dispatchPushNotificationToRecipients({
      title: `${rolePrefix} • ${channel.name}`,
      body: notifBody,
      targetUserIds: targetIds,
      senderId: sender.id,
      senderName: sender.displayName,
      channelId: channel.id,
      chatType: 'channel',
      messageId: msgId,
    });
  }

  return {
    id: msgId,
    channelId: channel.id,
    senderId: sender.id,
    senderName: sender.displayName,
    senderRole: sender.role,
    senderAvatarUrl: sender.avatarUrl || null,
    text: trimmedText || undefined,
    imageUrl: cloudImageUrl,
    storagePath: content.fileAttachment?.storagePath || storagePath,
    fileName: content.fileAttachment?.fileName,
    fileSize: content.fileAttachment?.fileSize,
    fileType: content.fileAttachment?.fileType,
    fileUrl: content.fileAttachment?.fileUrl,
    timestamp: now,
    replyToId: replyTo?.id || null,
    replyToSenderName: replyTo?.senderName || null,
    replyToText: replyTo
      ? replyTo.isDeleted
        ? 'تم حذف الرسالة الأصلية.'
        : replyTo.text || '📷 صورة'
      : null,
    replyToIsDeleted: Boolean(replyTo?.isDeleted),
  };
}

export async function editChannelMessage(
  messageId: string,
  newText: string,
  currentUserId: number,
  messageSenderId: number
): Promise<void> {
  // Permission: Regular user, moderator, and even Sami can ONLY edit their own message
  if (currentUserId !== messageSenderId) {
    throw new Error('لا يمكنك تعديل رسالة مستخدم آخر.');
  }
  const trimmed = newText.trim();
  if (!trimmed) {
    throw new Error('لا يمكن حفظ رسالة فارغة.');
  }
  await updateDoc(doc(db, CHAT_COLLECTION, messageId), {
    text: trimmed,
    isEdited: true,
    updatedAt: Date.now(),
  });
}

export async function deleteChannelMessage(
  message: ChatMessage,
  currentUserId: number,
  isOwner: boolean
): Promise<void> {
  const isSami = currentUserId === 1 || isOwner;
  // Permission: User/Moderator can only delete their own message; Sami can delete any message
  if (currentUserId !== message.senderId && !isSami) {
    throw new Error('لا تملك صلاحية حذف هذه الرسالة.');
  }

  // Soft delete preserves thread history and reply references
  await updateDoc(doc(db, CHAT_COLLECTION, message.id), {
    isDeleted: true,
    text: 'تم حذف هذه الرسالة.',
    imageUrl: null,
    storagePath: null,
    deletedAt: Date.now(),
    deletedBy: currentUserId,
    updatedAt: Date.now(),
  });

  if (message.imageUrl || message.storagePath) {
    void deleteCloudImage(message.imageUrl, message.storagePath).catch(() => {});
  }
}

export function getInitialChannelMessagesFromCache(channelId: string): ChatMessage[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(`sami_cached_channel_msgs_${channelId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return filterExpiredMessages(parsed);
    }
  } catch {
    // Ignore cache parse error
  }
  return [];
}

export function saveCachedChannelMessages(channelId: string, messages: ChatMessage[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const slice = messages.slice(-80);
      localStorage.setItem(`sami_cached_channel_msgs_${channelId}`, JSON.stringify(slice));
    }
  } catch {
    // Ignore quota errors
  }
}

export function subscribeToChannelMessages(
  channelId: string,
  onMessagesChange: (messages: ChatMessage[]) => void,
  onError?: (errorMsg: string) => void
): () => void {
  // Immediately render cached messages so user never sees a blank screen
  const initial = getInitialChannelMessagesFromCache(channelId);
  if (initial.length > 0) {
    onMessagesChange(initial);
  }

  const q = query(collection(db, CHAT_COLLECTION), orderBy('timestamp', 'asc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const now = Date.now();
      const validMessages: ChatMessage[] = [];
      const expiredMessages: ChatMessage[] = [];

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const docChannelId =
          typeof data.channelId === 'string' && data.channelId
            ? data.channelId
            : DEFAULT_CHANNEL_ID;

        const msg: ChatMessage = {
          id: String(data.id || docSnap.id),
          channelId: docChannelId,
          senderId: Number(data.senderId || 0),
          senderName: String(data.senderName || 'متداول'),
          senderRole:
            Number(data.senderId) === 1
              ? 'owner'
              : data.senderRole === 'moderator'
              ? 'moderator'
              : 'user',
          senderAvatarUrl: typeof data.senderAvatarUrl === 'string' ? data.senderAvatarUrl : null,
          text: typeof data.text === 'string' ? data.text : undefined,
          imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : undefined,
          storagePath: typeof data.storagePath === 'string' ? data.storagePath : undefined,
          fileName: typeof data.fileName === 'string' ? data.fileName : undefined,
          fileSize: typeof data.fileSize === 'number' ? data.fileSize : undefined,
          fileType: typeof data.fileType === 'string' ? data.fileType : undefined,
          fileUrl: typeof data.fileUrl === 'string' ? data.fileUrl : undefined,
          timestamp: Number(data.timestamp || now),
          isEdited: Boolean(data.isEdited),
          isDeleted: Boolean(data.isDeleted),
          deletedAt: typeof data.deletedAt === 'number' ? data.deletedAt : undefined,
          deletedBy: typeof data.deletedBy === 'number' ? data.deletedBy : undefined,
          replyToId: typeof data.replyToId === 'string' ? data.replyToId : null,
          replyToSenderName: typeof data.replyToSenderName === 'string' ? data.replyToSenderName : null,
          replyToText: typeof data.replyToText === 'string' ? data.replyToText : null,
          replyToIsDeleted: Boolean(data.replyToIsDeleted),
          updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : undefined,
        };

        if (now - msg.timestamp < FORTY_EIGHT_HOURS_MS) {
          if (msg.channelId === channelId) {
            validMessages.push(msg);
          }
        } else {
          expiredMessages.push(msg);
        }
      });

      if (expiredMessages.length > 0) {
        void purgeExpiredFirestoreMessages(expiredMessages);
      }

      validMessages.sort((a, b) => a.timestamp - b.timestamp);
      saveCachedChannelMessages(channelId, validMessages);
      onMessagesChange(validMessages);
    },
    (error) => {
      if (error?.code !== 'unavailable' && onError) {
        onError('تعذر الاتصال بخدمة القنوات السحابية.');
      }
    }
  );
}

// ============================================================================
// PERMANENT PRIVATE MESSAGES WITH SAMI (Never deleted after 48 hours)
// ============================================================================

export async function sendPrivateMessage(params: {
  participantId: number;
  participantName: string;
  sender: { id: number; displayName: string; role: UserRole; avatarUrl?: string | null };
  receiverId: number;
  text?: string;
  imageFileOrDataUrl?: File | string | null;
  fileAttachment?: UploadedFileResult | null;
  isReport?: boolean;
  replyTo?: ChatReplyInfo | null;
}): Promise<PrivateMessage> {
  const now = Date.now();
  const msgId = `pm_${now}_${params.sender.id}_${Math.random().toString(36).substring(2, 8)}`;

  let cloudImageUrl: string | undefined;
  let storagePath: string | undefined;

  if (params.imageFileOrDataUrl) {
    const uploaded = await uploadImageToCloud(
      params.imageFileOrDataUrl,
      params.isReport ? 'warning_evidence' : 'chat_images',
      params.sender.id
    );
    cloudImageUrl = uploaded.imageUrl;
    storagePath = uploaded.storagePath;
  }

  const trimmedText = params.text?.trim();

  const payload: Record<string, unknown> = {
    id: msgId,
    participantId: params.participantId,
    participantName: params.participantName,
    senderId: params.sender.id,
    senderName: params.sender.displayName,
    senderRole: params.sender.role,
    senderAvatarUrl: params.sender.avatarUrl || null,
    receiverId: params.receiverId,
    isReport: Boolean(params.isReport),
    timestamp: now,
  };

  if (trimmedText) payload.text = trimmedText;
  if (cloudImageUrl) payload.imageUrl = cloudImageUrl;
  if (storagePath) payload.storagePath = storagePath;

  if (params.fileAttachment) {
    payload.fileName = params.fileAttachment.fileName;
    payload.fileSize = params.fileAttachment.fileSize;
    payload.fileType = params.fileAttachment.fileType;
    payload.fileUrl = params.fileAttachment.fileUrl;
    if (params.fileAttachment.storagePath) {
      payload.storagePath = params.fileAttachment.storagePath;
    }
  }

  if (params.replyTo) {
    payload.replyToId = params.replyTo.id;
    payload.replyToSenderName = params.replyTo.senderName;
    payload.replyToText = params.replyTo.isDeleted
      ? 'تم حذف الرسالة الأصلية.'
      : params.replyTo.text || '📷 صورة';
    payload.replyToIsDeleted = Boolean(params.replyTo.isDeleted);
  }

  await setDoc(doc(db, PRIVATE_MESSAGES_COLLECTION, msgId), payload);

  // Emit real-time notification to the recipient
  const notifTitle =
    params.sender.id === 1
      ? '👑 رسالة خاصة من القائد Sami'
      : params.isReport
      ? `📋 بلاغ وتقرير من المشرف ${params.sender.displayName}`
      : `💬 رسالة خاصة من ${params.sender.displayName}`;

  const notifBody = params.fileAttachment
    ? `📎 ملف: ${params.fileAttachment.fileName}`
    : cloudImageUrl
    ? '📷 صورة'
    : (trimmedText || 'رسالة جديدة');

  await emitCommunityNotification({
    type: 'private_message',
    title: notifTitle,
    body: notifBody,
    senderId: params.sender.id,
    senderName: params.sender.displayName,
    senderRole: params.sender.role,
    senderAvatarUrl: params.sender.avatarUrl || null,
    channelId: null,
    channelName: 'محادثة خاصة',
    chatType: 'private',
    messageId: msgId,
    fileName: params.fileAttachment?.fileName || null,
    fileUrl: params.fileAttachment?.fileUrl || null,
    partnerId: params.sender.id,
    targetUserIds: [params.receiverId],
  });

  void dispatchPushNotificationToRecipients({
    title: notifTitle,
    body: notifBody,
    targetUserIds: [params.receiverId],
    senderId: params.sender.id,
    senderName: params.sender.displayName,
    partnerId: params.sender.id,
    chatType: 'private',
    messageId: msgId,
  });

  return {
    id: msgId,
    participantId: params.participantId,
    participantName: params.participantName,
    senderId: params.sender.id,
    senderName: params.sender.displayName,
    senderRole: params.sender.role,
    senderAvatarUrl: params.sender.avatarUrl || null,
    receiverId: params.receiverId,
    text: trimmedText || undefined,
    imageUrl: cloudImageUrl,
    storagePath: params.fileAttachment?.storagePath || storagePath,
    fileName: params.fileAttachment?.fileName,
    fileSize: params.fileAttachment?.fileSize,
    fileType: params.fileAttachment?.fileType,
    fileUrl: params.fileAttachment?.fileUrl,
    isReport: Boolean(params.isReport),
    timestamp: now,
    replyToId: params.replyTo?.id || null,
    replyToSenderName: params.replyTo?.senderName || null,
    replyToText: params.replyTo
      ? params.replyTo.isDeleted
        ? 'تم حذف الرسالة الأصلية.'
        : params.replyTo.text || '📷 صورة'
      : null,
    replyToIsDeleted: Boolean(params.replyTo?.isDeleted),
  };
}

export async function editPrivateMessage(
  messageId: string,
  newText: string,
  currentUserId: number,
  messageSenderId: number
): Promise<void> {
  if (currentUserId !== messageSenderId) {
    throw new Error('لا يمكنك تعديل رسالة مستخدم آخر.');
  }
  const trimmed = newText.trim();
  if (!trimmed) {
    throw new Error('لا يمكن حفظ رسالة فارغة.');
  }
  await updateDoc(doc(db, PRIVATE_MESSAGES_COLLECTION, messageId), {
    text: trimmed,
    isEdited: true,
    updatedAt: Date.now(),
  });
}

export async function deletePrivateMessage(
  message: PrivateMessage,
  currentUserId: number,
  isOwner: boolean
): Promise<void> {
  const isSami = currentUserId === 1 || isOwner;
  if (currentUserId !== message.senderId && !isSami) {
    throw new Error('لا تملك صلاحية حذف هذه الرسالة.');
  }
  await updateDoc(doc(db, PRIVATE_MESSAGES_COLLECTION, message.id), {
    isDeleted: true,
    text: 'تم حذف هذه الرسالة.',
    imageUrl: null,
    storagePath: null,
    deletedAt: Date.now(),
    deletedBy: currentUserId,
    updatedAt: Date.now(),
  });
  if (message.imageUrl || message.storagePath) {
    void deleteCloudImage(message.imageUrl, message.storagePath).catch(() => {});
  }
}

export function getInitialPrivateMessagesFromCache(participantId: number | null): PrivateMessage[] {
  if (participantId === null) return [];
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(`sami_cached_pm_msgs_${participantId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Ignore cache parse error
  }
  return [];
}

export function saveCachedPrivateMessages(participantId: number, messages: PrivateMessage[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const slice = messages.slice(-80);
      localStorage.setItem(`sami_cached_pm_msgs_${participantId}`, JSON.stringify(slice));
    }
  } catch {
    // Ignore quota errors
  }
}

export function subscribeToPrivateMessages(
  participantId: number | null,
  onMessagesChange: (messages: PrivateMessage[]) => void
): () => void {
  // Immediately provide cached private messages
  if (participantId !== null) {
    const initial = getInitialPrivateMessagesFromCache(participantId);
    if (initial.length > 0) {
      onMessagesChange(initial);
    }
  }

  const q =
    participantId !== null
      ? query(collection(db, PRIVATE_MESSAGES_COLLECTION), where('participantId', '==', participantId))
      : query(collection(db, PRIVATE_MESSAGES_COLLECTION), orderBy('timestamp', 'asc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: PrivateMessage[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const pId = Number(data.participantId || 0);
        if (participantId !== null && pId !== participantId) return;

        list.push({
          id: String(data.id || docSnap.id),
          participantId: pId,
          participantName: String(data.participantName || 'مستخدم'),
          senderId: Number(data.senderId || 0),
          senderName: String(data.senderName || 'مستخدم'),
          senderRole:
            Number(data.senderId) === 1
              ? 'owner'
              : data.senderRole === 'guest'
              ? 'guest'
              : data.senderRole === 'moderator'
              ? 'moderator'
              : 'user',
          senderAvatarUrl: typeof data.senderAvatarUrl === 'string' ? data.senderAvatarUrl : null,
          receiverId: Number(data.receiverId || 1),
          text: typeof data.text === 'string' ? data.text : undefined,
          imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : undefined,
          storagePath: typeof data.storagePath === 'string' ? data.storagePath : undefined,
          fileName: typeof data.fileName === 'string' ? data.fileName : undefined,
          fileSize: typeof data.fileSize === 'number' ? data.fileSize : undefined,
          fileType: typeof data.fileType === 'string' ? data.fileType : undefined,
          fileUrl: typeof data.fileUrl === 'string' ? data.fileUrl : undefined,
          isReport: Boolean(data.isReport),
          timestamp: Number(data.timestamp || Date.now()),
          isEdited: Boolean(data.isEdited),
          isDeleted: Boolean(data.isDeleted),
          deletedAt: typeof data.deletedAt === 'number' ? data.deletedAt : undefined,
          deletedBy: typeof data.deletedBy === 'number' ? data.deletedBy : undefined,
          replyToId: typeof data.replyToId === 'string' ? data.replyToId : null,
          replyToSenderName: typeof data.replyToSenderName === 'string' ? data.replyToSenderName : null,
          replyToText: typeof data.replyToText === 'string' ? data.replyToText : null,
          replyToIsDeleted: Boolean(data.replyToIsDeleted),
          updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : undefined,
        });
      });

      list.sort((a, b) => a.timestamp - b.timestamp);
      if (participantId !== null) {
        saveCachedPrivateMessages(participantId, list);
      }
      onMessagesChange(list);
    },
    () => {
      // Ignore
    }
  );
}

// ============================================================================
// WARNINGS & CHANNEL KICK ACTIONS
// ============================================================================

export function subscribeToWarnings(
  onWarningsChange: (warnings: UserWarning[]) => void
): () => void {
  const q = query(collection(db, WARNINGS_COLLECTION), orderBy('timestamp', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: UserWarning[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: String(data.id || docSnap.id),
          channelId: String(data.channelId || DEFAULT_CHANNEL_ID),
          channelName: String(data.channelName || ''),
          targetUserId: Number(data.targetUserId || 0),
          targetUserName: String(data.targetUserName || ''),
          issuedById: Number(data.issuedById || 1),
          issuedByName: String(data.issuedByName || ''),
          issuedByRole: data.issuedByRole === 'owner' ? 'owner' : 'moderator',
          reason: String(data.reason || ''),
          warningNumber: Number(data.warningNumber || 1),
          evidenceImageUrl: typeof data.evidenceImageUrl === 'string' ? data.evidenceImageUrl : null,
          actionType: data.actionType === 'kick' ? 'kick' : 'warning',
          timestamp: Number(data.timestamp || Date.now()),
        });
      });
      onWarningsChange(list);
    },
    () => {}
  );
}

export async function issueWarningToMember(params: {
  channel: CommunityChannel;
  targetUser: UserAccount;
  issuer: { id: number; displayName: string; role: UserRole; avatarUrl?: string | null };
  reason: string;
  evidenceFileOrDataUrl?: File | string | null;
}): Promise<number> {
  const now = Date.now();
  const newWarningCount = (params.targetUser.warningsCount || 0) + 1;
  const warningId = `warn_${now}_${params.targetUser.id}`;

  let evidenceUrl: string | null = null;
  if (params.evidenceFileOrDataUrl) {
    const uploaded = await uploadImageToCloud(
      params.evidenceFileOrDataUrl,
      'warning_evidence',
      params.issuer.id
    );
    evidenceUrl = uploaded.imageUrl;
  }

  await setDoc(doc(db, WARNINGS_COLLECTION, warningId), {
    id: warningId,
    channelId: params.channel.id,
    channelName: params.channel.name,
    targetUserId: params.targetUser.id,
    targetUserName: params.targetUser.displayName,
    issuedById: params.issuer.id,
    issuedByName: params.issuer.displayName,
    issuedByRole: params.issuer.role,
    reason: params.reason.trim(),
    warningNumber: newWarningCount,
    evidenceImageUrl: evidenceUrl,
    actionType: 'warning',
    timestamp: now,
  });

  await updateDoc(doc(db, 'community_users', String(params.targetUser.id)), {
    warningsCount: newWarningCount,
    updatedAt: now,
  });

  // Also post an official warning notice inside the channel
  await sendChannelMessage(params.channel, params.issuer, {
    text: `⚠️ إنذار رسمي (${newWarningCount}/3) للمشترك ${params.targetUser.displayName}: ${params.reason.trim()}`,
    imageUrl: evidenceUrl || undefined,
  });

  await emitCommunityNotification({
    type: 'warning',
    title: `⚠️ إنذار جديد (${newWarningCount}/3) • ${params.channel.name}`,
    body: `تم تسجيل مخالفة على ${params.targetUser.displayName}: ${params.reason.trim()}`,
    senderId: params.issuer.id,
    senderName: params.issuer.displayName,
    senderRole: params.issuer.role,
    channelId: params.channel.id,
    targetUserIds: Array.from(new Set([params.targetUser.id, 1])),
  });

  return newWarningCount;
}

export async function kickMemberFromChannelAndReport(params: {
  channel: CommunityChannel;
  targetUser: UserAccount;
  issuer: { id: number; displayName: string; role: UserRole; avatarUrl?: string | null };
  reason: string;
  evidenceFileOrDataUrl?: File | string | null;
}): Promise<void> {
  if (params.targetUser.id === 1) {
    throw new Error('لا يمكن طرد القائد Sami.');
  }

  const now = Date.now();
  let evidenceUrl: string | null = null;
  if (params.evidenceFileOrDataUrl) {
    const uploaded = await uploadImageToCloud(
      params.evidenceFileOrDataUrl,
      'warning_evidence',
      params.issuer.id
    );
    evidenceUrl = uploaded.imageUrl;
  }

  // 1. Remove member from channel and clear their verified password for this channel in cloud
  const updatedMembers = params.channel.memberIds.filter((id) => id !== params.targetUser.id);
  await updateCloudChannel(params.channel.id, { memberIds: updatedMembers });

  try {
    const updatedVerified = { ...(params.targetUser.verifiedChannels || {}) };
    delete updatedVerified[params.channel.id];
    await updateDoc(doc(db, 'community_users', String(params.targetUser.id)), {
      verifiedChannels: updatedVerified,
      updatedAt: now,
    });
  } catch {
    // Ignore
  }

  // 2. Log kick in user_warnings
  const kickId = `kick_${now}_${params.targetUser.id}`;
  await setDoc(doc(db, WARNINGS_COLLECTION, kickId), {
    id: kickId,
    channelId: params.channel.id,
    channelName: params.channel.name,
    targetUserId: params.targetUser.id,
    targetUserName: params.targetUser.displayName,
    issuedById: params.issuer.id,
    issuedByName: params.issuer.displayName,
    issuedByRole: params.issuer.role,
    reason: params.reason.trim(),
    warningNumber: params.targetUser.warningsCount || 3,
    evidenceImageUrl: evidenceUrl,
    actionType: 'kick',
    timestamp: now,
  });

  // 3. Automatically send official Report to Owner Sami via Permanent Private Chat
  const reportText = [
    `🚨 تقرير طرد مشترك من القناة (${params.channel.name})`,
    `• اسم المشترك: ${params.targetUser.displayName} (@${params.targetUser.username})`,
    `• عدد الإنذارات: ${params.targetUser.warningsCount || 3} / 3`,
    `• المشرف المنفذ: ${params.issuer.displayName}`,
    `• سبب الطرد والمخالفة: ${params.reason.trim()}`,
  ].join('\n');

  await sendPrivateMessage({
    participantId: params.issuer.id === 1 ? params.targetUser.id : params.issuer.id,
    participantName:
      params.issuer.id === 1 ? params.targetUser.displayName : params.issuer.displayName,
    sender: params.issuer,
    receiverId: 1,
    text: reportText,
    imageFileOrDataUrl: evidenceUrl,
    isReport: true,
  });

  // 4. Notify target user and Owner
  await emitCommunityNotification({
    type: 'kick',
    title: `🚫 تم استبعاد ${params.targetUser.displayName} من ${params.channel.name}`,
    body: params.reason.trim(),
    senderId: params.issuer.id,
    senderName: params.issuer.displayName,
    senderRole: params.issuer.role,
    channelId: params.channel.id,
    targetUserIds: Array.from(new Set([params.targetUser.id, 1])),
  });
}

// ============================================================================
// REAL-TIME TARGETED NOTIFICATIONS
// ============================================================================

export async function emitCommunityNotification(
  notif: Omit<CommunityNotification, 'id' | 'timestamp'>
): Promise<void> {
  try {
    const now = Date.now();
    const id = `notif_${now}_${notif.senderId}_${Math.random().toString(36).substring(2, 7)}`;
    const payload: Record<string, unknown> = {
      id,
      type: notif.type,
      title: notif.title,
      body: notif.body,
      senderId: notif.senderId,
      senderName: notif.senderName,
      senderRole: notif.senderRole,
      channelId: notif.channelId || null,
      targetUserIds: notif.targetUserIds,
      timestamp: now,
    };
    if (notif.senderAvatarUrl) payload.senderAvatarUrl = notif.senderAvatarUrl;
    if (notif.channelName) payload.channelName = notif.channelName;
    if (notif.chatType) payload.chatType = notif.chatType;
    if (notif.messageId) payload.messageId = notif.messageId;
    if (notif.imageUrl) payload.imageUrl = notif.imageUrl;
    if (notif.fileName) payload.fileName = notif.fileName;
    if (notif.fileUrl) payload.fileUrl = notif.fileUrl;
    if (notif.privateChatWithUserId) payload.privateChatWithUserId = notif.privateChatWithUserId;
    if (notif.partnerId) payload.partnerId = notif.partnerId;

    await setDoc(doc(db, NOTIFICATIONS_COLLECTION, id), payload);
  } catch {
    // Ignore notification write errors
  }
}

export function subscribeToUserNotifications(
  currentUserId: number,
  onNotification: (notif: CommunityNotification) => void
): () => void {
  const sessionStartTime = Date.now();
  const seenIds = new Set<string>();
  const q = query(collection(db, NOTIFICATIONS_COLLECTION), orderBy('timestamp', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const data = change.doc.data();
        const id = String(data.id || change.doc.id);
        if (seenIds.has(id)) return;
        seenIds.add(id);

        const timestamp = Number(data.timestamp || 0);
        if (timestamp < sessionStartTime - 5000) return;

        const senderId = Number(data.senderId || 0);
        if (senderId === currentUserId) return;

        const targetIds = Array.isArray(data.targetUserIds)
          ? data.targetUserIds.map((n) => Number(n))
          : [];
        if (!targetIds.includes(currentUserId)) return;

        const notif: CommunityNotification = {
          id,
          type: (data.type as CommunityNotification['type']) || 'channel_important',
          title: String(data.title || 'إشعار جديد'),
          body: String(data.body || ''),
          senderId,
          senderName: String(data.senderName || ''),
          senderRole:
            data.senderRole === 'owner'
              ? 'owner'
              : data.senderRole === 'moderator'
              ? 'moderator'
              : 'user',
          senderAvatarUrl: typeof data.senderAvatarUrl === 'string' ? data.senderAvatarUrl : null,
          channelId: typeof data.channelId === 'string' ? data.channelId : null,
          channelName: typeof data.channelName === 'string' ? data.channelName : null,
          chatType: data.chatType === 'private' ? 'private' : 'channel',
          messageId: typeof data.messageId === 'string' ? data.messageId : null,
          imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : null,
          fileName: typeof data.fileName === 'string' ? data.fileName : null,
          fileUrl: typeof data.fileUrl === 'string' ? data.fileUrl : null,
          privateChatWithUserId: typeof data.privateChatWithUserId === 'number' ? data.privateChatWithUserId : (typeof data.partnerId === 'number' ? data.partnerId : null),
          partnerId: typeof data.partnerId === 'number' ? data.partnerId : null,
          targetUserIds: targetIds,
          timestamp,
        };

        playNotificationChime();
        onNotification(notif);

        // Trigger Browser/System Notification if supported and permitted
        try {
          if (typeof window !== 'undefined' && 'Notification' in window) {
            if (Notification.permission === 'granted') {
              const browserNotif = new Notification(notif.title, {
                body: notif.body,
                icon: notif.senderAvatarUrl || '/app-icon.png',
                tag: notif.id,
              });
              browserNotif.onclick = () => {
                window.focus();
                window.dispatchEvent(new CustomEvent('app_open_chat_message', { detail: notif }));
              };
            }
          }
        } catch {
          // Ignore browser notification restrictions
        }
      });
    },
    () => {}
  );
}
