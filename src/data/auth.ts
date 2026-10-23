// Cloud-backed Dynamic User & Role Management System
// Supports 3 roles: Owner (Sami), Moderator, and Normal User.

import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
} from 'firebase/firestore';
import { db, uploadImageToCloud } from '../services/firebase';
import { syncUserSessionToNative, unregisterUserFcmToken } from '../services/fcm';
import { UserRole } from '../types';

export interface UserAccount {
  id: number;
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
  avatarUrl?: string | null;
  verifiedChannels?: Record<string, string>;
  warningsCount?: number;
  isActive?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export const INITIAL_SEED_USERS: UserAccount[] = [
  { id: 1, username: 'Sami', displayName: 'Sami', password: '12345678', role: 'owner' },
  { id: 2, username: 'Hani Alqadasi', displayName: 'Hani Alqadasi', password: 'Hani33334', role: 'user' },
  { id: 3, username: 'Eslam Alqadasi', displayName: 'Eslam Alqadasi', password: '55555555', role: 'user' },
  { id: 4, username: 'Omar Ali', displayName: 'Omar Ali', password: 'Omar1234', role: 'user' },
  { id: 5, username: 'Ahmed Saleh', displayName: 'Ahmed Saleh', password: 'Ahmed123', role: 'user' },
  { id: 6, username: 'Mohammed Ali', displayName: 'Mohammed Ali', password: 'Mo2025', role: 'user' },
  { id: 7, username: 'Khaled Nasser', displayName: 'Khaled Nasser', password: 'Khaled22', role: 'user' },
  { id: 8, username: 'Yasser Ahmed', displayName: 'Yasser Ahmed', password: 'Yasser11', role: 'user' },
  { id: 9, username: 'Ali Hassan', displayName: 'Ali Hassan', password: 'Ali2025', role: 'user' },
  { id: 10, username: 'Abdullah Sami', displayName: 'Abdullah Sami', password: 'Abd12345', role: 'user' },
  { id: 11, username: 'Faisal Omar', displayName: 'Faisal Omar', password: 'Faisal88', role: 'user' },
  { id: 12, username: 'Mahmoud Adel', displayName: 'Mahmoud Adel', password: 'Mahmoud7', role: 'user' },
  { id: 13, username: 'Tareq Salem', displayName: 'Tareq Salem', password: 'Tareq123', role: 'user' },
  { id: 14, username: 'Zaid Ahmed', displayName: 'Zaid Ahmed', password: 'Zaid2025', role: 'user' },
  { id: 15, username: 'Noor Ali', displayName: 'Noor Ali', password: 'Noor1234', role: 'user' },
  { id: 16, username: 'Amjad Sami', displayName: 'Amjad Sami', password: 'Amjad555', role: 'user' },
  { id: 17, username: 'Saleh Omar', displayName: 'Saleh Omar', password: 'Saleh2025', role: 'user' },
  { id: 18, username: 'Nasser Ali', displayName: 'Nasser Ali', password: 'Nasser99', role: 'user' },
  { id: 19, username: 'Tariq90', displayName: 'Tariq90', password: 'Tariq4141', role: 'user' },
  { id: 20, username: 'Yazan Sami', displayName: 'Yazan Sami', password: 'Yazan2025', role: 'user' },
];

export const AUTHORIZED_USERS = INITIAL_SEED_USERS;

const USERS_COLLECTION = 'community_users';
const SESSION_STORAGE_KEY = 'sami_auth_user_session';
const USERS_CACHE_KEY = 'sami_cloud_users_cache_v1';

export interface CurrentUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  avatarUrl?: string | null;
  verifiedChannels?: Record<string, string>;
  warningsCount?: number;
  loginTimestamp: number;
  isGuest?: boolean;
  guestId?: string;
  guestNumber?: number;
}

export function normalizeRole(id: number, username: string, rawRole?: string): UserRole {
  if (id === 1 || username.trim().toLowerCase() === 'sami') {
    return 'owner';
  }
  if (rawRole === 'guest' || id > 9000000 || username.startsWith('guest_')) return 'guest';
  if (rawRole === 'moderator') return 'moderator';
  return 'user';
}

function parseUserDoc(data: Record<string, unknown>, fallbackId = 0): UserAccount {
  const id = Number(data.id || fallbackId);
  const username = String(data.username || '');
  const displayName = String(data.displayName || username || 'مستخدم');
  const password = String(data.password || '');
  const role = normalizeRole(id, username, typeof data.role === 'string' ? data.role : undefined);
  const avatarUrl = typeof data.avatarUrl === 'string' && data.avatarUrl ? data.avatarUrl : null;
  const verifiedChannels =
    data.verifiedChannels && typeof data.verifiedChannels === 'object'
      ? (data.verifiedChannels as Record<string, string>)
      : {};
  const warningsCount = Number(data.warningsCount || 0);
  return {
    id,
    username,
    displayName,
    password,
    role,
    avatarUrl,
    verifiedChannels,
    warningsCount,
    createdAt: Number(data.createdAt || Date.now()),
    updatedAt: Number(data.updatedAt || Date.now()),
  };
}

export function getCachedUsers(): UserAccount[] {
  try {
    const raw = localStorage.getItem(USERS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as UserAccount[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore
  }
  return INITIAL_SEED_USERS;
}

function saveCachedUsers(users: UserAccount[]): void {
  try {
    localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(users));
  } catch {
    // Ignore
  }
}

let seedPromise: Promise<UserAccount[]> | null = null;

/**
 * Ensures `community_users` is populated in Firestore.
 * If empty on first run, seeds the initial 20 accounts into the cloud.
 */
export async function ensureCloudUsersInitialized(): Promise<UserAccount[]> {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    try {
      const snap = await getDocs(collection(db, USERS_COLLECTION));
      if (snap.empty) {
        const now = Date.now();
        await Promise.all(
          INITIAL_SEED_USERS.map((u) =>
            setDoc(doc(db, USERS_COLLECTION, String(u.id)), {
              id: u.id,
              username: u.username,
              displayName: u.displayName,
              password: u.password,
              role: normalizeRole(u.id, u.username, u.role),
              avatarUrl: null,
              verifiedChannels: {},
              warningsCount: 0,
              createdAt: now,
              updatedAt: now,
            })
          )
        );
        saveCachedUsers(INITIAL_SEED_USERS);
        return INITIAL_SEED_USERS;
      }

      const list: UserAccount[] = [];
      snap.forEach((docSnap) => {
        list.push(parseUserDoc(docSnap.data(), Number(docSnap.id)));
      });

      // Ensure Owner Sami always exists
      if (!list.some((u) => u.id === 1 || u.username.toLowerCase() === 'sami')) {
        const owner = INITIAL_SEED_USERS[0];
        const now = Date.now();
        await setDoc(doc(db, USERS_COLLECTION, '1'), {
          ...owner,
          role: 'owner',
          avatarUrl: null,
          verifiedChannels: {},
          warningsCount: 0,
          createdAt: now,
          updatedAt: now,
        });
        list.unshift(owner);
      }

      list.sort((a, b) => a.id - b.id);
      saveCachedUsers(list);
      return list;
    } catch {
      return getCachedUsers();
    } finally {
      seedPromise = null;
    }
  })();
  return seedPromise;
}

/**
 * Subscribe to real-time updates of all community users from Firestore.
 */
export function subscribeToCommunityUsers(
  onUsersChange: (users: UserAccount[]) => void
): () => void {
  void ensureCloudUsersInitialized();

  return onSnapshot(
    collection(db, USERS_COLLECTION),
    (snapshot) => {
      if (snapshot.empty) return;
      const list: UserAccount[] = [];
      snapshot.forEach((docSnap) => {
        list.push(parseUserDoc(docSnap.data(), Number(docSnap.id)));
      });
      list.sort((a, b) => a.id - b.id);
      saveCachedUsers(list);
      onUsersChange(list);
    },
    () => {
      onUsersChange(getCachedUsers());
    }
  );
}

/**
 * Cloud-first user authentication with instant cache fallback if offline.
 */
export async function authenticateUserAsync(
  usernameInput: string,
  passwordInput: string
): Promise<{ success: boolean; user?: CurrentUser; error?: string }> {
  const trimmedUser = usernameInput.trim();
  const trimmedPass = passwordInput.trim();

  if (!trimmedUser || !trimmedPass) {
    return {
      success: false,
      error: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    };
  }

  const users = await ensureCloudUsersInitialized();
  const matched = users.find(
    (u) => u.username.trim().toLowerCase() === trimmedUser.toLowerCase() && u.password === trimmedPass
  );

  if (!matched) {
    return {
      success: false,
      error: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    };
  }

  const currentUser: CurrentUser = {
    id: matched.id,
    username: matched.username,
    displayName: matched.displayName,
    role: normalizeRole(matched.id, matched.username, matched.role),
    avatarUrl: matched.avatarUrl || null,
    verifiedChannels: matched.verifiedChannels || {},
    warningsCount: matched.warningsCount || 0,
    loginTimestamp: Date.now(),
  };

  saveUserSession(currentUser);
  return { success: true, user: currentUser };
}

/**
 * Synchronous authentication helper for compatibility.
 */
export function authenticateUser(
  usernameInput: string,
  passwordInput: string
): { success: boolean; user?: CurrentUser; error?: string } {
  const trimmedUser = usernameInput.trim();
  const trimmedPass = passwordInput.trim();

  if (!trimmedUser || !trimmedPass) {
    return {
      success: false,
      error: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    };
  }

  const users = getCachedUsers();
  const matched = users.find(
    (u) => u.username.trim().toLowerCase() === trimmedUser.toLowerCase() && u.password === trimmedPass
  );

  if (!matched) {
    return {
      success: false,
      error: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    };
  }

  const currentUser: CurrentUser = {
    id: matched.id,
    username: matched.username,
    displayName: matched.displayName,
    role: normalizeRole(matched.id, matched.username, matched.role),
    avatarUrl: matched.avatarUrl || null,
    verifiedChannels: matched.verifiedChannels || {},
    warningsCount: matched.warningsCount || 0,
    loginTimestamp: Date.now(),
  };

  saveUserSession(currentUser);
  try {
    localStorage.setItem('sami_active_uid', String(currentUser.id));
    localStorage.setItem('sami_active_uname', currentUser.displayName);
    syncUserSessionToNative(currentUser.id, currentUser.displayName);
  } catch {
    // Ignore
  }
  return { success: true, user: currentUser };
}

export function saveUserSession(user: CurrentUser): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
    localStorage.setItem('sami_active_uid', String(user.id));
    localStorage.setItem('sami_active_uname', user.displayName);
    syncUserSessionToNative(user.id, user.displayName);
  } catch {
    // Ignore
  }
}

export function getSavedUserSession(): CurrentUser | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CurrentUser;
    if (parsed && (parsed.username || parsed.isGuest || (parsed.id && parsed.id > 9000000))) {
      parsed.role = normalizeRole(parsed.id, parsed.username || '', parsed.role);
      if (parsed.role === 'guest' || parsed.id > 9000000 || (parsed.username && parsed.username.startsWith('guest_'))) {
        parsed.isGuest = true;
      }
      return parsed;
    }
  } catch {
    // Ignore
  }
  return null;
}

export function logoutUser(): void {
  try {
    const saved = getSavedUserSession();
    if (saved?.id) {
      void unregisterUserFcmToken(saved.id);
    }
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem('sami_active_uid');
    localStorage.removeItem('sami_active_uname');
  } catch {
    // Ignore
  }
}

// ============================================================================
// OWNER (SAMI) & USER PROFILE CLOUD ACTIONS
// ============================================================================

export async function createCloudUser(params: {
  username: string;
  displayName?: string;
  password: string;
  role?: UserRole;
}): Promise<UserAccount> {
  const trimmedUsername = params.username.trim();
  const trimmedDisplay = (params.displayName || params.username).trim();
  const trimmedPassword = params.password.trim();

  if (!trimmedUsername || !trimmedPassword) {
    throw new Error('يرجى إدخال اسم المستخدم وكلمة المرور.');
  }

  const existing = await ensureCloudUsersInitialized();
  if (existing.some((u) => u.username.toLowerCase() === trimmedUsername.toLowerCase())) {
    throw new Error('اسم المستخدم موجود مسبقاً.');
  }

  const maxId = existing.reduce((max, u) => Math.max(max, u.id), 20);
  const newId = maxId + 1;
  const now = Date.now();
  const role: UserRole = params.role === 'moderator' ? 'moderator' : 'user';

  const newUser: UserAccount = {
    id: newId,
    username: trimmedUsername,
    displayName: trimmedDisplay,
    password: trimmedPassword,
    role,
    avatarUrl: null,
    verifiedChannels: {},
    warningsCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(db, USERS_COLLECTION, String(newId)), newUser);
  return newUser;
}

export async function updateCloudUser(
  userId: number,
  updates: Partial<Pick<UserAccount, 'displayName' | 'password' | 'role' | 'avatarUrl' | 'warningsCount'>>
): Promise<void> {
  const payload: Record<string, unknown> = {
    updatedAt: Date.now(),
  };
  if (updates.displayName !== undefined) payload.displayName = updates.displayName.trim();
  if (updates.password !== undefined) payload.password = updates.password.trim();
  if (updates.role !== undefined && userId !== 1) payload.role = updates.role;
  if (updates.avatarUrl !== undefined) payload.avatarUrl = updates.avatarUrl;
  if (updates.warningsCount !== undefined) payload.warningsCount = updates.warningsCount;

  await updateDoc(doc(db, USERS_COLLECTION, String(userId)), payload);
}

export async function deleteCloudUser(userId: number): Promise<void> {
  if (userId === 1) {
    throw new Error('لا يمكن حذف حساب القائد Sami.');
  }
  await deleteDoc(doc(db, USERS_COLLECTION, String(userId)));
}

export async function uploadUserAvatar(
  userId: number,
  fileOrDataUrl: File | string
): Promise<string> {
  const uploaded = await uploadImageToCloud(fileOrDataUrl, 'avatars', userId);
  await updateDoc(doc(db, USERS_COLLECTION, String(userId)), {
    avatarUrl: uploaded.imageUrl,
    updatedAt: Date.now(),
  });
  return uploaded.imageUrl;
}

export async function saveVerifiedChannelPassword(
  userId: number,
  channelId: string,
  passwordUsed: string,
  currentVerified?: Record<string, string>,
  currentMemberIds?: number[]
): Promise<Record<string, string>> {
  const updatedMap = {
    ...(currentVerified || {}),
    [channelId]: passwordUsed,
  };
  try {
    await updateDoc(doc(db, USERS_COLLECTION, String(userId)), {
      verifiedChannels: updatedMap,
      updatedAt: Date.now(),
    });
    if (currentMemberIds && !currentMemberIds.includes(userId)) {
      const updatedMembers = Array.from(new Set([1, ...currentMemberIds, userId]));
      await updateDoc(doc(db, 'community_channels', channelId), {
        memberIds: updatedMembers,
        updatedAt: Date.now(),
      });
    }
  } catch {
    // Ignore offline error, still saved in session
  }
  return updatedMap;
}

