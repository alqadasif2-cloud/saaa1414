import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Image as ImageIcon,
  Camera,
  Plus,
  FileText,
  File,
  Eye,
  EyeOff,
  WifiOff,
  Clock,
  X,
  Maximize2,
  Users,
  AlertCircle,
  Lock,
  ArrowRight,
  Mail,
  AlertTriangle,
  UserX,
  ShieldAlert,
  Check,
  CornerDownRight,
  Edit3,
  Trash2,
  Reply,
  Copy,
  ChevronLeft,
  Crown,
  BarChart3,
  Award,
  Search,
  MessageSquare,
} from 'lucide-react';
import {
  CommunityChannel,
  ChatMessage,
  PrivateMessage,
  ChatReplyInfo,
  subscribeToChannels,
  subscribeToChannelMessages,
  sendChannelMessage,
  editChannelMessage,
  deleteChannelMessage,
  subscribeToPrivateMessages,
  sendPrivateMessage,
  editPrivateMessage,
  deletePrivateMessage,
  issueWarningToMember,
  kickMemberFromChannelAndReport,
  getUserNameColor,
  getInitialChannelsFromCache,
} from '../data/chat';
import {
  CurrentUser,
  UserAccount,
  subscribeToCommunityUsers,
  saveVerifiedChannelPassword,
  uploadUserAvatar,
  getCachedUsers,
} from '../data/auth';
import { processImageFile } from '../utils/image';
import { uploadFileToCloud, UploadedFileResult, formatFileSize } from '../services/firebase';
import { CloudImage } from './CloudImage';
import { ImageViewerModal } from './ImageViewerModal';
import { MessageBubble } from './MessageBubble';
import { SubscriptionPlan } from '../types/subscription';
import { subscribeToSubscriptionPlans, getInitialPlansFromCache } from '../services/subscriptions';
import { SubscriptionDetailModal } from './SubscriptionDetailModal';
import { PermissionRationaleModal, PermissionType } from './PermissionRationaleModal';

export const isChannelAccessible = (ch: CommunityChannel, user: CurrentUser): boolean => {
  if (user.id === 1 || user.role === 'owner') return true;
  if (ch.visibility === 'hidden') {
    const allowed = ch.allowedMemberIds || ch.memberIds || [];
    return allowed.includes(user.id);
  }
  return true;
};

interface GroupChatScreenProps {
  currentUser: CurrentUser;
  initialMode?: 'channels' | 'private_chat';
  targetChannelId?: string | null;
  targetMessageId?: string | null;
  targetPartnerId?: number | null;
  targetInitialText?: string | null;
  onTargetConsumed?: () => void;
  onRequestPackageSupport?: (plan: SubscriptionPlan) => void;
  onOpenGuestSupport?: () => void;
  onUserUpdated?: (updated: Partial<CurrentUser>) => void;
  onActiveConversationChanged?: (info: {
    channelId: string | null;
    isPrivate: boolean;
    partnerId: number | null;
  }) => void;
}

export const GroupChatScreen: React.FC<GroupChatScreenProps> = ({
  currentUser,
  initialMode = 'channels',
  targetChannelId,
  targetMessageId,
  targetPartnerId,
  targetInitialText,
  onTargetConsumed,
  onRequestPackageSupport,
  onOpenGuestSupport,
  onUserUpdated,
  onActiveConversationChanged,
}) => {
  const [channels, setChannels] = useState<CommunityChannel[]>(() =>
    getInitialChannelsFromCache(currentUser.id)
  );
  const [users, setUsers] = useState<UserAccount[]>(() => getCachedUsers());
  const [isChannelsLoading, setIsChannelsLoading] = useState(
    () => getInitialChannelsFromCache(currentUser.id).length === 0
  );
  const [selectedChannel, setSelectedChannel] = useState<CommunityChannel | null>(null);
  const [isPrivateChatOpen, setIsPrivateChatOpen] = useState(
    initialMode === 'private_chat' || Boolean(targetPartnerId)
  );
  const [ownerSelectedPmUserId, setOwnerSelectedPmUserId] = useState<number | null>(() => {
    if (targetPartnerId) return targetPartnerId;
    if (currentUser.isGuest) {
      const savedMod = localStorage.getItem(`sami_guest_active_mod_${currentUser.id}`);
      if (savedMod) return Number(savedMod) || 1;
      return 1;
    }
    return null;
  });

  // Password Prompt Modal for first-time channel entry
  const [pendingPasswordChannel, setPendingPasswordChannel] = useState<CommunityChannel | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Moderator / Owner Member Supervision Modal inside Channel
  const [supervisionModalOpen, setSupervisionModalOpen] = useState(false);
  const [actionTargetUser, setActionTargetUser] = useState<UserAccount | null>(null);
  const [actionType, setActionType] = useState<'warning' | 'kick'>('warning');
  const [actionReason, setActionReason] = useState('');
  const [actionEvidenceFile, setActionEvidenceFile] = useState<File | null>(null);
  const [isExecutingAction, setIsExecutingAction] = useState(false);
  const evidenceInputRef = useRef<HTMLInputElement>(null);

  // Messages state
  const [channelMessages, setChannelMessages] = useState<ChatMessage[]>([]);
  const [privateMessages, setPrivateMessages] = useState<PrivateMessage[]>([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>(() =>
    getInitialPlansFromCache()
  );
  const [viewingSubscriptionPlan, setViewingSubscriptionPlan] = useState<SubscriptionPlan | null>(null);

  // Debounced/guarded opening for subscription details
  const handleOpenSubscriptionPlan = useCallback((sub: SubscriptionPlan) => {
    setViewingSubscriptionPlan((prev) => (prev?.id === sub.id ? prev : sub));
  }, []);
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewModalImage, setPreviewModalImage] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSending, setIsSending] = useState(false);
  const [alertBanner, setAlertBanner] = useState<string | null>(null);
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Reply & Edit & Highlight States
  const [replyTarget, setReplyTarget] = useState<ChatReplyInfo | null>(null);
  const [editingMessage, setEditingMessage] = useState<{
    id: string;
    text: string;
    isPrivate: boolean;
    senderId: number;
  } | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [confirmDeleteModal, setConfirmDeleteModal] = useState<{
    isOpen: boolean;
    msg: ChatMessage | PrivateMessage | null;
    isPrivate: boolean;
  }>({ isOpen: false, msg: null, isPrivate: false });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileAttachmentInputRef = useRef<HTMLInputElement>(null);
  const [selectedFileAttachment, setSelectedFileAttachment] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [permissionModalType, setPermissionModalType] = useState<PermissionType | null>(null);

  useEffect(() => {
    setIsPrivateChatOpen(initialMode === 'private_chat');
  }, [initialMode]);

  useEffect(() => {
    const unsub = subscribeToSubscriptionPlans((plans) => {
      setSubscriptionPlans(plans);
      setViewingSubscriptionPlan((prev) => {
        if (!prev) return null;
        return plans.find((p) => p.id === prev.id) || prev;
      });
    });
    return () => unsub();
  }, []);

  const showBannerError = (msg: string) => {
    setAlertBanner(msg);
    setTimeout(() => {
      setAlertBanner((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Subscribe to Channels and Users
  useEffect(() => {
    const unsubChannels = subscribeToChannels((liveChannels) => {
      setChannels(liveChannels);
      setIsChannelsLoading(false);
      setSelectedChannel((prev) => {
        if (!prev) return null;
        const updated = liveChannels.find((c) => c.id === prev.id);
        if (!updated) return null;
        return updated;
      });
    }, currentUser.id);
    const unsubUsers = subscribeToCommunityUsers(setUsers);
    return () => {
      unsubChannels();
      unsubUsers();
    };
  }, [currentUser.id, currentUser.role]);

  const liveCurrentUserDoc = users.find((u) => u.id === currentUser.id);
  const currentAvatarUrl = liveCurrentUserDoc?.avatarUrl ?? currentUser.avatarUrl;
  const currentVerifiedMap =
    liveCurrentUserDoc?.verifiedChannels ?? currentUser.verifiedChannels ?? {};

  // If Owner Sami changes the password of an currently open channel or revokes verification, close it and prompt for new password
  useEffect(() => {
    if (!selectedChannel) return;
    if (currentUser.role === 'owner' || currentUser.id === 1) return;
    if (
      selectedChannel.password &&
      currentVerifiedMap[selectedChannel.id] !== selectedChannel.password
    ) {
      const chToPrompt = selectedChannel;
      setSelectedChannel(null);
      setPendingPasswordChannel(chToPrompt);
      setPasswordInput('');
      setPasswordError('تم تحديث كلمة مرور القناة، يرجى إدخال كلمة المرور الجديدة للدخول.');
    }
  }, [selectedChannel, currentVerifiedMap, currentUser.role, currentUser.id]);

  // Subscribe to active channel messages (ONLY after password verification and channel open)
  useEffect(() => {
    if (!selectedChannel) {
      setChannelMessages([]);
      return;
    }
    const unsub = subscribeToChannelMessages(
      selectedChannel.id,
      setChannelMessages,
      showBannerError
    );
    return () => unsub();
  }, [selectedChannel]);

  // Subscribe to permanent private messages
  useEffect(() => {
    if (!isPrivateChatOpen) return;
    const participantId =
      currentUser.id === 1 || currentUser.role === 'moderator'
        ? ownerSelectedPmUserId
        : currentUser.id;
    const unsub = subscribeToPrivateMessages(participantId, setPrivateMessages);
    return () => unsub();
  }, [isPrivateChatOpen, currentUser.id, currentUser.role, ownerSelectedPmUserId]);

  // Handle Deep Link to Channel or Private Chat
  useEffect(() => {
    if (targetChannelId && channels.length > 0) {
      const found = channels.find((c) => c.id === targetChannelId);
      if (found) {
        setSelectedChannel(found);
        setIsPrivateChatOpen(false);
      }
    }
  }, [targetChannelId, channels]);

  useEffect(() => {
    if (targetPartnerId) {
      setIsPrivateChatOpen(true);
      setSelectedChannel(null);
      setOwnerSelectedPmUserId(targetPartnerId);
      if (currentUser.isGuest) {
        localStorage.setItem(`sami_guest_active_mod_${currentUser.id}`, String(targetPartnerId));
      }
      if (targetInitialText) {
        setInputText(targetInitialText);
      }
      onTargetConsumed?.();
    }
  }, [targetPartnerId, targetInitialText, onTargetConsumed, currentUser.id, currentUser.isGuest]);

  // Handle Deep Link to Specific Message (Smooth scroll & 2-second highlight)
  useEffect(() => {
    if (!targetMessageId) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`chat-msg-${targetMessageId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedMessageId(targetMessageId);
        setTimeout(() => {
          setHighlightedMessageId((prev) => (prev === targetMessageId ? null : prev));
        }, 2000);
        onTargetConsumed?.();
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [targetMessageId, channelMessages, privateMessages, onTargetConsumed]);

  useEffect(() => {
    onActiveConversationChanged?.({
      channelId: isPrivateChatOpen ? null : selectedChannel?.id || null,
      isPrivate: isPrivateChatOpen,
      partnerId: isPrivateChatOpen ? (currentUser.id === 1 ? ownerSelectedPmUserId : 1) : null,
    });
  }, [isPrivateChatOpen, selectedChannel?.id, ownerSelectedPmUserId, currentUser.id, onActiveConversationChanged]);

  useEffect(() => {
    if (!targetMessageId) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [channelMessages, privateMessages, targetMessageId]);

  // Guard access to hidden channels
  useEffect(() => {
    if (selectedChannel && !isChannelAccessible(selectedChannel, currentUser)) {
      const fallback = channels.find((c) => isChannelAccessible(c, currentUser));
      setSelectedChannel(fallback || null);
      showBannerError('🔒 هذه القناة خاصة ومخفية، وليس لديك تصريح للوصول إليها.');
    }
  }, [selectedChannel, channels, currentUser]);

  // Filter channels: normal channels are visible to all; hidden channels only to authorized members
  const visibleChannels = channels.filter((ch) => {
    if (!isChannelAccessible(ch, currentUser)) return false;
    if (searchQuery.trim() && !ch.name.toLowerCase().includes(searchQuery.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  // Enter Channel Handler (checks independent channel password on first entry or if Sami changed it)
  const handleChannelClick = (ch: CommunityChannel) => {
    if (!isChannelAccessible(ch, currentUser)) {
      showBannerError('🔒 هذه القناة خاصة ومخفية وليس لديك تصريح للوصول إليها.');
      return;
    }
    if (currentUser.isGuest) {
      showBannerError('🔒 القنوات الخاصة متاحة للأعضاء المسجلين فقط. يمكنك استعراض باقات الانضمام عبر البطاقات أعلاه أو التواصل مع الدعم.');
      return;
    }
    if (currentUser.role === 'owner' || currentUser.id === 1 || !ch.password) {
      setSelectedChannel(ch);
      return;
    }
    const verifiedWith = currentVerifiedMap[ch.id];
    if (verifiedWith === ch.password) {
      setSelectedChannel(ch);
    } else {
      setPendingPasswordChannel(ch);
      setPasswordInput('');
      setPasswordError(null);
    }
  };

  const handleVerifyChannelPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingPasswordChannel) return;
    if (passwordInput.trim() === pendingPasswordChannel.password) {
      const updatedMap = await saveVerifiedChannelPassword(
        currentUser.id,
        pendingPasswordChannel.id,
        pendingPasswordChannel.password,
        currentVerifiedMap,
        pendingPasswordChannel.memberIds
      );
      onUserUpdated?.({ verifiedChannels: updatedMap });
      const target = pendingPasswordChannel;
      setPendingPasswordChannel(null);
      setPasswordInput('');
      setPasswordError(null);
      setSelectedChannel(target);
    } else {
      setPasswordError('كلمة مرور القناة غير صحيحة، يرجى المحاولة مرة أخرى.');
    }
  };

  // Profile Avatar Upload Handler
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const newUrl = await uploadUserAvatar(currentUser.id, file);
      onUserUpdated?.({ avatarUrl: newUrl });
    } catch {
      showBannerError('تعذر تحديث الصورة الشخصية.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  // Handle attachment image selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      showBannerError('حجم الصورة كبير جداً، يرجى اختيار صورة أقل من 15 ميغابايت.');
      return;
    }
    try {
      const compressedDataUrl = await processImageFile(file, 1920, 0.9);
      setSelectedImage(compressedDataUrl);
      setSelectedFile(file);
      setAlertBanner(null);
    } catch {
      showBannerError('تعذر معالجة الصورة المختارة.');
    }
  };

  // Handle attachment file selection (PDF, Docs, Excel, Zip, etc.)
  const handleAttachmentFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const maxBytes = 25 * 1024 * 1024; // 25MB
    if (file.size > maxBytes) {
      showBannerError('حجم الملف كبير جداً. الحد الأقصى المسموح هو 25 ميجابايت.');
      return;
    }
    setSelectedFileAttachment(file);
    setSelectedImage(null);
    setSelectedFile(null);
    setAlertBanner(null);
  };

  const handleTriggerAttachFile = () => {
    const seen = localStorage.getItem('sami_perm_seen_files');
    if (!seen) {
      setPermissionModalType('files');
    } else {
      fileAttachmentInputRef.current?.click();
    }
  };

  const handleTriggerCamera = () => {
    const seen = localStorage.getItem('sami_perm_seen_camera');
    if (!seen) {
      setPermissionModalType('camera');
    } else {
      cameraInputRef.current?.click();
    }
  };

  const handlePermissionModalConfirm = () => {
    const currType = permissionModalType;
    setPermissionModalType(null);
    if (currType === 'camera') {
      localStorage.setItem('sami_perm_seen_camera', 'true');
      cameraInputRef.current?.click();
    } else if (currType === 'files') {
      localStorage.setItem('sami_perm_seen_files', 'true');
      fileAttachmentInputRef.current?.click();
    } else if (currType === 'notifications') {
      localStorage.setItem('sami_perm_seen_notifications', 'true');
    }
  };

  // Toast notice helper
  const showToastNotice = (msg: string) => {
    setToastNotice(msg);
    setTimeout(() => {
      setToastNotice((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  // Reply handlers
  const handleStartReply = (msg: ChatMessage | PrivateMessage) => {
    setEditingMessage(null);
    setReplyTarget({
      id: msg.id,
      senderName: msg.senderName,
      text: msg.isDeleted
        ? 'تم حذف الرسالة الأصلية.'
        : msg.text || (msg.imageUrl ? '📷 صورة' : ''),
      isDeleted: Boolean(msg.isDeleted),
    });
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  };

  const handleCancelReply = () => {
    setReplyTarget(null);
  };

  // Edit handlers
  const handleStartEdit = (msg: ChatMessage | PrivateMessage, isPrivate: boolean) => {
    setReplyTarget(null);
    setEditingMessage({
      id: msg.id,
      text: msg.text || '',
      isPrivate,
      senderId: msg.senderId,
    });
    setInputText(msg.text || '');
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
      }
    }, 50);
  };

  const handleCancelEdit = () => {
    setEditingMessage(null);
    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  // Copy handler
  const handleCopyMessage = async (msg: ChatMessage | PrivateMessage) => {
    if (!msg.text) return;
    try {
      await navigator.clipboard.writeText(msg.text);
      showToastNotice('تم نسخ نص الرسالة إلى الحافظة ✓');
    } catch {
      showBannerError('تعذر نسخ النص.');
    }
  };

  // Delete handlers
  const handleRequestDelete = (msg: ChatMessage | PrivateMessage, isPrivate: boolean) => {
    setConfirmDeleteModal({ isOpen: true, msg, isPrivate });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteModal.msg) return;
    const { msg, isPrivate } = confirmDeleteModal;
    setConfirmDeleteModal({ isOpen: false, msg: null, isPrivate: false });
    try {
      const isOwner = currentUser.role === 'owner' || currentUser.id === 1;
      if (isPrivate) {
        await deletePrivateMessage(msg as PrivateMessage, currentUser.id, isOwner);
      } else {
        await deleteChannelMessage(msg as ChatMessage, currentUser.id, isOwner);
      }
      showToastNotice('تم حذف الرسالة بنجاح.');
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'تعذر حذف الرسالة.';
      showBannerError(errorMsg);
    }
  };

  // Scroll to original message when clicking reply quote
  const handleQuoteClick = (targetId: string) => {
    setHighlightedMessageId(targetId);
    const el = document.getElementById(`chat-msg-${targetId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(() => {
      setHighlightedMessageId((prev) => (prev === targetId ? null : prev));
    }, 2000);
  };

  // Dynamic textarea input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
    }
  };

  // Handle Enter key for desktop sending
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  // Send or Edit Message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isOnline) {
      showBannerError('لا يوجد اتصال بالإنترنت.');
      return;
    }
    const trimmed = inputText.trim();

    // If Editing
    if (editingMessage) {
      if (!trimmed) {
        showBannerError('لا يمكن حفظ رسالة فارغة.');
        return;
      }
      setIsSending(true);
      setAlertBanner(null);
      try {
        if (editingMessage.isPrivate) {
          await editPrivateMessage(
            editingMessage.id,
            trimmed,
            currentUser.id,
            editingMessage.senderId
          );
        } else {
          await editChannelMessage(
            editingMessage.id,
            trimmed,
            currentUser.id,
            editingMessage.senderId
          );
        }
        setEditingMessage(null);
        setInputText('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
        showToastNotice('تم تعديل الرسالة بنجاح ✓');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'تعذر حفظ التعديل.';
        showBannerError(errorMsg);
      } finally {
        setIsSending(false);
      }
      return;
    }

    // Normal Send or Reply Send
    if (!trimmed && !selectedImage && !selectedFileAttachment) return;

    setIsSending(true);
    setAlertBanner(null);
    setUploadProgress(null);
    try {
      let fileAttachmentResult: UploadedFileResult | null = null;
      if (selectedFileAttachment) {
        fileAttachmentResult = await uploadFileToCloud(
          selectedFileAttachment,
          'chat_files',
          currentUser.id,
          (percent) => setUploadProgress(percent)
        );
      }

      if (isPrivateChatOpen) {
        const isSupervisor = currentUser.id === 1 || currentUser.role === 'moderator';
        const partnerId = isSupervisor ? ownerSelectedPmUserId : (ownerSelectedPmUserId || 1);
        if (!partnerId) return;
        const targetParticipantId = isSupervisor ? partnerId : currentUser.id;
        const targetUserObj = users.find((u) => u.id === targetParticipantId);
        const participantDisplayName = isSupervisor
          ? (targetUserObj?.displayName || (targetParticipantId > 9000000 ? `ضيف رقم ${targetParticipantId - 9000000}` : 'مستخدم'))
          : currentUser.displayName;

        await sendPrivateMessage({
          participantId: targetParticipantId,
          participantName: participantDisplayName,
          sender: {
            id: currentUser.id,
            displayName: currentUser.displayName,
            role: currentUser.role,
            avatarUrl: currentAvatarUrl,
          },
          receiverId: partnerId,
          text: trimmed || undefined,
          imageFileOrDataUrl: selectedFile || selectedImage,
          fileAttachment: fileAttachmentResult,
          replyTo: replyTarget,
        });
      } else if (selectedChannel) {
        await sendChannelMessage(
          selectedChannel,
          {
            id: currentUser.id,
            displayName: currentUser.displayName,
            role: currentUser.role,
            avatarUrl: currentAvatarUrl,
          },
          {
            text: trimmed || undefined,
            imageUrl: selectedImage || undefined,
            imageFile: selectedFile || undefined,
            fileAttachment: fileAttachmentResult,
          },
          replyTarget
        );
      }
      setInputText('');
      setSelectedImage(null);
      setSelectedFile(null);
      setSelectedFileAttachment(null);
      setUploadProgress(null);
      setReplyTarget(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch {
      showBannerError('تعذر إرسال الرسالة، يرجى التحقق من اتصال الإنترنت.');
    } finally {
      setIsSending(false);
      setUploadProgress(null);
    }
  };

  // Execute Moderator / Owner Warning or Kick
  const handleExecuteSupervisionAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChannel || !actionTargetUser || !actionReason.trim()) return;
    setIsExecutingAction(true);
    try {
      if (actionType === 'warning') {
        await issueWarningToMember({
          channel: selectedChannel,
          targetUser: actionTargetUser,
          issuer: {
            id: currentUser.id,
            displayName: currentUser.displayName,
            role: currentUser.role,
            avatarUrl: currentAvatarUrl,
          },
          reason: actionReason.trim(),
          evidenceFileOrDataUrl: actionEvidenceFile,
        });
      } else {
        await kickMemberFromChannelAndReport({
          channel: selectedChannel,
          targetUser: actionTargetUser,
          issuer: {
            id: currentUser.id,
            displayName: currentUser.displayName,
            role: currentUser.role,
            avatarUrl: currentAvatarUrl,
          },
          reason: actionReason.trim(),
          evidenceFileOrDataUrl: actionEvidenceFile,
        });
      }
      setActionTargetUser(null);
      setActionReason('');
      setActionEvidenceFile(null);
      setSupervisionModalOpen(false);
    } catch {
      showBannerError('تعذر تنفيذ الإجراء، حاول مرة أخرى.');
    } finally {
      setIsExecutingAction(false);
    }
  };

  const formatMessageTime = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString('ar-SA', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Helper to resolve latest user info (avatar & role)
  const getSenderMeta = (senderId: number, fallbackRole?: string, fallbackAvatar?: string | null) => {
    const found = users.find((u) => u.id === senderId);
    const role =
      senderId === 1
        ? 'owner'
        : found?.role || (fallbackRole === 'moderator' ? 'moderator' : 'user');
    const avatarUrl = found?.avatarUrl || fallbackAvatar || null;
    const warningsCount = found?.warningsCount || 0;
    return { role, avatarUrl, warningsCount };
  };

  // ============================================================================
  // VIEW 1: CHANNELS DIRECTORY LIST (when no channel or private chat is open)
  // ============================================================================
  if (!selectedChannel && !isPrivateChatOpen) {
    const isOwnerUser = currentUser.role === 'owner' || currentUser.id === 1;

    return (
      <div
        dir="rtl"
        className="relative space-y-3.5 pb-24 text-right animate-in fade-in duration-300 font-['Cairo'] select-none"
      >
        <input
          type="file"
          ref={avatarInputRef}
          onChange={handleAvatarUpload}
          accept="image/*"
          className="hidden"
        />

        {/* Ambient Financial Glow */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden z-0 opacity-25">
          <div className="absolute -top-20 right-10 w-64 h-64 bg-amber-500/15 rounded-full blur-3xl" />
          <div className="absolute bottom-24 -left-16 w-64 h-64 bg-amber-600/10 rounded-full blur-3xl" />
        </div>

        {/* Top Luxury Header Card: User Profile + Private Chat Pill */}
        <div className="relative z-10 overflow-hidden rounded-3xl bg-gradient-to-l from-[#141d33]/95 via-[#0d1424]/98 to-[#0a101d]/95 border border-amber-500/35 p-3.5 flex items-center justify-between shadow-[0_10px_28px_rgba(0,0,0,0.7),0_0_18px_rgba(245,158,11,0.12)]">
          {/* Subtle diagonal golden light streak */}
          <div
            className="pointer-events-none absolute inset-0 opacity-25"
            style={{
              background:
                'linear-gradient(125deg, transparent 30%, rgba(251, 191, 36, 0.16) 50%, transparent 70%)',
            }}
          />

          {/* Right side (RTL): Circular Golden Avatar + User Name & Crown */}
          <div className="relative z-10 flex items-center gap-3">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="relative cursor-pointer active:scale-95 transition-transform"
              title="تغيير صورتك الشخصية"
            >
              <div className="w-14 h-14 rounded-full p-[2px] bg-gradient-to-b from-amber-300 via-amber-500 to-amber-700 shadow-[0_0_18px_rgba(245,158,11,0.45)]">
                {currentAvatarUrl ? (
                  <CloudImage
                    src={currentAvatarUrl}
                    alt={currentUser.displayName}
                    className="w-full h-full rounded-full object-cover bg-[#080d1a]"
                  />
                ) : (
                  <img
                    src="/app-icon.png"
                    alt={currentUser.displayName}
                    className="w-full h-full rounded-full object-cover bg-[#080d1a]"
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 text-slate-950 flex items-center justify-center border-2 border-[#0d1424] shadow-md">
                {uploadingAvatar ? (
                  <span className="w-2.5 h-2.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                ) : isOwnerUser ? (
                  <Crown className="w-3 h-3 text-slate-950" />
                ) : (
                  <Camera className="w-3 h-3 text-slate-950" />
                )}
              </span>
            </button>

            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-base sm:text-lg font-black gold-gradient-text tracking-wide">
                  {currentUser.displayName}
                </span>
                {isOwnerUser ? (
                  <Crown className="w-5 h-5 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
                ) : currentUser.role === 'moderator' ? (
                  <span className="text-[10px] font-black text-emerald-300 bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.5 rounded-md">
                    🛡️ مشرف
                  </span>
                ) : null}
              </div>
              <span className="text-[10.5px] text-slate-400 font-medium block">
                {isOwnerUser ? 'القائد والمالك العام' : 'اضغط على الصورة لتحديثها'}
              </span>
            </div>
          </div>

          {/* Left side (RTL): Golden-Bordered Private Chat Button */}
          <button
            type="button"
            onClick={() => setIsPrivateChatOpen(true)}
            className="relative z-10 px-3.5 py-2 rounded-2xl bg-gradient-to-r from-[#241a08]/90 via-[#1a1307]/95 to-[#241a08]/90 hover:from-[#30220a] hover:to-[#30220a] border border-amber-400/65 text-amber-300 font-extrabold text-xs flex items-center gap-2 shadow-[0_0_16px_rgba(245,158,11,0.22)] active:scale-95 transition cursor-pointer"
          >
            <span>{currentUser.id === 1 ? 'الرسائل الخاصة' : 'محادثة خاصة'}</span>
            <span className="w-6 h-6 rounded-lg bg-amber-400/20 border border-amber-400/50 flex items-center justify-center text-amber-400">
              <MessageSquare className="w-3.5 h-3.5" />
            </span>
          </button>
        </div>

        {/* Luxury Subscriptions & VIP Channels Showcase Banner */}
        {subscriptionPlans.length > 0 && (
          <div className="relative z-10 p-4 rounded-3xl bg-gradient-to-r from-amber-500/15 via-[#0e172a] to-amber-500/10 border border-amber-500/35 shadow-[0_10px_30px_rgba(0,0,0,0.6)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-400 shrink-0" />
                <div>
                  <h3 className="text-xs sm:text-sm font-black text-white">
                    باقات واشتراكات القنوات الخاصة (Sami VIP والرحلة)
                  </h3>
                  <p className="text-[10.5px] text-slate-300">
                    الأسعار المعتمدة والتفاصيل الكاملة وشروط الانضمام
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-400 text-slate-950">
                5 باقات معتمدة
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {subscriptionPlans.map((sub) => {
                const isVip = sub.id === 'sami_vip';
                const isClosed = !sub.isActive || sub.status === 'closed';
                return (
                  <div
                    key={sub.id}
                    onClick={() => handleOpenSubscriptionPlan(sub)}
                    className="p-3 rounded-2xl bg-[#090f1d]/90 hover:bg-[#0e162a] border border-amber-500/20 hover:border-amber-400/50 transition cursor-pointer flex items-center justify-between gap-2.5 group"
                  >
                    {sub.imageUrl && (
                      <img
                        src={sub.imageUrl}
                        alt={sub.name}
                        className="w-10 h-10 rounded-xl object-cover border border-amber-400/40 shrink-0"
                      />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-black text-white group-hover:text-amber-300 transition truncate">
                          {sub.name}
                        </span>
                        {isVip && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-400 text-slate-950 shrink-0">
                            VIP
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs font-mono font-black text-amber-400">
                          {sub.price} {sub.currency}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {sub.durationDays > 0 ? `• ${sub.durationDays} يوم` : ''}
                        </span>
                        {isClosed ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">
                            مغلق
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                            متاح
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenSubscriptionPlan(sub);
                      }}
                      className="px-2.5 py-1 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-[10.5px] font-bold shrink-0 flex items-center gap-1 group-hover:scale-105 transition cursor-pointer"
                    >
                      <span>التفاصيل الكاملة</span>
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Section Title: القنوات */}
        <div className="relative z-10 flex items-center justify-between pt-1 px-1">
          <div className="flex items-center gap-2.5">
            <Users className="w-6 h-6 text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.55)]" />
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              القنوات
            </h2>
          </div>
          <span className="text-[11px] font-bold text-amber-400/90 bg-amber-500/10 border border-amber-500/25 px-2.5 py-1 rounded-full">
            {isChannelsLoading && channels.length === 0 ? 'جاري التحميل...' : `${visibleChannels.length} قناة`}
          </span>
        </div>

        {/* Modern Search Box (مربع البحث) */}
        <div className="relative z-10">
          <div className="flex items-center justify-between bg-[#0c1322]/95 border border-slate-700/80 focus-within:border-amber-400/80 focus-within:shadow-[0_0_20px_rgba(245,158,11,0.22)] rounded-2xl px-4 py-2.5 transition-all duration-200 shadow-inner">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث عن قناة..."
              className="flex-1 bg-transparent text-xs sm:text-sm text-white placeholder-slate-400 outline-none font-medium text-right"
            />
            <div className="flex items-center gap-1.5 mr-2">
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-slate-400 hover:text-amber-400 transition cursor-pointer flex items-center"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <Search className="w-4 h-4 text-slate-400" />
            </div>
          </div>
        </div>

        {/* Luxury Channels Cards List */}
        {isChannelsLoading && channels.length === 0 ? (
          <div className="relative z-10 space-y-3">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className="luxury-channel-card relative overflow-hidden rounded-3xl p-4 flex items-center justify-between animate-pulse"
              >
                <div className="flex items-center gap-3.5 flex-1">
                  <div className="w-16 h-16 rounded-full bg-slate-800/80 border border-amber-500/20" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-slate-800/80 rounded w-1/3" />
                    <div className="h-3 bg-slate-800/60 rounded w-1/4" />
                  </div>
                </div>
                <div className="w-8 h-8 rounded-full bg-slate-800/80" />
              </div>
            ))}
          </div>
        ) : visibleChannels.length === 0 ? (
          <div className="relative z-10 luxury-channel-card rounded-3xl p-8 text-center space-y-2">
            <Lock className="w-8 h-8 text-amber-400 mx-auto" />
            <p className="text-sm font-bold text-slate-200">
              {searchQuery.trim()
                ? 'لا توجد قنوات مطابقة لبحثك'
                : 'لا توجد قنوات متاحة حالياً'}
            </p>
            <p className="text-xs text-slate-400">
              {searchQuery.trim()
                ? 'جرب البحث بكلمة أخرى.'
                : 'يمكنك التواصل مع القائد Sami عبر البطاقة السفلية.'}
            </p>
          </div>
        ) : (
          <div className="relative z-10 space-y-3">
            {visibleChannels.map((ch, idx) => {
              const isVerified =
                isOwnerUser ||
                !ch.password ||
                currentVerifiedMap[ch.id] === ch.password;

              const isFeaturedFirst = idx === 0;

              return (
                <div
                  key={ch.id}
                  onClick={() => handleChannelClick(ch)}
                  className={`${
                    isFeaturedFirst ? 'luxury-channel-card-featured' : 'luxury-channel-card'
                  } relative overflow-hidden rounded-3xl p-3.5 sm:p-4 flex items-center justify-between cursor-pointer select-none group`}
                >
                  {/* Subtle Golden Top-Right Highlight on Card */}
                  <div className="pointer-events-none absolute -top-10 -right-10 w-28 h-28 bg-amber-400/10 rounded-full blur-2xl opacity-70 group-hover:opacity-100 transition-opacity" />

                  {/* Right Side (RTL): Circular Gold-Framed Channel Avatar + Details */}
                  <div className="relative z-10 flex items-center gap-3.5 min-w-0 flex-1">
                    {/* Circular Channel Image inside Golden Ring */}
                    <div className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-b from-amber-300 via-amber-500 to-amber-700 shadow-[0_4px_16px_rgba(245,158,11,0.35)] shrink-0">
                      {ch.imageUrl ? (
                        <CloudImage
                          src={ch.imageUrl}
                          alt={ch.name}
                          className="w-full h-full rounded-full object-cover bg-[#070b14]"
                        />
                      ) : (
                        <div
                          className="w-full h-full rounded-full bg-cover bg-center relative overflow-hidden flex items-center justify-center"
                          style={{ backgroundImage: "url('/background_image.jpg')" }}
                        >
                          <div className="absolute inset-0 bg-slate-950/45" />
                          <span className="relative z-10 text-amber-400 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                            <BarChart3 className="w-6 h-6" />
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Channel Name, Member Count, and Active Badge */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <h3 className="text-base sm:text-lg font-black text-white tracking-tight truncate group-hover:text-amber-200 transition-colors">
                        {ch.name}
                      </h3>

                      <div className="flex items-center gap-1.5 text-xs text-slate-300 font-semibold">
                        <Users className="w-3.5 h-3.5 text-slate-400" />
                        <span>{ch.memberIds.length} عضو</span>
                      </div>

                      <div className="pt-0.5 flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-950/90 border border-emerald-500/45 text-emerald-400 text-[11px] font-extrabold shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span>نشطة</span>
                        </span>

                        {isVerified && !isOwnerUser && (
                          <span className="text-[10px] font-bold text-amber-300/90 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded-full">
                            تم التحقق ✓
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Left Side (RTL): Golden Lock Icon + Entry Chevron */}
                  <div className="relative z-10 flex items-center gap-2 shrink-0 mr-2">
                    <span
                      title={
                        isVerified
                          ? 'تم التحقق من كلمة المرور'
                          : 'محمية بكلمة مرور القناة'
                      }
                      className="flex items-center"
                    >
                      <Lock className="w-5 h-5 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.45)]" />
                    </span>
                    <ChevronLeft className="w-5 h-5 text-slate-400 group-hover:text-amber-300 group-hover:-translate-x-0.5 transition-all" />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom Featured Luxury Golden Card (البطاقة السفلية الفاخرة) */}
        <div
          onClick={() => setIsPrivateChatOpen(true)}
          className="relative z-10 overflow-hidden rounded-3xl bg-gradient-to-r from-[#2b1d06]/95 via-[#181209]/98 to-[#2b1d06]/95 border-2 border-amber-400/75 p-4 flex items-center justify-between cursor-pointer shadow-[0_10px_30px_rgba(0,0,0,0.8),0_0_24px_rgba(245,158,11,0.25)] active:scale-[0.99] transition-all group"
        >
          {/* Golden wave glow overlay */}
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              background:
                'radial-gradient(circle at 85% 50%, rgba(251, 191, 36, 0.28), transparent 60%), radial-gradient(circle at 15% 50%, rgba(245, 158, 11, 0.22), transparent 60%)',
            }}
          />

          <div className="relative z-10 flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-gradient-to-b from-amber-300 via-amber-400 to-amber-500 text-slate-950 flex items-center justify-center shadow-[0_0_18px_rgba(251,191,36,0.55)] shrink-0">
              <MessageSquare className="w-6 h-6 text-slate-950" />
            </div>
            <div>
              <h3 className="text-base font-black text-white group-hover:text-amber-200 transition-colors">
                {currentUser.id === 1 ? 'صندوق الرسائل الخاصة' : 'مراسلة Sami'}
              </h3>
              <p className="text-xs text-slate-300 font-medium mt-0.5">
                محادثة خاصة ومستمرة
              </p>
            </div>
          </div>

          <div className="relative z-10 w-10 h-10 rounded-full bg-gradient-to-b from-amber-300 via-amber-400 to-amber-500 text-slate-950 flex items-center justify-center shadow-[0_0_14px_rgba(251,191,36,0.5)] group-hover:scale-105 transition-transform shrink-0">
            <ChevronLeft className="w-5 h-5 font-bold text-slate-950" />
          </div>
        </div>

        {/* Channel Password Prompt Modal (نافذة التحقق من كلمة مرور القناة) */}
        {pendingPasswordChannel && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <form
              onSubmit={handleVerifyChannelPassword}
              className="relative overflow-hidden bg-gradient-to-b from-[#141d33] to-[#0a0f1d] border-2 border-amber-400/60 rounded-3xl p-6 w-full max-w-sm space-y-4 shadow-[0_15px_40px_rgba(0,0,0,0.9),0_0_30px_rgba(245,158,11,0.25)]"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-amber-400/15 border border-amber-400/40 flex items-center justify-center text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.25)] shrink-0">
                  <Lock className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">
                    {pendingPasswordChannel.name}
                  </h3>
                  <p className="text-[11px] text-slate-300 font-medium mt-0.5">
                    هذه القناة محمية • أدخل كلمة المرور للدخول
                  </p>
                </div>
              </div>

              {passwordError && (
                <div className="p-3 rounded-2xl bg-rose-500/20 border border-rose-500/45 text-rose-200 text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{passwordError}</span>
                </div>
              )}

              <input
                type="password"
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  setPasswordError(null);
                }}
                placeholder="أدخل كلمة مرور القناة..."
                required
                autoFocus
                className="w-full bg-[#070b14] border border-slate-700 focus:border-amber-400 rounded-2xl px-4 py-3.5 text-sm text-white placeholder-slate-500 outline-none shadow-inner transition"
              />

              <div className="flex gap-2.5 pt-1">
                <button
                  type="submit"
                  className="flex-1 py-3.5 rounded-2xl gold-cta-button text-slate-950 font-black text-xs sm:text-sm cursor-pointer"
                >
                  فتح القناة والدخول
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingPasswordChannel(null);
                    setPasswordError(null);
                  }}
                  className="px-5 py-3.5 rounded-2xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Subscription Details & VIP Terms Modal for Users */}
        {viewingSubscriptionPlan && (
          <SubscriptionDetailModal
            key={viewingSubscriptionPlan.id}
            plan={viewingSubscriptionPlan}
            currentUser={currentUser}
            onClose={() => setViewingSubscriptionPlan(null)}
            onStartInquiry={(message) => {
              setInputText(message);
              setSelectedChannel(null);
              setIsPrivateChatOpen(true);
            }}
            onRequestPackageSupport={(plan) => {
              setViewingSubscriptionPlan(null);
              onRequestPackageSupport?.(plan);
            }}
          />
        )}
      </div>
    );
  }

  // ============================================================================
  // VIEW 2: PERMANENT PRIVATE CHAT WITH SAMI
  // ============================================================================
  if (isPrivateChatOpen) {
    const isSupervisor = currentUser.id === 1 || currentUser.role === 'moderator';

    // If Supervisor hasn't picked a user thread yet, show user selector
    if (isSupervisor && !ownerSelectedPmUserId) {
      const threadsMap = new Map<number, { userId: number; name: string; lastText: string; isGuest?: boolean }>();
      privateMessages.forEach((pm) => {
        const isGuestId = pm.participantId > 9000000;
        const displayName = pm.participantName || (isGuestId ? `ضيف رقم ${pm.participantId - 9000000}` : 'مستخدم');
        threadsMap.set(pm.participantId, {
          userId: pm.participantId,
          name: displayName,
          lastText: pm.text || (pm.imageUrl ? '📷 صورة مرفقة' : 'رسالة جديدة'),
          isGuest: isGuestId,
        });
      });

      // Extract unique guest threads
      const guestThreads = Array.from(threadsMap.values()).filter((t) => t.isGuest);

      return (
        <div dir="rtl" className="space-y-4 pb-24 text-right font-['Cairo']">
          <div className="bg-[#121824] border border-slate-800 rounded-3xl p-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-white">
                {currentUser.id === 1 ? 'صندوق الرسائل الخاصة مع القائد Sami' : 'صندوق رسائل الدعم والمحادثات الخاصة'}
              </h3>
              <p className="text-xs text-slate-400">اختر محادثة مستخدم أو ضيف لعرض الرسائل</p>
            </div>
            <button
              type="button"
              onClick={() => setIsPrivateChatOpen(false)}
              className="px-3.5 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              <span>رجوع للقنوات</span>
            </button>
          </div>

          {/* Guest Support Threads */}
          {guestThreads.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-black text-amber-400 block px-1">
                استفسارات الضيوف النشطة ({guestThreads.length})
              </span>
              {guestThreads.map((gt) => (
                <div
                  key={gt.userId}
                  onClick={() => setOwnerSelectedPmUserId(gt.userId)}
                  className="bg-[#121824] hover:bg-[#162032] border border-amber-500/30 hover:border-amber-400/60 rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center font-black text-base text-amber-300">
                      👤
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-amber-300">{gt.name}</span>
                        <span className="text-[9.5px] px-1.5 py-0.2 rounded-full bg-amber-400/20 text-amber-300 font-bold border border-amber-500/30">
                          زائر #{gt.userId - 9000000}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{gt.lastText}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-amber-400 rotate-180" />
                </div>
              ))}
            </div>
          )}

          {/* Registered Users Threads */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-slate-400 block px-1">
              المشتركون والمشرفون
            </span>
            <div className="space-y-2.5">
              {users
                .filter((u) => u.id !== currentUser.id)
                .map((u) => {
                  const threadInfo = threadsMap.get(u.id);
                  return (
                    <div
                      key={u.id}
                      onClick={() => setOwnerSelectedPmUserId(u.id)}
                      className="bg-[#121824] hover:bg-[#162032] border border-slate-800 rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition"
                    >
                      <div className="flex items-center gap-3">
                        {u.avatarUrl ? (
                          <CloudImage
                            src={u.avatarUrl}
                            alt={u.displayName}
                            className="w-10 h-10 rounded-full object-cover border border-amber-400/50"
                          />
                        ) : (
                          <div
                            className="w-10 h-10 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center font-black text-sm"
                            style={{ color: getUserNameColor(u.id) }}
                          >
                            {u.displayName.charAt(0)}
                          </div>
                        )}
                        <div>
                          <span
                            style={{ color: getUserNameColor(u.id) }}
                            className="text-sm font-black"
                          >
                            {u.displayName} {u.role === 'moderator' ? '🛡️ مشرف' : u.id === 1 ? '👑 المالك' : ''}
                          </span>
                          <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                            {threadInfo?.lastText || 'اضغط لبدء محادثة خاصة دائمة'}
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-amber-400 rotate-180" />
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      );
    }

    const activePartnerId = isSupervisor
      ? ownerSelectedPmUserId
      : (ownerSelectedPmUserId || targetPartnerId || 1);

    const activePartnerUser =
      users.find((u) => u.id === activePartnerId) ||
      (activePartnerId && activePartnerId > 9000000
        ? {
            id: activePartnerId,
            displayName: `ضيف رقم ${activePartnerId - 9000000}`,
            username: `guest_${activePartnerId - 9000000}`,
            role: 'guest' as const,
            avatarUrl: null,
            password: '',
            verifiedChannels: {},
          }
        : users.find((u) => u.id === 1));

    const displayedPrivateMessages = privateMessages.filter((pm) => {
      if (isSupervisor) {
        return pm.participantId === activePartnerId;
      }
      return (
        pm.receiverId === activePartnerId ||
        pm.senderId === activePartnerId ||
        pm.participantId === currentUser.id
      );
    });

    return (
      <div className="flex flex-col h-[calc(100vh-140px)] sm:h-[calc(100vh-170px)] bg-[#0b101a]/95 border border-amber-500/30 rounded-3xl overflow-hidden shadow-2xl relative font-['Cairo'] pb-1">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          className="hidden"
        />
        <input
          type="file"
          ref={cameraInputRef}
          onChange={handleFileChange}
          accept="image/*"
          capture="environment"
          className="hidden"
        />
        <input
          type="file"
          ref={fileAttachmentInputRef}
          onChange={handleAttachmentFileChange}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,application/zip,application/x-zip-compressed"
          className="hidden"
        />

        {/* Private Chat Header */}
        <div
          dir="rtl"
          className="px-4 py-3 bg-[#0e1626] border-b border-slate-800/90 flex items-center justify-between shadow-md shrink-0"
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (isSupervisor && ownerSelectedPmUserId) {
                  setOwnerSelectedPmUserId(null);
                } else {
                  setIsPrivateChatOpen(false);
                }
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              <span>رجوع</span>
            </button>
            <div>
              <h2 className="text-sm font-black text-amber-400">
                {isSupervisor
                  ? activePartnerId && activePartnerId > 9000000
                    ? `👤 محادثة دعم مع ضيف رقم #${activePartnerId - 9000000}`
                    : `محادثة خاصة مع ${activePartnerUser?.displayName || 'مشترك'}`
                  : activePartnerUser?.id === 1
                  ? '👑 محادثة خاصة مع القائد Sami'
                  : `🛡️ محادثة دعم مع المشرف ${activePartnerUser?.displayName || 'المشرف'}`}
              </h2>
              <p className="text-[10px] text-emerald-400">
                محادثة دائمة محفوظة بالكامل • لا تُحذف بعد 48 ساعة
              </p>
            </div>
          </div>
        </div>

        {/* Private Messages List */}
        <div dir="rtl" className="flex-1 overflow-y-auto px-2.5 py-3 sm:px-4 sm:py-3.5 space-y-2.5 scrollbar-thin scrollbar-thumb-slate-800">
          {displayedPrivateMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 p-6 space-y-2">
              <div className="text-3xl animate-bounce">
                {activePartnerUser?.id === 1 ? '👑' : '🛡️'}
              </div>
              <p className="text-sm font-black text-white">
                {activePartnerUser?.id === 1
                  ? 'ابدأ المحادثة الخاصة مع القائد Sami'
                  : `ابدأ محادثة الدعم مع ${activePartnerUser?.displayName || 'المشرف'}`}
              </p>
              <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                اكتب استفسارك في مربع الكتابة بالأسفل واضغط إرسال متى أردت.
              </p>
            </div>
          ) : (
            displayedPrivateMessages.map((pm) => {
              const isMe = pm.senderId === currentUser.id;
              const meta = getSenderMeta(pm.senderId, pm.senderRole, pm.senderAvatarUrl);

              return (
                <MessageBubble
                  key={pm.id}
                  message={pm}
                  isMe={isMe}
                  currentUser={currentUser}
                  senderMeta={meta}
                  highlightedMessageId={highlightedMessageId}
                  onReply={handleStartReply}
                  onEdit={(m) => handleStartEdit(m, true)}
                  onDelete={(m) => handleRequestDelete(m, true)}
                  onCopy={handleCopyMessage}
                  onQuoteClick={handleQuoteClick}
                  onImageClick={(url) => setPreviewModalImage(url)}
                />
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Selected Image Preview */}
        {selectedImage && (
          <div
            dir="rtl"
            className="px-4 py-2 bg-[#121c2e] border-t border-slate-800 flex items-center justify-between shrink-0"
          >
            <div className="flex items-center gap-2">
              <img
                src={selectedImage}
                alt="صورة جاهزة"
                className="w-10 h-10 rounded-lg object-cover border border-amber-500/50"
              />
              <span className="text-xs text-amber-300 font-bold">صورة جاهزة للإرسال</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedImage(null);
                setSelectedFile(null);
              }}
              className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Selected File Attachment Preview */}
        {selectedFileAttachment && (
          <div
            dir="rtl"
            className="px-4 py-2.5 bg-[#121c2e] border-t border-slate-800 flex items-center justify-between shrink-0"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0 text-right">
                <p className="text-xs text-white font-bold truncate max-w-[200px] sm:max-w-xs">
                  {selectedFileAttachment.name}
                </p>
                <p className="text-[10px] text-amber-300">
                  {formatFileSize(selectedFileAttachment.size)} • مستند جاهز للإرسال
                  {uploadProgress !== null && ` (جاري الرفع ${uploadProgress}%)`}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={isSending}
              onClick={() => {
                setSelectedFileAttachment(null);
                setUploadProgress(null);
              }}
              className="p-1 text-slate-400 hover:text-rose-400 transition cursor-pointer"
              title="إلغاء الملف"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {uploadProgress !== null && (
          <div className="w-full bg-slate-800 h-1">
            <div
              className="bg-amber-400 h-1 transition-all duration-150"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        )}

        {/* Reply Bar */}
        {replyTarget && (
          <div
            dir="rtl"
            className="px-3.5 py-2 bg-[#141e30] border-t border-amber-500/30 flex items-center justify-between shrink-0 animate-in slide-in-from-bottom-2 duration-150"
          >
            <div className="flex items-center gap-2.5 overflow-hidden">
              <Reply className="w-4 h-4 text-amber-400 rotate-180 shrink-0" />
              <div className="border-r-2 border-amber-400 pr-2">
                <div className="text-[11px] font-black text-amber-300 truncate">
                  الرد على: {replyTarget.senderName}
                </div>
                <div className="text-[11px] text-slate-400 truncate max-w-xs">
                  {replyTarget.isDeleted
                    ? 'تم حذف الرسالة الأصلية.'
                    : replyTarget.text || '📷 صورة'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCancelReply}
              className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="إلغاء الرد"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Edit Bar */}
        {editingMessage && (
          <div
            dir="rtl"
            className="px-3.5 py-2 bg-[#172417] border-t border-emerald-500/40 flex items-center justify-between shrink-0 animate-in slide-in-from-bottom-2 duration-150"
          >
            <div className="flex items-center gap-2.5 overflow-hidden">
              <Edit3 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="border-r-2 border-emerald-400 pr-2">
                <div className="text-[11px] font-black text-emerald-300">
                  تعديل الرسالة
                </div>
                <div className="text-[11px] text-slate-400 truncate max-w-xs">
                  {editingMessage.text}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCancelEdit}
              className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="إلغاء التعديل"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Enhanced Input Form with Auto-expanding Textarea */}
        <form
          onSubmit={handleSendMessage}
          dir="rtl"
          className="p-2.5 sm:p-3 bg-[#0d1524] border-t border-slate-800/90 flex items-end gap-2 shrink-0"
        >
          {!editingMessage && (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700/60 transition cursor-pointer shrink-0"
                title="إرفاق صورة من المعرض"
              >
                <ImageIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <button
                type="button"
                onClick={handleTriggerCamera}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700/60 transition cursor-pointer shrink-0"
                title="التقاط صورة بالكاميرا"
              >
                <Camera className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <button
                type="button"
                onClick={handleTriggerAttachFile}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700/60 transition cursor-pointer shrink-0"
                title="إرفاق ملف أو مستند (PDF، إكسل، وورد، مضغوط)"
              >
                <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              editingMessage
                ? 'اكتب التعديل الجديد للرسالة...'
                : replyTarget
                ? `اكتب ردك على ${replyTarget.senderName}...`
                : 'اكتب رسالتك الخاصة إلى Sami...'
            }
            className="flex-1 bg-[#131d30] border border-slate-700/80 focus:border-amber-400 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 outline-none transition resize-none min-h-[42px] max-h-[140px] leading-relaxed overflow-y-auto"
          />

          <button
            type="submit"
            disabled={isSending || (!inputText.trim() && !selectedImage && !selectedFileAttachment)}
            className={`p-2.5 sm:px-4 rounded-xl font-black text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer shrink-0 ${
              editingMessage
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20'
                : 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md shadow-amber-500/20'
            } disabled:opacity-40`}
          >
            {isSending ? (
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : editingMessage ? (
              <>
                <span>حفظ</span>
                <Check className="w-4 h-4" />
              </>
            ) : (
              <>
                <span className="hidden sm:inline">إرسال</span>
                <Send className="w-4 h-4 rotate-180" />
              </>
            )}
          </button>
        </form>

        <ImageViewerModal
          imageUrl={previewModalImage}
          title="عرض الصورة"
          onClose={() => setPreviewModalImage(null)}
        />

        {/* Subscription Details & VIP Terms Modal for Private Chat */}
        {viewingSubscriptionPlan && (
          <SubscriptionDetailModal
            key={viewingSubscriptionPlan.id}
            plan={viewingSubscriptionPlan}
            currentUser={currentUser}
            onClose={() => setViewingSubscriptionPlan(null)}
            onStartInquiry={(message) => {
              setInputText(message);
            }}
            onRequestPackageSupport={(plan) => {
              setViewingSubscriptionPlan(null);
              onRequestPackageSupport?.(plan);
            }}
          />
        )}
      </div>
    );
  }

  // ============================================================================
  // VIEW 3: ACTIVE CHANNEL CHAT SCREEN
  // ============================================================================
  const canModerate = currentUser.role === 'owner' || currentUser.role === 'moderator';
  const channelMembers = users.filter((u) => selectedChannel?.memberIds.includes(u.id));

  return (
    <div className="flex flex-col h-[calc(100dvh-90px)] sm:h-[calc(100vh-100px)] bg-[#0b101a]/95 border border-slate-800/80 rounded-3xl overflow-hidden shadow-2xl relative font-['Cairo'] pb-1">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />
      <input
        type="file"
        ref={cameraInputRef}
        onChange={handleFileChange}
        accept="image/*"
        capture="environment"
        className="hidden"
      />
      <input
        type="file"
        ref={fileAttachmentInputRef}
        onChange={handleAttachmentFileChange}
        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,application/zip,application/x-zip-compressed"
        className="hidden"
      />

      {/* Channel Header with Clear Back Button */}
      <div
        dir="rtl"
        className="px-3.5 py-3 bg-[#0e1626] border-b border-slate-800/90 flex items-center justify-between shadow-md shrink-0"
      >
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setSelectedChannel(null)}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1 border border-slate-700 transition cursor-pointer"
            title="العودة إلى قائمة القنوات"
          >
            <ArrowRight className="w-4 h-4" />
            <span>رجوع</span>
          </button>

          {selectedChannel?.imageUrl ? (
            <CloudImage
              src={selectedChannel.imageUrl}
              alt={selectedChannel.name}
              className="w-10 h-10 rounded-2xl object-cover border border-amber-400/50"
            />
          ) : (
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-slate-950 font-black">
              💬
            </div>
          )}

          <div>
            <h2 className="text-sm font-black text-white tracking-wide">
              {selectedChannel?.name}
            </h2>
            <p className="text-[11px] text-slate-400 flex items-center gap-1">
              <Users className="w-3 h-3 text-amber-400" />
              <span>{selectedChannel?.memberIds.length || 0} عضواً • حذف تلقائي بعد 48 ساعة</span>
            </p>
          </div>
        </div>

        {/* Moderator / Owner Supervision Button */}
        {canModerate && (
          <button
            type="button"
            onClick={() => setSupervisionModalOpen(true)}
            className="px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 text-amber-300 text-xs font-black flex items-center gap-1.5 cursor-pointer"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>الأعضاء والإنذارات</span>
          </button>
        )}
      </div>

      {/* Offline Alert Banner */}
      {!isOnline && (
        <div
          dir="rtl"
          className="bg-rose-500/20 border-b border-rose-500/40 px-4 py-2 flex items-center justify-center gap-2 text-rose-300 text-xs font-bold shrink-0"
        >
          <WifiOff className="w-4 h-4 text-rose-400 shrink-0" />
          <span>لا يوجد اتصال بالإنترنت.</span>
        </div>
      )}

      {/* In-App Notification Banner */}
      {alertBanner && (
        <div
          dir="rtl"
          className="bg-rose-500/20 border-b border-rose-500/40 px-4 py-2 flex items-center justify-between gap-2 text-rose-200 text-xs font-bold shrink-0"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{alertBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setAlertBanner(null)}
            className="p-0.5 text-rose-300 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div
        dir="rtl"
        className="flex-1 overflow-y-auto px-2.5 py-3 sm:px-4 sm:py-3.5 space-y-2.5 scrollbar-thin scrollbar-thumb-slate-800"
      >
        {channelMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 p-6 space-y-2">
            <div className="w-12 h-12 rounded-full bg-slate-800/50 flex items-center justify-center text-amber-400 text-xl">
              💬
            </div>
            <p className="text-sm font-bold text-slate-400">لا توجد رسائل في هذه القناة بعد</p>
            <p className="text-xs text-slate-500 max-w-xs">
              كن أول من يبدأ المحادثة في قناة {selectedChannel?.name}!
            </p>
          </div>
        ) : (
          channelMessages.map((msg) => {
            const isMe = msg.senderId === currentUser.id;
            const meta = getSenderMeta(msg.senderId, msg.senderRole, msg.senderAvatarUrl);

            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                isMe={isMe}
                currentUser={currentUser}
                senderMeta={meta}
                highlightedMessageId={highlightedMessageId}
                onReply={handleStartReply}
                onEdit={(m) => handleStartEdit(m, false)}
                onDelete={(m) => handleRequestDelete(m, false)}
                onCopy={handleCopyMessage}
                onQuoteClick={handleQuoteClick}
                onImageClick={(url) => setPreviewModalImage(url)}
              />
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Selected Image Pending Preview Banner */}
      {selectedImage && (
        <div
          dir="rtl"
          className="px-4 py-2 bg-[#121c2e] border-t border-slate-800 flex items-center justify-between shrink-0"
        >
          <div className="flex items-center gap-2">
            <img
              src={selectedImage}
              alt="صورة قيد الإرسال"
              className="w-10 h-10 rounded-lg object-cover border border-amber-500/50"
            />
            <span className="text-xs text-amber-300 font-bold">صورة جاهزة للإرسال</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedImage(null);
              setSelectedFile(null);
            }}
            className="p-1 rounded-full text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Selected File Attachment Pending Preview */}
      {selectedFileAttachment && (
        <div
          dir="rtl"
          className="px-4 py-2.5 bg-[#121c2e] border-t border-slate-800 flex items-center justify-between shrink-0"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0 text-right">
              <p className="text-xs text-white font-bold truncate max-w-[200px] sm:max-w-xs">
                {selectedFileAttachment.name}
              </p>
              <p className="text-[10px] text-amber-300">
                {formatFileSize(selectedFileAttachment.size)} • مستند جاهز للإرسال
                {uploadProgress !== null && ` (جاري الرفع ${uploadProgress}%)`}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSending}
            onClick={() => {
              setSelectedFileAttachment(null);
              setUploadProgress(null);
            }}
            className="p-1 text-slate-400 hover:text-rose-400 transition cursor-pointer"
            title="إلغاء الملف"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {uploadProgress !== null && (
        <div className="w-full bg-slate-800 h-1">
          <div
            className="bg-amber-400 h-1 transition-all duration-150"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      )}

      {/* Reply Bar */}
      {replyTarget && (
        <div
          dir="rtl"
          className="px-3.5 py-2 bg-[#141e30] border-t border-amber-500/30 flex items-center justify-between shrink-0 animate-in slide-in-from-bottom-2 duration-150"
        >
          <div className="flex items-center gap-2.5 overflow-hidden">
            <Reply className="w-4 h-4 text-amber-400 rotate-180 shrink-0" />
            <div className="border-r-2 border-amber-400 pr-2">
              <div className="text-[11px] font-black text-amber-300 truncate">
                الرد على: {replyTarget.senderName}
              </div>
              <div className="text-[11px] text-slate-400 truncate max-w-xs">
                {replyTarget.isDeleted
                  ? 'تم حذف الرسالة الأصلية.'
                  : replyTarget.text || '📷 صورة'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancelReply}
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="إلغاء الرد"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Edit Bar */}
      {editingMessage && (
        <div
          dir="rtl"
          className="px-3.5 py-2 bg-[#172417] border-t border-emerald-500/40 flex items-center justify-between shrink-0 animate-in slide-in-from-bottom-2 duration-150"
        >
          <div className="flex items-center gap-2.5 overflow-hidden">
            <Edit3 className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="border-r-2 border-emerald-400 pr-2">
              <div className="text-[11px] font-black text-emerald-300">
                تعديل الرسالة
              </div>
              <div className="text-[11px] text-slate-400 truncate max-w-xs">
                {editingMessage.text}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancelEdit}
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="إلغاء التعديل"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Enhanced Input Form with Auto-expanding Textarea */}
      <form
        onSubmit={handleSendMessage}
        dir="rtl"
        className="p-2.5 sm:p-3 bg-[#0d1524] border-t border-slate-800/90 flex items-end gap-2 shrink-0"
      >
        {!editingMessage && (
          <>
            <button
              type="button"
              disabled={!isOnline || isSending}
              onClick={() => fileInputRef.current?.click()}
              title="إرسال صورة من المعرض"
              className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-amber-400 border border-slate-700/60 transition disabled:opacity-40 cursor-pointer shrink-0"
            >
              <ImageIcon className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <button
              type="button"
              disabled={!isOnline || isSending}
              onClick={() => cameraInputRef.current?.click()}
              title="التقاط صورة بالكاميرا"
              className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-amber-400 border border-slate-700/60 transition disabled:opacity-40 cursor-pointer shrink-0"
            >
              <Camera className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <button
              type="button"
              disabled={!isOnline || isSending}
              onClick={handleTriggerAttachFile}
              title="إرفاق ملف أو مستند (+)"
              className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-amber-400 border border-slate-700/60 transition disabled:opacity-40 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </>
        )}

        <textarea
          ref={textareaRef}
          rows={1}
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            editingMessage
              ? 'اكتب التعديل الجديد للرسالة...'
              : replyTarget
              ? `اكتب ردك على ${replyTarget.senderName}...`
              : isOnline
              ? 'اكتب رسالتك للقناة...'
              : 'لا يوجد اتصال بالإنترنت'
          }
          disabled={!isOnline || isSending}
          className="flex-1 bg-[#131d30] border border-slate-700/80 focus:border-amber-400 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 outline-none transition disabled:opacity-50 resize-none min-h-[42px] max-h-[140px] leading-relaxed overflow-y-auto"
        />

        <button
          type="submit"
          disabled={!isOnline || (!inputText.trim() && !selectedImage && !selectedFileAttachment) || isSending}
          className={`p-2.5 sm:px-4 rounded-xl font-black text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer shrink-0 ${
            editingMessage
              ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20'
              : 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md shadow-amber-500/20'
          } disabled:opacity-40`}
        >
          {isSending ? (
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : editingMessage ? (
            <>
              <span>حفظ</span>
              <Check className="w-4 h-4" />
            </>
          ) : (
            <>
              <span className="hidden sm:inline">إرسال</span>
              <Send className="w-4 h-4 rotate-180" />
            </>
          )}
        </button>
      </form>

      {/* Moderator & Owner Channel Supervision Modal (Warnings & Kicks) */}
      {supervisionModalOpen && selectedChannel && (
        <div
          dir="rtl"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 overflow-y-auto"
        >
          <div className="bg-[#121824] border border-amber-500/40 rounded-3xl p-5 w-full max-w-md space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-black text-amber-400">
                  إدارة أعضاء القناة والإنذارات ({selectedChannel.name})
                </h3>
                <p className="text-[11px] text-slate-400">
                  إرسال إنذار أو طرد مشترك مع إرسال تقرير تلقائي بالصور إلى القائد Sami
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSupervisionModalOpen(false);
                  setActionTargetUser(null);
                }}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!actionTargetUser ? (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {channelMembers.map((member) => {
                  const isOwnerMember = member.id === 1 || member.role === 'owner';
                  return (
                    <div
                      key={member.id}
                      className="bg-[#0b101a] border border-slate-800 rounded-2xl p-3 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5">
                        {member.avatarUrl ? (
                          <CloudImage
                            src={member.avatarUrl}
                            alt={member.displayName}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div
                            className="w-8 h-8 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center text-xs font-black"
                            style={{ color: getUserNameColor(member.id) }}
                          >
                            {member.displayName.charAt(0)}
                          </div>
                        )}
                        <div>
                          <span
                            style={{ color: getUserNameColor(member.id) }}
                            className="text-xs font-black block"
                          >
                            {member.displayName}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            الإنذارات الحالية: {member.warningsCount || 0} / 3
                          </span>
                        </div>
                      </div>

                      {!isOwnerMember && member.id !== currentUser.id && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setActionTargetUser(member);
                              setActionType('warning');
                              setActionReason('');
                            }}
                            className="px-2.5 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>إنذار</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setActionTargetUser(member);
                              setActionType('kick');
                              setActionReason('');
                            }}
                            className="px-2.5 py-1.5 rounded-xl bg-rose-500/20 text-rose-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <UserX className="w-3.5 h-3.5" />
                            <span>طرد وتقرير</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <form onSubmit={handleExecuteSupervisionAction} className="space-y-3">
                <div className="p-3 rounded-2xl bg-[#0b101a] border border-slate-800">
                  <div className="text-xs font-black text-white">
                    {actionType === 'warning'
                      ? `⚠️ إرسال إنذار رسمي إلى: ${actionTargetUser.displayName}`
                      : `🚫 طرد ${actionTargetUser.displayName} من القناة وإرسال تقرير إلى Sami`}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    عدد الإنذارات الحالي: {actionTargetUser.warningsCount || 0} / 3
                  </div>
                </div>

                <textarea
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="اكتب سبب المخالفة أو الطرد بالتفصيل..."
                  required
                  rows={3}
                  className="w-full bg-[#0b101a] border border-slate-700 rounded-xl p-3 text-xs text-white outline-none focus:border-amber-400"
                />

                <div>
                  <input
                    type="file"
                    ref={evidenceInputRef}
                    onChange={(e) => setActionEvidenceFile(e.target.files?.[0] || null)}
                    accept="image/*"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => evidenceInputRef.current?.click()}
                    className="w-full py-2.5 rounded-xl bg-slate-800 text-amber-400 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ImageIcon className="w-4 h-4" />
                    <span>
                      {actionEvidenceFile
                        ? `تم إرفاق الدليل: ${actionEvidenceFile.name}`
                        : 'إرفاق صورة الصفقة المخالفة / الدليل (اختياري)'}
                    </span>
                  </button>
                </div>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={isExecutingAction}
                    className={`flex-1 py-3 rounded-xl font-black text-xs cursor-pointer ${
                      actionType === 'warning'
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-rose-500 text-white'
                    }`}
                  >
                    {isExecutingAction
                      ? 'جاري التنفيذ...'
                      : actionType === 'warning'
                      ? 'تأكيد إرسال الإنذار'
                      : 'تأكيد الطرد وإرسال التقرير إلى Sami'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActionTargetUser(null)}
                    className="px-4 py-3 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold cursor-pointer"
                  >
                    رجوع
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Delete Message Confirmation Modal */}
      {confirmDeleteModal.isOpen && confirmDeleteModal.msg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div
            dir="rtl"
            className="bg-[#121824] border border-amber-500/30 rounded-3xl p-6 w-full max-w-sm text-right space-y-4 shadow-2xl shadow-black/80"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-400 flex items-center justify-center shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-white">تأكيد حذف الرسالة</h3>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  {confirmDeleteModal.msg.senderId === currentUser.id
                    ? 'هل أنت متأكد من حذف هذه الرسالة؟ سيبقى موضعها في المحادثة مع إشعار "تم حذف هذه الرسالة".'
                    : 'هل أنت متأكد من حذف هذه الرسالة بصفتك القائد؟'}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-[#090d16] border border-slate-800 text-xs text-slate-300 italic line-clamp-2">
              "{confirmDeleteModal.msg.text || (confirmDeleteModal.msg.imageUrl ? '📷 صورة مرفقة' : 'رسالة')}"
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs transition cursor-pointer shadow-md shadow-rose-900/30"
              >
                تأكيد الحذف
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteModal({ isOpen: false, msg: null, isPrivate: false })}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notice Banner */}
      {toastNotice && (
        <div
          dir="rtl"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-emerald-950/95 border border-emerald-400/60 text-emerald-300 text-xs font-black shadow-2xl flex items-center gap-2 animate-in slide-in-from-top duration-200"
        >
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastNotice}</span>
        </div>
      )}

      {/* Full-Screen Image Viewer with Zoom, Pan, Pinch-to-Zoom, and Download */}
      <ImageViewerModal
        imageUrl={previewModalImage}
        title="عرض صورة المحادثة"
        onClose={() => setPreviewModalImage(null)}
      />

      {/* Subscription Details & VIP Terms Modal for Users */}
      {viewingSubscriptionPlan && (
        <SubscriptionDetailModal
          key={viewingSubscriptionPlan.id}
          plan={viewingSubscriptionPlan}
          currentUser={currentUser}
          onClose={() => setViewingSubscriptionPlan(null)}
          onStartInquiry={(message) => {
            setInputText(message);
            setSelectedChannel(null);
            setIsPrivateChatOpen(true);
          }}
          onRequestPackageSupport={(plan) => {
            setViewingSubscriptionPlan(null);
            onRequestPackageSupport?.(plan);
          }}
        />
      )}
    </div>
  );
};
