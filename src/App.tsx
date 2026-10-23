/**
 * Sami - متتبع رحلة التداول الشخصية ومجتمع القنوات الخاص
 * Personal Trading Journey & Private Community Management Application.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ActiveTab, Challenge, Milestone, Trade } from './types';
import { StorageService } from './services/storage';
import { uploadImageToCloud } from './services/firebase';
import { formatMoney, parseCapitalToCents } from './utils/money';
import { Navbar } from './components/Navbar';
import { DashboardScreen } from './components/DashboardScreen';
import { ModeratorHomeScreen } from './components/ModeratorHomeScreen';
import { OwnerAdminScreen } from './components/OwnerAdminScreen';
import { TradeHistoryScreen } from './components/TradeHistoryScreen';
import { RoadmapScreen } from './components/RoadmapScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { GroupChatScreen } from './components/GroupChatScreen';
import { LoginScreen } from './components/LoginScreen';
import { BackgroundVideo } from './components/BackgroundVideo';
import { AddTradeModal } from './components/AddTradeModal';
import { TradeDetailModal } from './components/TradeDetailModal';
import { MilestoneDetailModal } from './components/MilestoneDetailModal';
import { PdfReportModal } from './components/PdfReportModal';
import { ImageViewerModal } from './components/ImageViewerModal';
import { ConfirmModal } from './components/ConfirmModal';
import { AppUpdateModal } from './components/AppUpdateModal';
import { GuestSupportModal } from './components/GuestSupportModal';
import {
  subscribeToAppUpdateConfig,
  shouldPromptUpdate,
  AppUpdateConfig,
} from './services/appUpdates';
import { Bell, X } from 'lucide-react';
import {
  getSavedUserSession,
  saveUserSession,
  logoutUser,
  CurrentUser,
  UserAccount,
  subscribeToCommunityUsers,
} from './data/auth';
import {
  CommunityNotification,
  subscribeToUserNotifications,
} from './data/chat';

export default function App() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => {
    const saved = getSavedUserSession();
    if (saved) {
      StorageService.setCurrentUser(saved.id, saved.displayName);
    }
    return saved;
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [challenge, setChallenge] = useState<Challenge>(() => StorageService.getChallenge());
  const [trades, setTrades] = useState<Trade[]>(() => StorageService.getTrades());
  const [milestones, setMilestones] = useState<Milestone[]>(() => StorageService.getMilestones());

  // UI Modals
  const [isAddTradeOpen, setIsAddTradeOpen] = useState(false);
  const [isPdfReportOpen, setIsPdfReportOpen] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [selectedMilestone, setSelectedMilestone] = useState<Milestone | null>(null);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [liveCommunityAlert, setLiveCommunityAlert] = useState<CommunityNotification | null>(null);
  const [activeConversation, setActiveConversation] = useState<{
    channelId: string | null;
    isPrivate: boolean;
    partnerId: number | null;
  } | null>(null);
  const [pendingChatTarget, setPendingChatTarget] = useState<{
    type: 'channel' | 'private';
    channelId?: string | null;
    messageId?: string | null;
    partnerId?: number | null;
    targetInitialText?: string | null;
  } | null>(null);

  const [guestSupportModal, setGuestSupportModal] = useState<{
    isOpen: boolean;
    mode: 'general' | 'package';
    sourceContext: 'dashboard' | 'history' | 'roadmap' | 'settings' | 'subscriptions' | 'channels';
    packageInfo?: { id: string; name: string };
  }>({
    isOpen: false,
    mode: 'general',
    sourceContext: 'dashboard',
  });

  const handleOpenGuestSupport = (
    sourceContext: 'dashboard' | 'history' | 'roadmap' | 'settings' | 'subscriptions' | 'channels' = 'dashboard',
    packageInfo?: { id: string; name: string }
  ) => {
    setGuestSupportModal({
      isOpen: true,
      mode: packageInfo ? 'package' : 'general',
      sourceContext,
      packageInfo,
    });
  };

  const handleSelectSupportModerator = (moderator: UserAccount, prefilledMessage: string) => {
    setPendingChatTarget({
      type: 'private',
      partnerId: moderator.id,
      targetInitialText: prefilledMessage,
    });
    setActiveTab('channels');
  };

  const handleOpenNotification = (notif: CommunityNotification) => {
    setPendingChatTarget({
      type: notif.chatType || (notif.type === 'private_message' ? 'private' : 'channel'),
      channelId: notif.channelId,
      messageId: notif.messageId,
      partnerId: notif.partnerId || notif.senderId,
    });
    if (notif.chatType === 'private' || notif.type === 'private_message') {
      setActiveTab('private_chat');
    } else {
      setActiveTab('channels');
    }
    setLiveCommunityAlert(null);
  };

  useEffect(() => {
    const handleBrowserNotifClick = (e: Event) => {
      const notif = (e as CustomEvent<CommunityNotification>).detail;
      if (!notif) return;
      handleOpenNotification(notif);
    };
    window.addEventListener('app_open_chat_message', handleBrowserNotifClick);
    return () => window.removeEventListener('app_open_chat_message', handleBrowserNotifClick);
  }, []);

  // App Update Modal State
  const [appUpdateConfig, setAppUpdateConfig] = useState<AppUpdateConfig | null>(null);
  const [userDismissedUpdate, setUserDismissedUpdate] = useState(false);

  useEffect(() => {
    const unsub = subscribeToAppUpdateConfig((cfg) => {
      setAppUpdateConfig(cfg);
    });
    return () => unsub();
  }, []);

  const isUpdateAvailable = shouldPromptUpdate(appUpdateConfig);
  const showUpdateModal = isUpdateAvailable && (!userDismissedUpdate || Boolean(appUpdateConfig?.isMandatory));


  // Confirmation Modals State
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    type: 'start' | 'reset' | 'new_challenge';
    title: string;
    message: string;
    highlightText?: string;
    isDestructive?: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    type: 'start',
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Prompt dialog for new challenge capital input
  const [newCapitalModal, setNewCapitalModal] = useState<{
    isOpen: boolean;
    capitalStr: string;
    error: string | null;
  }>({
    isOpen: false,
    capitalStr: '500',
    error: null,
  });

  // Reload state for the currently authenticated user
  const refreshData = useCallback(() => {
    const loadedChallenge = StorageService.getChallenge();
    const loadedTrades = StorageService.getTrades();
    const loadedMilestones = StorageService.getMilestones(loadedChallenge.id);

    setChallenge(loadedChallenge);
    setTrades(loadedTrades);
    setMilestones(loadedMilestones);
  }, []);

  // Sync currentUser role, avatar, verifiedChannels, and account existence in real time
  useEffect(() => {
    if (!currentUser) return;
    const unsubUsers = subscribeToCommunityUsers((allUsers) => {
      if (currentUser.isGuest || currentUser.role === 'guest' || currentUser.id > 9000000) return;
      const matched = allUsers.find((u) => u.id === currentUser.id);
      if (!matched && currentUser.id !== 1) {
        // Account was deleted by Owner Sami
        logoutUser();
        StorageService.setCurrentUser(null);
        setCurrentUser(null);
        return;
      }
      if (matched) {
        const nextRole = matched.id === 1 ? 'owner' : matched.role;
        if (
          matched.role !== currentUser.role ||
          matched.avatarUrl !== currentUser.avatarUrl ||
          matched.displayName !== currentUser.displayName ||
          JSON.stringify(matched.verifiedChannels || {}) !==
            JSON.stringify(currentUser.verifiedChannels || {})
        ) {
          const updatedUser: CurrentUser = {
            ...currentUser,
            displayName: matched.displayName,
            role: nextRole,
            avatarUrl: matched.avatarUrl || null,
            verifiedChannels: matched.verifiedChannels || {},
            warningsCount: matched.warningsCount || 0,
          };
          saveUserSession(updatedUser);
          setCurrentUser(updatedUser);
        }
      }
    });

    return () => unsubUsers();
  }, [currentUser]);

  // Subscribe to real-time targeted community notifications (messages from Sami/Moderators, private messages, warnings)
  useEffect(() => {
    if (!currentUser) return;

    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => {});
      }
    }

    const unsubNotifs = subscribeToUserNotifications(currentUser.id, (notif) => {
      // Check if user is currently viewing this exact conversation
      const isPriv = notif.type === 'private_message' || notif.chatType === 'private';
      const notifTargetUser = notif.privateChatWithUserId || notif.partnerId || notif.senderId;

      if ((activeTab === 'channels' || activeTab === 'private_chat') && activeConversation) {
        if (isPriv && activeConversation.isPrivate) {
          if (
            activeConversation.partnerId === notifTargetUser ||
            (activeConversation.partnerId === 1 && notifTargetUser === 1)
          ) {
            // Already inside the active private chat, suppress notification
            return;
          }
        } else if (!isPriv && !activeConversation.isPrivate && notif.channelId) {
          if (activeConversation.channelId === notif.channelId) {
            // Already inside the active channel, suppress notification
            return;
          }
        }
      }

      setLiveCommunityAlert(notif);
      setTimeout(() => {
        setLiveCommunityAlert((prev) => (prev?.id === notif.id ? null : prev));
      }, 6500);
    });

    return () => unsubNotifs();
  }, [currentUser, activeTab, activeConversation]);

  // When currentUser changes, switch isolated storage context, load from cloud, and subscribe to real-time sync
  useEffect(() => {
    if (!currentUser) return;
    StorageService.setCurrentUser(currentUser.id, currentUser.displayName);
    refreshData();

    void StorageService.loadUserFromCloud(currentUser.id, currentUser.displayName).then(() => {
      refreshData();
    });

    const unsubscribe = StorageService.subscribeToUserCloudData(
      currentUser.id,
      currentUser.displayName,
      refreshData
    );

    return () => {
      unsubscribe();
    };
  }, [currentUser?.id, currentUser?.displayName, refreshData]);

  // Show temporary feedback banner
  const triggerNotification = (msg: string) => {
    setNotificationMessage(msg);
    setTimeout(() => {
      setNotificationMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  const handleUpdateCurrentUser = (updates: Partial<CurrentUser>) => {
    setCurrentUser((prev) => {
      if (!prev) return null;
      const next = { ...prev, ...updates };
      saveUserSession(next);
      return next;
    });
  };

  // Handle Trade Submission
  const handleTradeSubmit = async (
    resultCents: number,
    attachmentDataUrl: string | null
  ) => {
    let cloudAttachmentUrl: string | null = null;
    if (attachmentDataUrl && currentUser) {
      const uploaded = await uploadImageToCloud(
        attachmentDataUrl,
        'trade_images',
        currentUser.id
      );
      cloudAttachmentUrl = uploaded.imageUrl;
    }

    const result = StorageService.recordTrade(resultCents, cloudAttachmentUrl);
    refreshData();
    triggerNotification(`تم تسجيل الصفقة #${result.trade.tradeNumber} بنجاح`);
  };

  // Handle Settings Save
  const handleSaveSettings = (
    userName: string,
    initialCapitalCents: number,
    targetBalanceCents: number
  ) => {
    StorageService.updateSettings(userName, initialCapitalCents, targetBalanceCents);
    refreshData();
  };

  // Handle Start Challenge
  const handleStartChallengeClick = () => {
    setConfirmDialog({
      isOpen: true,
      type: 'start',
      title: 'تأكيد بدء الرحلة',
      message: 'هل أنت متأكد من بدء الرحلة الآن؟',
      highlightText: `سيتم بدء الرحلة برأس مال ${formatMoney(challenge.initialCapitalCents)}`,
      isDestructive: false,
      onConfirm: () => {
        StorageService.startChallenge();
        refreshData();
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        triggerNotification(`تم بدء الرحلة برأس مال ${formatMoney(challenge.initialCapitalCents)}`);
      },
    });
  };

  // Handle Reset Challenge
  const handleResetChallengeClick = () => {
    setConfirmDialog({
      isOpen: true,
      type: 'reset',
      title: 'إعادة الرحلة؟',
      message:
        'سيؤدي هذا الإجراء إلى حذف سجل الصفقات الحالي وإعادة جميع المحطات إلى حالتها الأولية.\nهل أنت متأكد؟',
      isDestructive: true,
      onConfirm: () => {
        StorageService.resetChallenge();
        refreshData();
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        triggerNotification('تم إعادة ضبط الرحلة بنجاح');
      },
    });
  };

  // Handle Start New Challenge Click
  const handleNewChallengeClick = () => {
    setNewCapitalModal({
      isOpen: true,
      capitalStr: (challenge.initialCapitalCents / 100).toString(),
      error: null,
    });
  };

  const handleConfirmNewCapital = () => {
    const parsed = parseCapitalToCents(newCapitalModal.capitalStr);
    if (!parsed.valid || parsed.cents === undefined) {
      setNewCapitalModal((prev) => ({
        ...prev,
        error: parsed.error || 'يرجى إدخال رأس مال صحيح أكبر من صفر.',
      }));
      return;
    }

    const newCapitalCents = parsed.cents;
    setNewCapitalModal((prev) => ({ ...prev, isOpen: false }));

    setConfirmDialog({
      isOpen: true,
      type: 'new_challenge',
      title: 'بدء رحلة جديدة؟',
      message: `سيتم بدء رحلة جديدة كلياً برأس مال ${formatMoney(
        newCapitalCents
      )}.\nسيتم حذف سجل الصفقات الحالي وإعادة تعيين الـ 150 محطة.\nهل أنت متأكد من المتابعة؟`,
      highlightText: formatMoney(newCapitalCents),
      isDestructive: true,
      onConfirm: () => {
        StorageService.startNewChallenge(newCapitalCents);
        refreshData();
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        triggerNotification(
          `تم بدء الرحلة الجديدة بنجاح برأس مال ${formatMoney(newCapitalCents)}`
        );
      },
    });
  };

  const handleLoginSuccess = (user: CurrentUser) => {
    StorageService.setCurrentUser(user.id, user.displayName);
    setCurrentUser(user);
    if (pendingChatTarget) {
      if (pendingChatTarget.type === 'private') {
        setActiveTab('private_chat');
      } else {
        setActiveTab('channels');
      }
    } else {
      setActiveTab('dashboard');
    }
    refreshData();
  };

  const handleLogout = () => {
    logoutUser();
    StorageService.setCurrentUser(null);
    setSelectedTrade(null);
    setSelectedMilestone(null);
    setViewingImageUrl(null);
    setIsAddTradeOpen(false);
    setIsPdfReportOpen(false);
    setPendingChatTarget(null);
    setActiveConversation(null);
    setLiveCommunityAlert(null);
    setCurrentUser(null);
    setActiveTab('dashboard');
  };

  // If user is not authenticated, show mandatory Login Screen
  if (!currentUser) {
    return (
      <>
        <LoginScreen onLoginSuccess={handleLoginSuccess} />
        {appUpdateConfig && (
          <AppUpdateModal
            isOpen={showUpdateModal}
            config={appUpdateConfig}
            onDismiss={() => setUserDismissedUpdate(true)}
          />
        )}
      </>
    );
  }

  const isDashboard = activeTab === 'dashboard';

  return (
    <div className="min-h-screen w-full bg-[#070a10] text-slate-100 flex flex-col selection:bg-amber-400 selection:text-black font-['Cairo']">
      {/* Background Image ONLY on Dashboard Screen (and Login Screen above) */}
      {isDashboard && <BackgroundVideo overlayOpacity="bg-black/65" />}

      {/* Real-time Community Notification Banner */}
      {liveCommunityAlert && (
        <div
          dir="rtl"
          className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md bg-gradient-to-r from-[#1a2234] to-[#121824] border border-amber-400/60 rounded-2xl p-3.5 shadow-2xl flex items-start justify-between gap-3 animate-in slide-in-from-top duration-200"
        >
          <div
            onClick={() => handleOpenNotification(liveCommunityAlert)}
            className="flex items-start gap-2.5 cursor-pointer flex-1"
          >
            <div className="w-9 h-9 rounded-xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-amber-400 shrink-0">
              <Bell className="w-4 h-4" />
            </div>
            <div className="text-right">
              <h4 className="text-xs font-black text-amber-300">{liveCommunityAlert.title}</h4>
              <p className="text-[11px] text-slate-200 mt-0.5 line-clamp-2">
                {liveCommunityAlert.body}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLiveCommunityAlert(null)}
            className="p-1 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Container - Native Application Screen */}
      <main
        className={`w-full max-w-2xl mx-auto flex-1 relative z-10 flex flex-col transition-all duration-300 ${
          isDashboard ? 'bg-transparent' : 'bg-[#0b0f17]'
        }`}
      >
        {/* Inner Scrollable Screen Content */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-4 pt-2">
          {activeTab === 'dashboard' &&
            (currentUser.role === 'moderator' ? (
              <ModeratorHomeScreen
                currentUser={currentUser}
                onOpenChannels={() => setActiveTab('channels')}
                onOpenPrivateChat={() => setActiveTab('private_chat')}
                onLogout={handleLogout}
                onAvatarUpdated={(url) => handleUpdateCurrentUser({ avatarUrl: url })}
              />
            ) : (
              <DashboardScreen
                challenge={challenge}
                currentUser={currentUser}
                trades={trades}
                notificationMessage={notificationMessage}
                onOpenSettings={() => setActiveTab('settings')}
                onOpenAdminPanel={() => setActiveTab('admin')}
                onOpenPrivateChat={() => setActiveTab('private_chat')}
                onOpenAddTrade={() => setIsAddTradeOpen(true)}
                onStartChallengeClick={handleStartChallengeClick}
                onNewChallengeClick={handleNewChallengeClick}
                onAvatarUpdated={(url) => handleUpdateCurrentUser({ avatarUrl: url })}
                onContactSupport={() => handleOpenGuestSupport('dashboard')}
                onBrowsePackages={() => setActiveTab('channels')}
                onGoToLogin={handleLogout}
              />
            ))}

          {activeTab === 'admin' && <OwnerAdminScreen currentUser={currentUser} />}

          {activeTab === 'channels' && (
            <GroupChatScreen
              currentUser={currentUser}
              initialMode="channels"
              targetChannelId={pendingChatTarget?.channelId}
              targetMessageId={pendingChatTarget?.messageId}
              targetPartnerId={pendingChatTarget?.partnerId}
              targetInitialText={pendingChatTarget?.targetInitialText}
              onTargetConsumed={() => setPendingChatTarget(null)}
              onUserUpdated={handleUpdateCurrentUser}
              onActiveConversationChanged={setActiveConversation}
              onRequestPackageSupport={(plan) =>
                handleOpenGuestSupport('subscriptions', { id: plan.id, name: plan.name })
              }
              onOpenGuestSupport={() => handleOpenGuestSupport('channels')}
            />
          )}

          {activeTab === 'private_chat' && (
            <GroupChatScreen
              currentUser={currentUser}
              initialMode="private_chat"
              targetChannelId={pendingChatTarget?.channelId}
              targetMessageId={pendingChatTarget?.messageId}
              targetPartnerId={pendingChatTarget?.partnerId}
              targetInitialText={pendingChatTarget?.targetInitialText}
              onTargetConsumed={() => setPendingChatTarget(null)}
              onUserUpdated={handleUpdateCurrentUser}
              onActiveConversationChanged={setActiveConversation}
              onRequestPackageSupport={(plan) =>
                handleOpenGuestSupport('subscriptions', { id: plan.id, name: plan.name })
              }
              onOpenGuestSupport={() => handleOpenGuestSupport('channels')}
            />
          )}

          {activeTab === 'history' && (
            <TradeHistoryScreen
              trades={trades}
              currentUser={currentUser}
              onOpenPdfReport={() => setIsPdfReportOpen(true)}
              onSelectTrade={(t) => setSelectedTrade(t)}
              onOpenAddTrade={() => setIsAddTradeOpen(true)}
              onContactSupport={() => handleOpenGuestSupport('history')}
              onBrowsePackages={() => setActiveTab('channels')}
              onGoToLogin={handleLogout}
            />
          )}

          {activeTab === 'roadmap' && (
            <RoadmapScreen
              milestones={milestones}
              currentUser={currentUser}
              trades={trades}
              onSelectMilestone={(m) => setSelectedMilestone(m)}
              onContactSupport={() => handleOpenGuestSupport('roadmap')}
              onBrowsePackages={() => setActiveTab('channels')}
              onGoToLogin={handleLogout}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsScreen
              challenge={challenge}
              currentUser={currentUser}
              onLogout={handleLogout}
              onSaveSettings={handleSaveSettings}
              onResetChallengeClick={handleResetChallengeClick}
              onNewChallengeClick={handleNewChallengeClick}
              onAvatarUpdated={(url) => handleUpdateCurrentUser({ avatarUrl: url })}
              onContactSupport={() => handleOpenGuestSupport('settings')}
              onBrowsePackages={() => setActiveTab('channels')}
            />
          )}
        </div>

        {/* Bottom Navigation */}
        <Navbar
          activeTab={activeTab}
          userRole={currentUser.role}
          onTabChange={(tab) => setActiveTab(tab)}
        />
      </main>

      {/* Add Trade Modal */}
      <AddTradeModal
        isOpen={isAddTradeOpen}
        currentBalanceCents={challenge.currentBalanceCents}
        tradeCount={challenge.tradeCount}
        onClose={() => setIsAddTradeOpen(false)}
        onSubmit={handleTradeSubmit}
      />

      {/* Trade Detail Modal */}
      <TradeDetailModal
        trade={selectedTrade}
        onClose={() => setSelectedTrade(null)}
        onViewImage={(url) => setViewingImageUrl(url)}
      />

      {/* Milestone Detail Modal */}
      <MilestoneDetailModal
        milestone={selectedMilestone}
        onClose={() => setSelectedMilestone(null)}
        onViewImage={(url) => setViewingImageUrl(url)}
      />

      {/* PDF Printable Report Modal */}
      <PdfReportModal
        isOpen={isPdfReportOpen}
        challenge={challenge}
        trades={trades}
        onClose={() => setIsPdfReportOpen(false)}
      />

      {/* Fullscreen Image Lightbox */}
      <ImageViewerModal
        imageUrl={viewingImageUrl}
        onClose={() => setViewingImageUrl(null)}
      />

      {/* Confirmation Dialog */}
      <ConfirmModal
        isOpen={confirmDialog.isOpen}
        type={confirmDialog.type}
        title={confirmDialog.title}
        message={confirmDialog.message}
        highlightText={confirmDialog.highlightText}
        isDestructive={confirmDialog.isDestructive}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* New Challenge Capital Input Modal */}
      {newCapitalModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-[#121824] border border-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl text-right">
            <h3 className="text-base font-bold text-slate-100 mb-2">
              بدء رحلة جديدة - تحديد رأس المال
            </h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              أدخل رأس المال الابتدائي الذي تريد أن تبدأ به الرحلة الجديدة:
            </p>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                رأس المال الابتدائي ($)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={newCapitalModal.capitalStr}
                onChange={(e) =>
                  setNewCapitalModal((prev) => ({
                    ...prev,
                    capitalStr: e.target.value,
                    error: null,
                  }))
                }
                placeholder="500"
                className="w-full bg-[#141b2a] border border-slate-700/80 rounded-xl px-4 py-3 text-slate-100 text-sm font-['JetBrains_Mono',monospace] focus:outline-none focus:border-amber-400"
                dir="ltr"
              />

              {/* Quick chips */}
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {[50, 100, 250, 500, 1000, 5000].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() =>
                      setNewCapitalModal((prev) => ({
                        ...prev,
                        capitalStr: val.toString(),
                        error: null,
                      }))
                    }
                    className="py-1 px-2.5 rounded-lg text-xs font-['JetBrains_Mono',monospace] font-bold bg-slate-900 border border-slate-800 hover:border-amber-400 text-slate-300 hover:text-amber-400 transition-colors"
                  >
                    ${val}
                  </button>
                ))}
              </div>
            </div>

            {newCapitalModal.error && (
              <p className="text-xs text-rose-400 mb-4">{newCapitalModal.error}</p>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleConfirmNewCapital}
                className="flex-1 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 font-bold text-slate-950 text-xs transition-colors shadow-md"
              >
                متابعة
              </button>
              <button
                onClick={() => setNewCapitalModal((prev) => ({ ...prev, isOpen: false }))}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-slate-300 text-xs transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Guest Support Contact Modal */}
      {guestSupportModal.isOpen && currentUser && (
        <GuestSupportModal
          isOpen={guestSupportModal.isOpen}
          mode={guestSupportModal.mode}
          sourceContext={guestSupportModal.sourceContext}
          packageInfo={guestSupportModal.packageInfo}
          currentUser={currentUser}
          onClose={() => setGuestSupportModal((prev) => ({ ...prev, isOpen: false }))}
          onSelectModerator={handleSelectSupportModerator}
        />
      )}

      {/* App Update Popup Modal */}
      {appUpdateConfig && (
        <AppUpdateModal
          isOpen={showUpdateModal}
          config={appUpdateConfig}
          onDismiss={() => setUserDismissedUpdate(true)}
        />
      )}
    </div>
  );
}
