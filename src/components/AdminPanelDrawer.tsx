import React, { useState } from "react";
import { 
  X, 
  RefreshCw, 
  Check, 
  Trash2, 
  Settings, 
  Activity, 
  Database, 
  FolderLock, 
  ShieldCheck, 
  SlidersHorizontal,
  FileText,
  AlertTriangle,
  Eye,
  EyeOff,
  Heart,
  Grid,
  Video,
  Image as ImageIcon,
  Clock
} from "lucide-react";
import { MediaItem, SyncStats } from "../types";

interface AdminPanelDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  mediaItems: MediaItem[];
  stats: SyncStats;
  settings: {
    approval_workflow_enabled: boolean;
    allow_public_downloads: boolean;
    allow_guest_favorites: boolean;
  };
  onSaveSettings: (updated: any) => Promise<void>;
  onSyncNow: () => Promise<void>;
  syncing: boolean;
  showHiddenMedia: boolean;
  setShowHiddenMedia: (v: boolean) => void;
  showRejectedMedia: boolean;
  setShowRejectedMedia: (v: boolean) => void;
  showPendingMedia: boolean;
  setShowPendingMedia: (v: boolean) => void;
  adminStatusFilter: "All" | "pending" | "approved" | "rejected" | "hidden";
  setAdminStatusFilter: (v: "All" | "pending" | "approved" | "rejected" | "hidden") => void;
  isAdminMode: boolean;
  setIsAdminMode: (v: boolean) => void;
  diagnostics: any;
  loadingDiagnostics: boolean;
  onRefreshDiagnostics: () => Promise<void>;
  favoriteDriveIds?: Set<string>;
  session?: any;
  onSetApprovalStatus: (id: string, status: "approved" | "rejected" | "pending") => Promise<void>;
  onHideItem: (id: string) => Promise<void>;
  onRestoreItem: (id: string) => Promise<void>;
}

export default function AdminPanelDrawer({
  isOpen,
  onClose,
  mediaItems,
  stats,
  settings,
  onSaveSettings,
  onSyncNow,
  syncing,
  showHiddenMedia,
  setShowHiddenMedia,
  showRejectedMedia,
  setShowRejectedMedia,
  showPendingMedia,
  setShowPendingMedia,
  adminStatusFilter,
  setAdminStatusFilter,
  isAdminMode,
  setIsAdminMode,
  diagnostics,
  loadingDiagnostics,
  onRefreshDiagnostics,
  favoriteDriveIds = new Set(),
  session,
  onSetApprovalStatus,
  onHideItem,
  onRestoreItem
}: AdminPanelDrawerProps) {
  if (!isOpen) return null;

  const [queueTab, setQueueTab] = useState<"pending" | "approved" | "rejected" | "hidden">("pending");

  // Derive counts from live state
  const totalMedia = mediaItems.length;
  const totalPhotos = mediaItems.filter(item => item.type === "image" || item.mimeType?.startsWith("image/")).length;
  const totalVideos = mediaItems.filter(item => item.type === "video" || item.mimeType?.startsWith("video/")).length;
  const totalFavorites = favoriteDriveIds.size;
  const totalHidden = mediaItems.filter(item => item.softDeleted).length;
  const totalPending = mediaItems.filter(item => item.approvalStatus === "pending").length;
  const totalRejected = mediaItems.filter(item => item.approvalStatus === "rejected").length;

  // Filter memories uploaded via app (i.e. having uploaded_by_email or app_upload source)
  const uploadedMemories = mediaItems.filter(item => !!item.uploaded_by_email || item.upload_source === "app_upload");
  const queueItems = uploadedMemories.filter(item => {
    if (queueTab === "hidden") return item.softDeleted;
    if (item.softDeleted) return false;
    return item.approvalStatus === queueTab;
  });

  const queuePendingCount = uploadedMemories.filter(item => item.approvalStatus === "pending" && !item.softDeleted).length;
  const queueApprovedCount = uploadedMemories.filter(item => item.approvalStatus === "approved" && !item.softDeleted).length;
  const queueRejectedCount = uploadedMemories.filter(item => item.approvalStatus === "rejected" && !item.softDeleted).length;
  const queueHiddenCount = uploadedMemories.filter(item => item.softDeleted).length;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" id="admin-panel-drawer" aria-labelledby="slide-over-title" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity" 
        onClick={onClose}
      />

      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col h-full animate-slide-in">
          
          {/* Header */}
          <div className="px-6 py-5 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="bg-amber-500 text-slate-950 p-1.5 rounded-lg">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-bold text-base leading-none">Administrative Core</h2>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] text-slate-300 font-semibold uppercase tracking-wider">Avishek's Trip Vault</span>
                </div>
              </div>
            </div>
            
            <button
              onClick={onClose}
              id="admin-drawer-close"
              className="p-1.5 hover:bg-white/10 rounded-full text-slate-350 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-7 bg-slate-50/50 dark:bg-slate-950/20">

            {/* Quick Toggle: Admin Mode */}
            <div className="bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 p-4.5 rounded-2xl flex items-center justify-between shadow-2xs">
              <div className="space-y-0.5">
                <h4 className="font-bold text-xs text-amber-900 dark:text-amber-400">Force Admin View Overlay</h4>
                <p className="text-[10px] text-amber-800/80 dark:text-amber-500/70 leading-relaxed font-medium">Toggle visibility of soft-deleted, pending, and unapproved items across Cox's Bazar gallery.</p>
              </div>
              <button
                onClick={() => setIsAdminMode(!isAdminMode)}
                id="drawer-toggle-admin-view"
                className={`w-11 h-6 flex items-center rounded-full p-0.5 transition-colors duration-300 focus:outline-none cursor-pointer ${
                  isAdminMode ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-700"
                }`}
              >
                <span className={`block w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-300 ${
                  isAdminMode ? "translate-x-5" : "translate-x-0"
                }`} />
              </button>
            </div>

            {/* Section 1: Overview Cards */}
            <div className="space-y-3">
              <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <Grid className="w-3.5 h-3.5" />
                <span>Admin Library Overview</span>
              </h3>
              
              <div className="grid grid-cols-2 gap-3.5">
                <div className="bg-white dark:bg-slate-900 p-3.5 border border-slate-200/50 dark:border-slate-800/60 rounded-xl shadow-3xs space-y-1">
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase">Total Media</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl font-extrabold text-slate-900 dark:text-white">{totalMedia}</span>
                    <span className="text-[9px] text-slate-455 font-mono">({totalPhotos}p / {totalVideos}v)</span>
                  </div>
                </div>
                
                <div className="bg-white dark:bg-slate-900 p-3.5 border border-slate-200/50 dark:border-slate-800/60 rounded-xl shadow-3xs space-y-1">
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase">Total Saved</span>
                  <div className="flex items-center gap-1 text-rose-600">
                    <Heart className="w-3.5 h-3.5 fill-current" />
                    <span className="text-xl font-extrabold text-slate-900 dark:text-white">{totalFavorites}</span>
                    <span className="text-[10px] text-slate-455 ml-1 font-medium">favorites</span>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-3.5 border border-slate-200/50 dark:border-slate-800/60 rounded-xl shadow-3xs space-y-1">
                  <span className="text-[10px] text-amber-600 dark:text-amber-500 font-bold uppercase">Pending Workflow</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-xl font-extrabold text-amber-600 dark:text-amber-500">{totalPending}</span>
                    <span className="text-[10px] text-slate-455 font-medium">waiting</span>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-3.5 border border-slate-200/50 dark:border-slate-800/60 rounded-xl shadow-3xs space-y-1">
                  <span className="text-[10px] text-rose-500 font-bold uppercase">Soft Deleted</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-xl font-extrabold text-rose-500">{totalHidden}</span>
                    <span className="text-[10px] text-slate-455 font-medium">hidden</span>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-3.5 border border-slate-200/50 dark:border-slate-800/60 rounded-xl shadow-3xs space-y-1 col-span-2">
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase">Last Synchronized</span>
                  <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-mono text-xs">
                    <RefreshCw className="w-3.5 h-3.5 text-slate-400 animate-spin-slow" />
                    <span className="font-bold truncate" title={stats.lastSyncedTime}>{stats.lastSyncedTime}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: Gallery Controls */}
            <div className="space-y-4">
              <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Gallery Filtering Controls</span>
              </h3>
              
              <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/60 rounded-2xl p-4.5 space-y-4 shadow-3xs">
                
                {/* Sync Trigger button */}
                <button
                  type="button"
                  onClick={onSyncNow}
                  disabled={syncing}
                  id="drawer-gdrive-sync-btn"
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-650 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing Drive Folder..." : "Load GDrive Sync Now"}
                </button>

                <div className="border-t border-slate-100 dark:border-slate-800/80 pt-3 space-y-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Admin View Filters</p>
                  
                  {/* Toggles */}
                  <label className="flex items-center gap-2.5 text-xs text-slate-650 dark:text-slate-450 font-medium select-none cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showHiddenMedia}
                      onChange={(e) => setShowHiddenMedia(e.target.checked)}
                      id="toggle-show-hidden"
                      className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                    />
                    <span>Include soft-deleted/hidden media in 'All'</span>
                  </label>

                  <label className="flex items-center gap-2.5 text-xs text-slate-650 dark:text-slate-450 font-medium select-none cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showPendingMedia}
                      onChange={(e) => setShowPendingMedia(e.target.checked)}
                      id="toggle-show-pending"
                      className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                    />
                    <span>Include pending media in 'All'</span>
                  </label>

                  <label className="flex items-center gap-2.5 text-xs text-slate-650 dark:text-slate-450 font-medium select-none cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showRejectedMedia}
                      onChange={(e) => setShowRejectedMedia(e.target.checked)}
                      id="toggle-show-rejected"
                      className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                    />
                    <span>Include rejected media in 'All'</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Section 3: Media Workflow Filter */}
            <div className="space-y-3">
              <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                <span>Media Workflow Filter</span>
              </h3>
              
              <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/60 rounded-2xl p-4 shadow-3xs">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-normal mb-2.5">Strict Workflow Routing</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["All", "pending", "approved", "rejected", "hidden"] as const).map((status) => {
                    const count = 
                      status === "All" ? totalMedia :
                      status === "pending" ? totalPending :
                      status === "approved" ? mediaItems.filter(i => i.approvalStatus === "approved" && !i.softDeleted).length :
                      status === "rejected" ? totalRejected : totalHidden;

                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setAdminStatusFilter(status)}
                        id={`filter-routing-${status}`}
                        className={`text-[10px] font-bold py-2 px-1 rounded-xl border text-center transition-all cursor-pointer ${
                          adminStatusFilter === status
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-xs"
                            : "bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        <span className="capitalize block">{status}</span>
                        <span className="text-[9px] opacity-75">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Section 4: Settings Overrides */}
            <div className="space-y-3">
              <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5" />
                <span>Gallery Active Preferences</span>
              </h3>
              
              <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/60 rounded-2xl p-4.5 space-y-4.5 shadow-3xs">
                {/* Rule: Approval Workflow */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <label htmlFor="settings-approval-workflow" className="font-bold text-xs text-slate-850 dark:text-slate-300">Approval Restrictions</label>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-normal">Require admin approval before media is shown to standard guests.</p>
                  </div>
                  <input
                    id="settings-approval-workflow"
                    type="checkbox"
                    checked={settings.approval_workflow_enabled}
                    onChange={(e) => onSaveSettings({ ...settings, approval_workflow_enabled: e.target.checked })}
                    className="w-4.5 h-4.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                  />
                </div>

                {/* Rule: Allow Downloads */}
                <div className="flex items-start justify-between gap-4 border-t border-slate-100 dark:border-slate-800/60 pt-3.5">
                  <div className="space-y-0.5">
                    <label htmlFor="settings-allow-downloads" className="font-bold text-xs text-slate-850 dark:text-slate-300">Allow Downloads</label>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-normal">Permit users to save files. Turning off hides download buttons.</p>
                  </div>
                  <input
                    id="settings-allow-downloads"
                    type="checkbox"
                    checked={settings.allow_public_downloads}
                    onChange={(e) => onSaveSettings({ ...settings, allow_public_downloads: e.target.checked })}
                    className="w-4.5 h-4.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                  />
                </div>

                {/* Rule: Allow Guest Favorites */}
                <div className="flex items-start justify-between gap-4 border-t border-slate-100 dark:border-slate-800/60 pt-3.5">
                  <div className="space-y-0.5">
                    <label htmlFor="settings-allow-guest-favorites" className="font-bold text-xs text-slate-850 dark:text-slate-300">Allow Guest Favorites</label>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-normal">Enables guest viewer favorite lists. Off disables favorites for guests.</p>
                  </div>
                  <input
                    id="settings-allow-guest-favorites"
                    type="checkbox"
                    checked={settings.allow_guest_favorites}
                    onChange={(e) => onSaveSettings({ ...settings, allow_guest_favorites: e.target.checked })}
                    className="w-4.5 h-4.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Section 4.5: Administrative Upload Queue */}
            <div className="space-y-3">
              <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>Administrative Upload Queue</span>
              </h3>

              <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/60 rounded-2xl p-4 shadow-3xs space-y-4">
                {/* Tabs */}
                <div className="flex overflow-x-auto gap-1 p-1 bg-slate-100 dark:bg-slate-800/60 rounded-xl" style={{ scrollbarWidth: "none" }}>
                  {[
                    { key: "pending", label: "Pending", count: queuePendingCount },
                    { key: "approved", label: "Appr.", count: queueApprovedCount },
                    { key: "rejected", label: "Rej.", count: queueRejectedCount },
                    { key: "hidden", label: "Hidden", count: queueHiddenCount }
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setQueueTab(tab.key as any)}
                      className={`text-[9.5px] font-bold py-1.5 rounded-lg text-center transition-all cursor-pointer flex-1 shrink-0 min-w-[72px] ${
                        queueTab === tab.key
                          ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                      }`}
                    >
                      <div className="leading-tight">{tab.label}</div>
                      <div className="text-[8px] opacity-75">({tab.count})</div>
                    </button>
                  ))}
                </div>

                {/* List of elements */}
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {queueItems.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 dark:text-slate-500 text-[10.5px]">
                      No uploads in this category.
                    </div>
                  ) : (
                    queueItems.map((item) => (
                      <div
                        key={item.id}
                        className="p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 flex items-start gap-2.5 transition-colors"
                      >
                        {/* Preview Thumbnail */}
                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0 border border-slate-200/30 relative">
                          <img
                            src={item.thumbnailUrl}
                            className="w-full h-full object-cover"
                            alt=""
                            referrerPolicy="no-referrer"
                          />
                          {item.type === "video" && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <Video className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </div>

                        {/* Metadata Details */}
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <p className="text-[10px] font-bold text-slate-800 dark:text-slate-200 truncate leading-tight">
                            {item.title || item.original_filename || item.name}
                          </p>
                          <p className="text-[9px] text-slate-400 dark:text-slate-500 truncate" title={item.uploaded_by_email}>
                            By: <span className="font-semibold text-slate-600 dark:text-slate-400">{item.uploaded_by_email || "System/Sync"}</span>
                          </p>
                          {item.size && (
                            <p className="text-[8px] text-slate-455 font-mono">
                              {(Number(item.size) / (1024 * 1024)).toFixed(1)} MB
                            </p>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1 self-center">
                          {queueTab === "pending" && (
                            <>
                              <button
                                onClick={() => onSetApprovalStatus(item.id, "approved")}
                                title="Approve Submission"
                                className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded-lg transition-colors cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => onSetApprovalStatus(item.id, "rejected")}
                                title="Reject Submission"
                                className="p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}

                          {queueTab === "approved" && (
                            <>
                              <button
                                onClick={() => onSetApprovalStatus(item.id, "rejected")}
                                title="Reject / De-authorize"
                                className="p-1 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-lg transition-colors cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => onHideItem(item.id)}
                                title="Hide from Gallery"
                                className="p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                              >
                                <EyeOff className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}

                          {queueTab === "rejected" && (
                            <button
                              onClick={() => onSetApprovalStatus(item.id, "approved")}
                              title="Approve / Restore Submission"
                              className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded-lg transition-colors cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {queueTab === "hidden" && (
                            <button
                              onClick={() => onRestoreItem(item.id)}
                              title="Restore to Gallery"
                              className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded-lg transition-colors cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Section 5: Real-time System Diagnostics */}
            <div className="space-y-3 pb-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-teal-500 animate-pulse" />
                  <span>Real-time System Diagnostics</span>
                </h3>
                <button
                  type="button"
                  onClick={onRefreshDiagnostics}
                  disabled={loadingDiagnostics}
                  id="drawer-refresh-diagnostics"
                  className="text-[9px] font-bold text-indigo-650 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${loadingDiagnostics ? "animate-spin" : ""}`} />
                  Refresh Spec
                </button>
              </div>

              <div className="bg-[#0f172a] dark:bg-black text-slate-300 p-4 rounded-2xl space-y-3.5 text-[11px] font-mono shadow-md border border-slate-800">
                {diagnostics ? (
                  <div className="space-y-2">
                    <div className="flex justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-slate-500">Service Mode:</span>
                      <span className="text-teal-400 font-bold">{diagnostics.authMode || "Email/Password"}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-slate-500">Connected User:</span>
                      <span className="text-slate-200 font-bold truncate max-w-[155px]" title={diagnostics.currentUserEmail || "None"}>
                        {diagnostics.currentUserEmail || "None"}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-slate-500">Assigned Role:</span>
                      <span className="text-indigo-400 font-bold">{diagnostics.role || "Admin"}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-slate-500">Drive Connection:</span>
                      <span className={diagnostics.driveSyncStatus?.includes("Live") ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                        {diagnostics.driveSyncStatus || "N/A"}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-slate-500">DB Tables:</span>
                      <span className="text-slate-200 text-right text-[10px] leading-tight">
                        {diagnostics.supabaseTablesStatus || "Not Linked"}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-slate-500">Favorite Source:</span>
                      <span className="text-slate-300 font-semibold">{diagnostics.favoriteSource || "N/A"}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-slate-500">Live Favorite Count:</span>
                      <span className="text-rose-450 font-bold">{favoriteDriveIds.size}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-slate-500">Visible Favs:</span>
                      <span className="text-rose-450 font-bold">
                        {mediaItems.filter(item => favoriteDriveIds.has(item.driveFileId)).length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">User Fav Source:</span>
                      <span className="text-slate-350 font-semibold">
                        {session ? "Supabase (user_favorites)" : "Guest localStorage"}
                      </span>
                    </div>

                    {diagnostics.deploymentWarning && (
                      <div className="mt-3.5 p-2.5 bg-rose-950/40 border border-rose-900/30 text-rose-300 rounded-xl leading-normal text-[10px] flex items-start gap-1.5 font-sans whitespace-pre-wrap">
                        <span className="shrink-0 mt-0.5">⚠️</span>
                        <span>{diagnostics.deploymentWarning}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 py-4">
                    <RefreshCw className="w-4.5 h-4.5 text-slate-500 animate-spin" />
                    <span className="text-slate-455">Initializing system status...</span>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
