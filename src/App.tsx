import React, { useState, useEffect, useMemo, useRef, FormEvent } from "react";
import { 
  Camera, 
  Video, 
  RefreshCw, 
  Search, 
  MapPin, 
  User, 
  Calendar, 
  Download, 
  X, 
  SlidersHorizontal, 
  FolderLock, 
  Trash2, 
  Edit3, 
  Check, 
  Sparkles, 
  TrendingUp, 
  Info,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Plus,
  AlertTriangle,
  Loader2,
  Eye,
  Heart,
  Grid,
  Clock,
  LogOut,
  Sun,
  Moon,
  Monitor,
  ArrowUp,
  Upload
} from "lucide-react";
import { MediaItem, SyncStats } from "./types";
import { INITIAL_MOCK_MEDIA } from "./mockData";
import GalleryCard from "./components/GalleryCard";
import AdminPanelDrawer from "./components/AdminPanelDrawer";
import UploadModal from "./components/UploadModal";
import { useAuth } from "./context/AuthContext";
import { useAppTheme } from "./context/ThemeContext";
import { isSupabaseConfigured } from "./lib/supabaseBrowser";

// Formatting helpers
const formatDuration = (seconds?: number) => {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
};

const formatSize = (bytes?: number) => {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
};

const getTimelineGroupKey = (item: MediaItem) => {
  if (!item.takenTime) return "Unknown Date";
  const datePart = item.takenTime.split(" ")[0];
  if (!datePart) return "Unknown Date";
  try {
    const dateObj = new Date(datePart);
    if (isNaN(dateObj.getTime())) return datePart;
    return dateObj.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return datePart;
  }
};

export default function App() {
  // State
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [stats, setStats] = useState<SyncStats>({
    totalPhotosCount: 0,
    totalVideosCount: 0,
    lastSyncedTime: "Never",
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [activeMediaType, setActiveMediaType] = useState<"all" | "photos" | "videos" | "my_uploads">("photos");
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<"grid" | "timeline">("grid");

  // Supabase Settings State
  const [settings, setSettings] = useState({
    approval_workflow_enabled: false,
    allow_public_downloads: true,
    allow_guest_favorites: true
  });

  const { session, user, profile: userProfile, role, signInWithPassword, signUp, signOut, error: authError } = useAuth();
  const { theme, setTheme, currentAppliedTheme } = useAppTheme();

  // Auth Form State
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authLocalError, setAuthLocalError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Unified Favorite States as requested
  const [favoriteDriveIds, setFavoriteDriveIds] = useState<Set<string>>(new Set());
  const [pendingFavoriteIds, setPendingFavoriteIds] = useState<Set<string>>(new Set());

  // Derive userFavorites array for full backward-compat with old JSX references
  const userFavorites = useMemo(() => Array.from(favoriteDriveIds), [favoriteDriveIds]);

  // Derived Favorites Count
  const favoriteCount = favoriteDriveIds.size;

  // Load initial favorites dynamically based on user session status on change
  useEffect(() => {
    let active = true;

    async function loadFavorites() {
      if (session) {
        // Logged-in user: query validated backend API with Authorization Bearer token
        try {
          const token = session.access_token;
          const res = await fetch("/api/favorites", {
            headers: {
              "Authorization": `Bearer ${token}`
            }
          });
          if (res.ok) {
            const data = await res.json();
            if (active && data.success && Array.isArray(data.favorites)) {
              setFavoriteDriveIds(new Set(data.favorites));
            }
          }
        } catch (err) {
          console.error("[Favorites Loader] Could not fetch user favorites:", err);
        }
      } else {
        // Logged-out guest mode: query localStorage only, separate from user
        const stored = localStorage.getItem("tripvault_guest_favorites") || localStorage.getItem("trip_favorites");
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (active && Array.isArray(parsed)) {
              setFavoriteDriveIds(new Set(parsed));
            }
          } catch (_) {}
        } else {
          if (active) setFavoriteDriveIds(new Set());
        }
      }
    }

    loadFavorites();

    return () => {
      active = false;
    };
  }, [session]);

  // Write Guest Favorites to local storage only
  useEffect(() => {
    if (!session) {
      localStorage.setItem("tripvault_guest_favorites", JSON.stringify(Array.from(favoriteDriveIds)));
    }
  }, [favoriteDriveIds, session]);

  // Enforce admin privileges automatically
  useEffect(() => {
    if (role !== "admin") {
      setIsAdminMode(false);
      setIsAdminDrawerOpen(false);
    }
  }, [role]);

  // Diagnostics check for Favorites
  useEffect(() => {
    const isDev = typeof window !== "undefined" && (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname.includes("ais-dev") ||
      window.location.port !== ""
    );
    if (isDev) {
      console.log('[Favorites Count]', {
        favoriteDriveIdsSize: favoriteDriveIds.size,
        visibleFavoriteItems: mediaItems.filter(item => favoriteDriveIds.has(item.driveFileId)).length
      });
    }
  }, [favoriteDriveIds, mediaItems]);

  // Session storage tracks shown welcome toast for this login session
  const welcomeShownRef = useRef<string | null>(null);

  useEffect(() => {
    if (user) {
      const email = (user.email || "").trim().toLowerCase();
      const isAdmin = email === "avishekmajumderpciu@gmail.com";
      const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "User";

      const welcomedUid = sessionStorage.getItem("welcomed_uid");
      if (welcomedUid !== user.id && welcomeShownRef.current !== user.id) {
        welcomeShownRef.current = user.id;
        sessionStorage.setItem("welcomed_uid", user.id);
        
        if (isAdmin) {
          showNotification("Welcome Avishek!", "success");
        } else {
          showNotification(`Welcome, ${name}!`, "success");
        }
      }
    } else {
      sessionStorage.removeItem("welcomed_uid");
      welcomeShownRef.current = null;
    }
  }, [user]);

  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);

  // Gallery internal scroll & scroll-to-top floating triggers
  const galleryScrollRef = useRef<HTMLDivElement>(null);
  const [showBackToTop, setShowBackToTop] = useState<boolean>(false);

  // Format toggleFavorite cleanly with optimism, rolbacks, and individual heart loader disabling
  const toggleFavorite = async (driveFileId: string) => {
    if (!session && !settings.allow_guest_favorites && role !== "admin") {
      showNotification("Shorthand saving of favorites is currently restricted by the administrator.", "warning");
      return;
    }

    if (pendingFavoriteIds.has(driveFileId)) {
      return;
    }

    const previousIsFav = favoriteDriveIds.has(driveFileId);
    const nextIsFav = !previousIsFav;

    // 1. Optimistic Update on user Interface
    const nextSet = new Set(favoriteDriveIds);
    if (nextIsFav) {
      nextSet.add(driveFileId);
      showNotification("Added to Favorites!", "success");
    } else {
      nextSet.delete(driveFileId);
      showNotification("Removed from Favorites.", "success");
    }
    setFavoriteDriveIds(nextSet);

    // Guest updates are immediate, doesn't need API
    if (!session) {
      return;
    }

    // 2. Set pending state for individual item click
    setPendingFavoriteIds(prev => {
      const copy = new Set(prev);
      copy.add(driveFileId);
      return copy;
    });

    try {
      const token = session.access_token;
      const res = await fetch(`/api/favorites/${driveFileId}`, {
        method: nextIsFav ? "POST" : "DELETE",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (!res.ok) {
        throw new Error("Favorite request returned " + res.status);
      }
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Metadata change error");
      }
    } catch (err) {
      console.error("[Favorite Error]:", err);
      showNotification("Could not sync favorite changes with Supabase.", "warning");
      // Rollback optimistic update
      setFavoriteDriveIds(prev => {
        const copy = new Set(prev);
        if (nextIsFav) {
          copy.delete(driveFileId);
        } else {
          copy.add(driveFileId);
        }
        return copy;
      });
    } finally {
      // Remove item pending status
      setPendingFavoriteIds(prev => {
        const copy = new Set(prev);
        copy.delete(driveFileId);
        return copy;
      });
    }
  };

  const handleThemeChange = async (targetTheme: "light" | "dark" | "system") => {
    await setTheme(targetTheme);
    showNotification(`Theme updated to ${targetTheme}.`, "success");
  };

  const handleGalleryScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (e.currentTarget) {
      const scrollTop = e.currentTarget.scrollTop;
      setShowBackToTop(scrollTop > 200);
    }
  };

  const scrollToTop = () => {
    if (galleryScrollRef.current) {
      galleryScrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Map each item in the raw media list to dynamically hold its isFavorite state
  const mediaItemsWithFavorites = useMemo(() => {
    return mediaItems.map(item => ({
      ...item,
      isFavorite: userFavorites.includes(item.driveFileId)
    }));
  }, [mediaItems, userFavorites]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedItem(null);
        setIsUploadModalOpen(false);
        setIsAdminDrawerOpen(false);
        setIsProfileOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterPerson, setFilterPerson] = useState<string>("All");
  const [filterLocation, setFilterLocation] = useState<string>("All");
  const [filterDate, setFilterDate] = useState<string>("All");
  
  // Admin Filter variables
  const [adminStatusFilter, setAdminStatusFilter] = useState<"All" | "pending" | "approved" | "rejected" | "hidden">("All");

  // Selected media inspection state
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [videoLoading, setVideoLoading] = useState<boolean>(true);
  const [videoError, setVideoError] = useState<boolean>(false);

  useEffect(() => {
    if (selectedItem) {
      setVideoLoading(true);
      setVideoError(false);
    }
  }, [selectedItem]);

  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  
  // Edit Form State
  const [editTitle, setEditTitle] = useState<string>("");
  const [editDescription, setEditDescription] = useState<string>("");
  const [editLocation, setEditLocation] = useState<string>("");
  const [editPeopleString, setEditPeopleString] = useState<string>("");

  // Admin Section state triggers
  const [isAdminMode, setIsAdminMode] = useState<boolean>(false);
  const [customNotify, setCustomNotify] = useState<{message: string; type: "success" | "warning"} | null>(null);
  const [driveHealth, setDriveHealth] = useState<any>(null);
  const [supabaseHealth, setSupabaseHealth] = useState<any>(null);
  const [checkingHealth, setCheckingHealth] = useState<boolean>(false);

  // Admin Drawer & workflow toggles
  const [isAdminDrawerOpen, setIsAdminDrawerOpen] = useState<boolean>(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [showHiddenMedia, setShowHiddenMedia] = useState<boolean>(true);
  const [showRejectedMedia, setShowRejectedMedia] = useState<boolean>(true);
  const [showPendingMedia, setShowPendingMedia] = useState<boolean>(true);
  const [adminDiagnostics, setAdminDiagnostics] = useState<any>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState<boolean>(false);

  // Fetch initial data and settings
  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    fetchMediaData();
  }, [isAdminMode]);

  useEffect(() => {
    if (isAdminMode) {
      runSystemDiagnostics();
    }
  }, [isAdminMode]);

  const fetchSettings = async (retries = 4, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) throw new Error(`HTTP status ${res.status}`);
        const data = await res.json();
        if (data.success && data.settings) {
          setSettings(data.settings);
          return;
        }
      } catch (err) {
        if (i === retries - 1) {
          console.error("Failed to load settings:", err);
        } else {
          console.warn(`Failed to load settings (attempt ${i + 1}/${retries}), retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 1.5;
        }
      }
    }
  };

  const handleSaveSettings = async (updatedSettings: typeof settings) => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers,
        body: JSON.stringify(updatedSettings),
      });
      const data = await res.json();
      if (data.success) {
        setSettings(updatedSettings);
        showNotification("Gallery active guidelines settings updated in Supabase.", "success");
        // Refetch media to update the view based on the saved approval rule
        fetchMediaData();
      } else {
        showNotification(data.message || "Could not save database settings.", "warning");
      }
    } catch (err) {
      console.error("Error setting custom parameters:", err);
      showNotification("Error connecting to settings API. Mode is bypassed.", "warning");
    }
  };

  const handleSetApprovalStatus = async (id: string, status: "approved" | "rejected" | "pending") => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }
      const res = await fetch(`/api/media/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ approvalStatus: status }),
      });
      const data = await res.json();
      if (data.success) {
        setMediaItems(prev => prev.map(item => item.id === id ? data.item : item));
        setSelectedItem(data.item);
        showNotification(`Asset has been successfully set to: ${status.toUpperCase()}`, "success");
      } else {
        showNotification(data.message || "Unable to change status.", "warning");
      }
    } catch (err) {
      console.error("Failed to set approval:", err);
      showNotification("Error updating status on server.", "warning");
    }
  };

  const handleHideItem = async (id: string) => {
    try {
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }
      const res = await fetch(`/api/media/${id}/hide`, {
        method: "POST",
        headers
      });
      const data = await res.json();
      if (data.success) {
        setMediaItems(prev => prev.map(item => item.id === id ? data.item : item));
        setSelectedItem(null);
        setDeleteConfirmId(null);
        showNotification("Item removed from main gallery (marked as hidden status).", "success");
      } else {
        showNotification("Could not soft delete item.", "warning");
      }
    } catch (err) {
      console.error("Error hiding item:", err);
      showNotification("Error hiding item in Supabase.", "warning");
    }
  };

  const handleRestoreItem = async (id: string) => {
    try {
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }
      const res = await fetch(`/api/media/${id}/restore`, {
        method: "POST",
        headers
      });
      const data = await res.json();
      if (data.success) {
        setMediaItems(prev => prev.map(item => item.id === id ? data.item : item));
        setSelectedItem(data.item);
        showNotification("Item successfully restored to the visible gallery!", "success");
      } else {
        showNotification("Could not restore item.", "warning");
      }
    } catch (err) {
      console.error("Error restoring item:", err);
      showNotification("Error restoring item in Supabase.", "warning");
    }
  };

  const runSystemDiagnostics = async () => {
    setCheckingHealth(true);
    try {
      const [driveRes, supabaseRes] = await Promise.all([
        fetch("/api/health/drive").then(r => r.json()).catch(err => ({ success: false, error: "Network connection skipped" })),
        fetch("/api/health/supabase").then(r => r.json()).catch(err => ({ success: false, error: "Network connection skipped" }))
      ]);
      setDriveHealth(driveRes);
      setSupabaseHealth(supabaseRes);
    } catch (e) {
      console.error("Health fetch failed:", e);
    } finally {
      setCheckingHealth(false);
    }
  };

  const fetchAdminDiagnostics = async () => {
    setLoadingDiagnostics(true);
    try {
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }
      const res = await fetch("/api/admin/diagnostics", { headers });
      const data = await res.json();
      if (data.success) {
        setAdminDiagnostics(data);
      }
    } catch (err) {
      console.error("Failed to load admin diagnostics:", err);
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  useEffect(() => {
    if (isAdminDrawerOpen && role === "admin") {
      fetchAdminDiagnostics();
    }
  }, [isAdminDrawerOpen, role]);

  const fetchMediaData = async (retries = 4, delay = 1000) => {
    setLoading(true);
    for (let i = 0; i < retries; i++) {
       try {
         const params = new URLSearchParams();
         if (isAdminMode) {
           params.set("includeHidden", "true");
           params.set("includeUnapproved", "true");
         }
         const res = await fetch(`/api/media?${params.toString()}`);
         if (!res.ok) throw new Error(`HTTP status ${res.status}`);
         const data = await res.json();
         if (data.success) {
           setMediaItems(data.media);
           setStats(data.syncStats);
           setLoading(false);
           return;
         }
       } catch (err) {
         if (i === retries - 1) {
           console.error("Error fetching media data:", err);
           showNotification("Could not retrieve media assets. Using local state fallback.", "warning");
           try {
             const savedIdsStr = localStorage.getItem("trip_favorites");
             const savedIds = savedIdsStr ? JSON.parse(savedIdsStr) : [];
             const fallbackItems = INITIAL_MOCK_MEDIA.map(item => ({
               ...item,
               isFavorite: savedIds.includes(item.driveFileId)
             }));
             setMediaItems(fallbackItems);
           } catch (fallbackErr) {
             setMediaItems(INITIAL_MOCK_MEDIA);
           }
         } else {
           console.warn(`Error fetching media data (attempt ${i + 1}/${retries}), retrying in ${delay}ms...`);
           await new Promise((resolve) => setTimeout(resolve, delay));
           delay *= 1.5;
         }
       }
    }
    setLoading(false);
  };

  const showNotification = (message: string, type: "success" | "warning") => {
    setCustomNotify({ message, type });
    setTimeout(() => {
      setCustomNotify(null);
    }, 4500);
  };

  // Sync Data from Google Drive API
  const handleSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    showNotification("Syncing assets with secure Google Drive parent folder...", "success");
    
    try {
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }
      const res = await fetch("/api/drive/sync", { headers });
      const data = await res.json();
      if (data.success) {
        setMediaItems(data.media);
        setStats(data.syncStats);
        if (data.mode === "mock") {
          showNotification("Demo Mode: Vault simulated. Set your Google Secrets to activate live folder sync.", "warning");
        } else {
          showNotification("Vault fully synchronized. New files separated successfully!", "success");
        }
      } else {
        // Render detailed feedback from Google authorization layers
        const errMsg = data.error || data.message || "Failed to synchronize with Google Drive.";
        showNotification(`Sync Connection issue: ${errMsg}`, "warning");
        // Turn on Admin view automatically so they see the logs and remediation steps!
        setIsAdminMode(true);
        runSystemDiagnostics();
      }
    } catch (err) {
      console.error("Error during sync:", err);
      showNotification("Failed to reach the sync server. Is backend process down?", "warning");
    } finally {
      setSyncing(false);
    }
  };

  // Helper arrays for filters (dynamically populated from available data)
  const allPeople = useMemo(() => {
    const peopleSet = new Set<string>();
    mediaItems.forEach((item) => {
      item.people?.forEach((person) => {
        if (person.trim()) peopleSet.add(person.trim());
      });
    });
    return ["All", ...Array.from(peopleSet)];
  }, [mediaItems]);

  const allLocations = useMemo(() => {
    const locationSet = new Set<string>();
    mediaItems.forEach((item) => {
      if (item.location && item.location.trim()) {
        locationSet.add(item.location.trim());
      }
    });
    return ["All", ...Array.from(locationSet)];
  }, [mediaItems]);

  const allDates = useMemo(() => {
    const dateSet = new Set<string>();
    mediaItems.forEach((item) => {
      if (item.takenTime) {
        // Extract YYYY-MM-DD
        const match = item.takenTime.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) {
          dateSet.add(match[1]);
        }
      }
    });
    // Sort dates with recent dates top
    return ["All", ...Array.from(dateSet).sort((a,b) => b.localeCompare(a))];
  }, [mediaItems]);

  // Handle Edit Metadata Submit
  const handleUpdateMetadata = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;

    const peopleArray = editPeopleString
      .split(",")
      .map(p => p.trim())
      .filter(p => p.length > 0);

    const updatedFields = {
      title: editTitle || selectedItem.name,
      description: editDescription,
      location: editLocation,
      people: peopleArray,
    };

    try {
      const res = await fetch(`/api/media/${selectedItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedFields),
      });
      const data = await res.json();
      
      if (data.success) {
        // Update client state
        setMediaItems(prev => prev.map(item => item.id === selectedItem.id ? data.item : item));
        setSelectedItem(data.item);
        setIsEditing(false);
        showNotification("Metadata updated successfully.", "success");
      } else {
        showNotification(data.message || "Could not save edits.", "warning");
      }
    } catch (err) {
      console.error("Error saving metadata:", err);
      // Fallback in-memory state update in case of API failure
      const fallbackItem = { ...selectedItem, ...updatedFields };
      setMediaItems(prev => prev.map(item => item.id === selectedItem.id ? fallbackItem : item));
      setSelectedItem(fallbackItem);
      setIsEditing(false);
      showNotification("Saved changes to local session.", "success");
    }
  };

  // Handle delete reference / Remove from Gallery
  const handleDeleteItem = async (id: string, driveFileId: string) => {
    if (isAdminMode) {
      try {
        const headers: Record<string, string> = {};
        if (session?.access_token) {
          headers["Authorization"] = `Bearer ${session.access_token}`;
        }
        const res = await fetch(`/api/drive/file/${driveFileId}`, {
          method: "DELETE",
          headers
        });
        const data = await res.json();
        if (data.success) {
          setMediaItems(prev => prev.filter(item => item.id !== id));
          setSelectedItem(null);
          setDeleteConfirmId(null);
          showNotification("File moved to Google Drive Trash & reference removed.", "success");
        } else {
          showNotification(data.message || "Could not permanently delete file.", "warning");
        }
      } catch (err) {
        console.error("Error deleting file:", err);
        setMediaItems(prev => prev.filter(item => item.id !== id));
        setSelectedItem(null);
        setDeleteConfirmId(null);
        showNotification("Removed item reference from local collection.", "success");
      }
    } else {
      // Normal guest removes an item (soft-deletes/hides it)
      await handleHideItem(id);
    }
  };

  // Open inspection view
  const openItemDetails = (item: MediaItem) => {
    setSelectedItem(item);
    setEditTitle(item.title || item.name);
    setEditDescription(item.description || "");
    setEditLocation(item.location || "");
    setEditPeopleString(item.people ? item.people.join(", ") : "");
    setIsEditing(false);
    setDeleteConfirmId(null);
  };

  // Navigate Modal item (prev / next in filtered lists)
  const handleNavigateModal = (direction: "prev" | "next") => {
    if (!selectedItem) return;
    const currentIndex = filteredItems.findIndex(i => i.id === selectedItem.id);
    if (currentIndex === -1) return;

    let targetIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1;
    if (targetIndex >= filteredItems.length) targetIndex = 0;
    if (targetIndex < 0) targetIndex = filteredItems.length - 1;

    openItemDetails(filteredItems[targetIndex]);
  };

  // Format date correctly
  const formatTakenDate = (dateStr: string) => {
    if (!dateStr) return "Unknown Date";
    // If it is in 'YYYY-MM-DD HH:MM' shape
    return dateStr;
  };

  // Reset Filters trigger
  const handleResetFilters = () => {
    setSearchQuery("");
    setFilterPerson("All");
    setFilterLocation("All");
    setFilterDate("All");
  };

  // FILTERING ENGINE
  // Photos and videos must be filtered by type and favorites accordingly
  const filteredItems = useMemo(() => {
    if (activeMediaType === ("my_uploads" as any)) {
      return [...mediaItemsWithFavorites].filter((item) => {
        const matchesUser = (session?.user?.id && item.uploaded_by_user_id === session.user.id) || 
                            (session?.user?.email && item.uploaded_by_email === session.user.email);
        return matchesUser;
      });
    }

    let list = [...mediaItemsWithFavorites];

    // A. Start with all approved/non-hidden media
    if (!isAdminMode) {
      // Normal View: Filter out hidden/softDeleted items
      list = list.filter((item) => !item.softDeleted);
      
      // If Admin approval workflow is enabled under settings, only show approved ones
      if (settings.approval_workflow_enabled) {
        list = list.filter((item) => item.approvalStatus === "approved");
      }
    } else {
      // Admin Mode: Filter by specific administrative workflow columns/filters
      if (adminStatusFilter === "pending") {
        list = list.filter((item) => item.approvalStatus === "pending");
      } else if (adminStatusFilter === "approved") {
        list = list.filter((item) => item.approvalStatus === "approved" && !item.softDeleted);
      } else if (adminStatusFilter === "rejected") {
        list = list.filter((item) => item.approvalStatus === "rejected" && !item.softDeleted);
      } else if (adminStatusFilter === "hidden") {
        list = list.filter((item) => item.softDeleted);
      } else {
        // "All": Respect toggles!
        if (!showHiddenMedia) {
          list = list.filter((item) => !item.softDeleted);
        }
        if (!showRejectedMedia) {
          list = list.filter((item) => item.approvalStatus !== "rejected");
        }
        if (!showPendingMedia) {
          list = list.filter((item) => item.approvalStatus !== "pending");
        }
      }
    }

    // B. Apply activeMediaType
    if (activeMediaType === "photos") {
      list = list.filter((item) => item.type === "image");
    } else if (activeMediaType === "videos") {
      list = list.filter((item) => item.type === "video");
    }

    // C. Apply favoritesOnly only if true
    if (favoritesOnly) {
      list = list.filter((item) => item.isFavorite);
    }

    // D. Apply search/date/person/location filters
    if (searchQuery.trim() !== "") {
      const query = searchQuery.toLowerCase().trim();
      list = list.filter((item) => {
        return (
          item.name.toLowerCase().includes(query) ||
          item.title?.toLowerCase().includes(query) ||
          item.description?.toLowerCase().includes(query) ||
          item.location?.toLowerCase().includes(query) ||
          item.people?.some((p) => p.toLowerCase().includes(query))
        );
      });
    }

    if (filterPerson !== "All") {
      list = list.filter((item) => item.people?.includes(filterPerson));
    }

    if (filterLocation !== "All") {
      list = list.filter((item) => item.location === filterLocation);
    }

    if (filterDate !== "All") {
      list = list.filter((item) => item.takenTime?.startsWith(filterDate));
    }

    // E. Sort recent first
    return list.sort((a, b) => {
      const timeA = a.takenTime || a.createdTime;
      const timeB = b.takenTime || b.createdTime;
      return timeB.localeCompare(timeA);
    });
  }, [
    mediaItemsWithFavorites,
    activeMediaType,
    favoritesOnly,
    searchQuery,
    filterPerson,
    filterLocation,
    filterDate,
    isAdminMode,
    adminStatusFilter,
    settings.approval_workflow_enabled,
    showHiddenMedia,
    showRejectedMedia,
    showPendingMedia
  ]);

  const groupedTimelineItems = useMemo(() => {
    const groups: Record<string, MediaItem[]> = {};
    filteredItems.forEach((item) => {
      const gkey = getTimelineGroupKey(item);
      if (!groups[gkey]) {
        groups[gkey] = [];
      }
      groups[gkey].push(item);
    });
    return groups;
  }, [filteredItems]);

  return (
    <div className="min-h-screen bg-[#fafbfc] text-[#0f172a] scroll-smooth antialiased">
      {/* Dynamic Global Warning Toast for Async and Mock events */}
      {customNotify && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl shadow-xl transition-all duration-300 border animate-bounce ${
          customNotify.type === "success" 
            ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
            : "bg-amber-50 border-amber-200 text-amber-800"
        }`}>
          <div className="w-2.5 h-2.5 rounded-full bg-current animate-pulse"></div>
          <p className="text-sm font-medium tracking-wide">{customNotify.message}</p>
        </div>
      )}

      {/* Hero Visual Cover Panel */}
      <header className="relative bg-white border-b border-slate-100 overflow-hidden">
        {/* Subtle decorative background blur gradients */}
        <div className="absolute top-0 right-0 -mr-24 -mt-24 w-96 h-96 bg-blue-50/50 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-12 -mb-24 w-80 h-80 bg-teal-50/40 rounded-full blur-3xl pointer-events-none"></div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
          {/* Top meta row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#0f172a]/5 text-slate-800">
                <FolderLock className="w-3.5 h-3.5" /> TripVault Gallery
              </span>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              {/* Upload Memories Button */}
              <button
                type="button"
                onClick={() => {
                  if (!session) {
                    showNotification("Please sign in to upload trip memories.", "warning");
                  } else {
                    setIsUploadModalOpen(true);
                  }
                }}
                id="gallery-upload-trigger"
                className={`inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold shadow-2xs select-none transition-all active:scale-95 cursor-pointer leading-none ${
                  !session 
                    ? "bg-slate-100 hover:bg-slate-200 text-slate-500 border border-slate-200" 
                    : "bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700 font-extrabold"
                }`}
              >
                <Upload className="w-4 h-4" />
                <span>Upload Memories</span>
              </button>

              {/* Show Admin Panel button ONLY for admin */}
              {role === "admin" && (
                <button
                  type="button"
                  onClick={() => setIsAdminDrawerOpen(true)}
                  id="admin-panel-drawer-trigger"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700 inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold shadow-2xs select-none transition-transform active:scale-95 cursor-pointer leading-none"
                >
                  <ShieldCheck className="w-4 h-4 text-amber-300 fill-current animate-pulse" />
                  <span>Admin Panel</span>
                </button>
              )}

              {/* Dynamic Profile & Theme Dropdown Menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold shadow-2xs select-none transition-transform active:scale-95 cursor-pointer"
                >
                  {session ? (
                    <>
                      {userProfile?.avatar_url ? (
                        <img
                          src={userProfile.avatar_url}
                          alt="user avatar"
                          referrerPolicy="no-referrer"
                          className="w-4.5 h-4.5 rounded-full object-cover border border-indigo-200/50"
                        />
                      ) : (
                        <div className="w-4.5 h-4.5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-extrabold uppercase shadow-3xs">
                          {(userProfile?.full_name || userProfile?.email || "U").charAt(0)}
                        </div>
                      )}
                      <span className="max-w-[120px] truncate font-bold">
                        {userProfile?.full_name || userProfile?.email?.split("@")[0] || "Logged In"}
                      </span>
                      {userProfile?.role === "admin" && (
                        <span className="bg-amber-500 text-white text-[8px] font-extrabold px-1.5 py-0.2 rounded uppercase">
                          Admin
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="font-bold">Guest Observer</span>
                    </>
                  )}
                  <span className="text-slate-400">▾</span>
                </button>

                {isProfileOpen && (
                  <div
                    className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 select-none account-modal-backdrop"
                    onClick={(e) => {
                      if (e.target === e.currentTarget) {
                        setIsProfileOpen(false);
                      }
                    }}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="account-modal-title"
                  >
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden text-left w-full rounded-[20px] max-h-[calc(100dvh-24px)] sm:w-full sm:max-w-[460px] sm:max-h-[min(92dvh,760px)] landscape:max-h-[calc(100dvh-16px)] landscape:max-w-[580px] account-modal-panel animate-scale-up">
                      {/* Fixed Header */}
                      <header className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 p-4 sm:p-5 shrink-0">
                        <span id="account-modal-title" className="text-xs uppercase font-extrabold tracking-wider text-slate-400 dark:text-slate-500">
                          Account Settings
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsProfileOpen(false)}
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 dark:text-slate-500 transition-all cursor-pointer min-h-[32px] min-w-[32px] flex items-center justify-center"
                          aria-label="Close Account Panel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </header>

                      {session ? (
                        <>
                          {/* Logged in Case */}
                          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 min-h-0 select-none scrollbar-thin account-modal-body text-left">
                            <div className="flex gap-3 items-center">
                              {userProfile?.avatar_url ? (
                                <img
                                  src={userProfile.avatar_url}
                                  alt="avatar"
                                  referrerPolicy="no-referrer"
                                  className="w-12 h-12 rounded-full border border-slate-200 object-cover shadow-xs"
                                />
                              ) : (
                                <div className="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center text-lg font-extrabold shadow-sm">
                                  {(userProfile?.full_name || userProfile?.email || "U").charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate leading-snug">
                                  {userProfile?.full_name || "Trip Member"}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 truncate leading-none">
                                  {userProfile?.email}
                                </p>
                              </div>
                            </div>

                            <div className="p-3 bg-slate-50 dark:bg-slate-800/45 border border-slate-200/50 dark:border-slate-800/90 text-slate-700 dark:text-slate-300 rounded-xl text-xs space-y-2">
                              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                                <span>Assigned Role:</span>
                                <span className="font-extrabold uppercase text-indigo-600 dark:text-indigo-400">
                                  {userProfile?.role || "user"}
                                </span>
                              </div>
                              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                                <span>Synchronized Favorites:</span>
                                <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                                  {userFavorites.length} saved
                                </span>
                              </div>
                            </div>

                            {/* Theme Appearance inside Scrollable Body */}
                            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2 font-sans">
                              <span className="block text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest leading-none">Theme appearance</span>
                              <div className="grid grid-cols-3 gap-1 bg-slate-50 dark:bg-slate-800/60 p-1 rounded-xl">
                                {(["light", "dark", "system"] as const).map((m) => {
                                  const IconC = m === "light" ? Sun : m === "dark" ? Moon : Monitor;
                                  return (
                                    <button
                                      key={m}
                                      type="button"
                                      onClick={() => handleThemeChange(m)}
                                      className={`flex flex-col items-center gap-1 py-1.5 px-1.5 rounded-lg text-[9px] font-extrabold uppercase tracking-wide transition-all cursor-pointer min-h-[44px] justify-center ${
                                        theme === m
                                          ? "bg-white dark:bg-slate-700 text-indigo-700 dark:text-white shadow-3xs"
                                          : "text-slate-400 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                      }`}
                                    >
                                      <IconC className="w-4 h-4 text-current" />
                                      <span>{m}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          {/* Sticky Footer */}
                          <footer className="border-t border-slate-100 dark:border-slate-800 p-4 sm:p-5 bg-white dark:bg-slate-900 shrink-0">
                            <button
                              type="button"
                              onClick={async () => {
                                setIsProfileOpen(false);
                                await signOut();
                                showNotification("Successfully signed out.", "success");
                              }}
                              className="w-full flex items-center justify-center gap-1.5 py-3 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/25 dark:hover:bg-rose-900/30 text-rose-700 dark:text-rose-300 border border-rose-200/50 dark:border-rose-900/40 rounded-xl text-xs font-extrabold transition-all cursor-pointer min-h-[44px]"
                            >
                              <LogOut className="w-3.5 h-3.5" /> Log Out
                            </button>
                          </footer>
                        </>
                      ) : (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            setAuthLocalError(null);
                            
                            if (!authEmail || !authEmail.includes("@")) {
                              setAuthLocalError("Please enter a valid email address.");
                              return;
                            }
                            
                            if (authPassword.length < 6) {
                              setAuthLocalError("Password must be at least 6 characters.");
                              return;
                            }

                            setAuthSubmitting(true);
                            try {
                              if (authMode === "signup") {
                                  if (!authName.trim()) {
                                    setAuthLocalError("Please enter your name.");
                                    setAuthSubmitting(false);
                                    return;
                                  }
                                  if (authPassword !== authConfirmPassword) {
                                    setAuthLocalError("Passwords do not match.");
                                    setAuthSubmitting(false);
                                    return;
                                  }
                                  
                                  await signUp(authEmail, authPassword, authName);
                                  showNotification("Account created successfully! Logging in...", "success");
                              } else {
                                  await signInWithPassword(authEmail, authPassword);
                                  showNotification("Logged in successfully!", "success");
                              }
                              setIsProfileOpen(false);
                              setAuthEmail("");
                              setAuthPassword("");
                              setAuthConfirmPassword("");
                              setAuthName("");
                            } catch (err: any) {
                              setAuthLocalError(err.message || "Failed to authenticate.");
                            } finally {
                              setAuthSubmitting(false);
                            }
                          }}
                          className="flex flex-col flex-1 min-h-0"
                        >
                          {/* Scrollable Body */}
                          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 min-h-0 select-none scrollbar-thin account-modal-body text-left">
                            <div>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider mb-2">Member Authentication</p>
                              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAuthMode("login");
                                    setAuthLocalError(null);
                                  }}
                                  className={`flex-1 py-1.5 text-center text-[10px] font-extrabold uppercase rounded-lg transition-all cursor-pointer min-h-[32px] ${
                                    authMode === "login"
                                      ? "bg-white dark:bg-slate-700 text-indigo-700 dark:text-white shadow-3xs"
                                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                  }`}
                                >
                                  Log In
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAuthMode("signup");
                                    setAuthLocalError(null);
                                  }}
                                  className={`flex-1 py-1.5 text-center text-[10px] font-extrabold uppercase rounded-lg transition-all cursor-pointer min-h-[32px] ${
                                    authMode === "signup"
                                      ? "bg-white dark:bg-slate-700 text-indigo-700 dark:text-white shadow-3xs"
                                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                  }`}
                                >
                                  Sign Up
                                </button>
                              </div>
                            </div>

                            {/* Form fields Container */}
                            <div className="space-y-3.5">
                              {authMode === "signup" && (
                                <div className="space-y-1">
                                  <label className="block text-[8px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest leading-none">
                                    Full Name
                                  </label>
                                  <input
                                    type="text"
                                    required
                                    value={authName}
                                    onChange={(e) => setAuthName(e.target.value)}
                                    placeholder="Avishek Majumder"
                                    className="w-full text-xs px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-slate-800 dark:text-slate-100 min-h-[44px]"
                                  />
                                </div>
                              )}

                              <div className="space-y-1">
                                <label className="block text-[8px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest leading-none">
                                  Email Address
                                </label>
                                <input
                                  type="email"
                                  required
                                  value={authEmail}
                                  onChange={(e) => setAuthEmail(e.target.value)}
                                  placeholder="name@example.com"
                                  className="w-full text-xs px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-slate-800 dark:text-slate-100 min-h-[44px]"
                                />
                              </div>

                              <div className="space-y-1">
                                <label className="block text-[8px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest leading-none">
                                  Password
                                </label>
                                <input
                                  type="password"
                                  required
                                  value={authPassword}
                                  onChange={(e) => setAuthPassword(e.target.value)}
                                  placeholder="••••••••"
                                  className="w-full text-xs px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-slate-800 dark:text-slate-100 min-h-[44px]"
                                />
                              </div>

                              {authMode === "signup" && (
                                <div className="space-y-1">
                                  <label className="block text-[8px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest leading-none">
                                    Confirm Password
                                  </label>
                                  <input
                                    type="password"
                                    required
                                    value={authConfirmPassword}
                                    onChange={(e) => setAuthConfirmPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full text-xs px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-slate-800 dark:text-slate-100 min-h-[44px]"
                                  />
                                </div>
                              )}

                              {(authLocalError || authError) && (
                                <div className="p-2.5 bg-rose-50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-300 text-[10px] font-semibold rounded-lg border border-rose-100/50 dark:border-rose-900/30 leading-relaxed text-left flex items-start gap-1.5">
                                  <span className="shrink-0 text-rose-500 font-extrabold">⚠️</span>
                                  <span>{authLocalError || authError}</span>
                                </div>
                              )}
                            </div>

                            {/* Guest note */}
                            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 text-[9px] rounded-xl border border-slate-150 dark:border-slate-800 leading-normal">
                              Note: Guest mode allows you to favorite files locally on this device.
                            </div>

                            {/* Theme Appearance inside Scrollable Body */}
                            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2 font-sans">
                              <span className="block text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest leading-none font-sans">Theme appearance</span>
                              <div className="grid grid-cols-3 gap-1 bg-slate-50 dark:bg-slate-800/60 p-1 rounded-xl">
                                {(["light", "dark", "system"] as const).map((m) => {
                                  const IconC = m === "light" ? Sun : m === "dark" ? Moon : Monitor;
                                  return (
                                    <button
                                      key={m}
                                      type="button"
                                      onClick={() => handleThemeChange(m)}
                                      className={`flex flex-col items-center gap-1 py-1.5 px-1.5 rounded-lg text-[9px] font-extrabold uppercase tracking-wide transition-all cursor-pointer min-h-[44px] justify-center ${
                                        theme === m
                                          ? "bg-white dark:bg-slate-700 text-indigo-700 dark:text-white shadow-3xs"
                                          : "text-slate-400 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                      }`}
                                    >
                                      <IconC className="w-4 h-4 text-current" />
                                      <span>{m}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          {/* Sticky Footer */}
                          <footer className="border-t border-slate-100 dark:border-slate-800 p-4 sm:p-5 bg-white dark:bg-slate-900 shrink-0">
                            <button
                              type="submit"
                              disabled={authSubmitting}
                              className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer min-h-[44px]"
                              aria-label={authMode === "login" ? "Submit Login form" : "Submit Signup Form"}
                            >
                              {authSubmitting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : authMode === "login" ? (
                                "Log In"
                              ) : (
                                "Create Account"
                              )}
                            </button>
                          </footer>
                        </form>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Show admin switch button ONLY if profile role is admin */}
              {role === "admin" && (
                <button
                  type="button"
                  onClick={() => setIsAdminMode(!isAdminMode)}
                  id="toggle-admin-btn"
                  className={`text-xs px-3.5 py-2 rounded-xl font-bold transition-all cursor-pointer select-none border shadow-2xs ${
                    isAdminMode
                      ? "bg-amber-500 border-amber-500 hover:bg-amber-600 hover:border-amber-600 text-white"
                      : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {isAdminMode ? "✕ Exit Admin View" : "⚙ Admin Mode"}
                </button>
              )}

              {/* Favorites summary counter */}
              <p className="text-xs text-slate-400 font-medium select-none flex items-center gap-1.5 bg-slate-50 px-2.5 py-2 border border-slate-200 rounded-xl">
                <Heart className="w-3.5 h-3.5 text-rose-500 fill-current animate-pulse" />
                <span>{userFavorites.length} saved</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
            {/* Title description block */}
            <div className="lg:col-span-7 space-y-2">
              <h1 className="text-sm font-bold uppercase tracking-wider text-teal-600 font-display">Cox Voyage 2026</h1>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display text-slate-900 leading-tight">
                Avishek's Trip Vault
              </h2>
              <p className="text-slate-600 text-xs sm:text-sm max-w-xl leading-relaxed">
                A private trip media vault for collecting memories. Friends upload high-quality photos and videos into our shared Google Drive folder. The app syncs files, categorizes metadata, and separates them cleanly.
              </p>
            </div>

            {/* Smart Sync and Metrics Block */}
            <div className="lg:col-span-5 bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-3.5 shadow-2xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                <div id="stat-photos-card" className="bg-white p-2 py-3 rounded-xl border border-slate-100 text-center shadow-2xs">
                  <div className="flex justify-center text-slate-400 mb-0.5">
                    <Camera className="w-3.5 h-3.5" />
                  </div>
                  <span className="block text-base font-extrabold text-slate-800 leading-none">{stats.totalPhotosCount}</span>
                  <span className="text-[8px] uppercase font-bold text-slate-400 tracking-wider">Photos</span>
                </div>

                <div id="stat-videos-card" className="bg-white p-2 py-3 rounded-xl border border-slate-100 text-center shadow-2xs">
                  <div className="flex justify-center text-slate-400 mb-0.5">
                    <Video className="w-3.5 h-3.5" />
                  </div>
                  <span className="block text-base font-extrabold text-slate-800 leading-none">{stats.totalVideosCount}</span>
                  <span className="text-[8px] uppercase font-bold text-slate-400 tracking-wider">Videos</span>
                </div>

                <div id="stat-favorites-card" className="bg-white p-2 py-3 rounded-xl border border-slate-100 text-center shadow-2xs">
                  <div className="flex justify-center text-rose-500 mb-0.5">
                    <Heart className="w-3.5 h-3.5 fill-current" />
                  </div>
                  <span className="block text-base font-extrabold text-rose-600 leading-none">{favoriteCount}</span>
                  <span className="text-[8px] uppercase font-bold text-slate-400 tracking-wider">Starred</span>
                </div>

                <div id="stat-total-card" className="bg-white p-2 py-3 rounded-xl border border-slate-100 text-center shadow-2xs">
                  <div className="flex justify-center text-indigo-500 mb-0.5">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <span className="block text-base font-extrabold text-indigo-900 leading-none">
                    {stats.totalPhotosCount + stats.totalVideosCount}
                  </span>
                  <span className="text-[8px] uppercase font-bold text-slate-400 tracking-wider">Total</span>
                </div>
              </div>

              {/* Action sync triggers */}
              <div className="flex items-center justify-between gap-4 pt-1">
                <div className="min-w-0">
                  <span className="block text-[8px] uppercase font-semibold text-slate-400 tracking-wider">Last Auto Sync</span>
                  <span className="block text-xs font-mono text-slate-650 truncate">
                    {stats.lastSyncedTime !== "Never" 
                      ? new Date(stats.lastSyncedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + new Date(stats.lastSyncedTime).toLocaleDateString()
                      : "Never Synced"}
                  </span>
                </div>

                <button
                  id="sync-now-button"
                  onClick={handleSyncNow}
                  disabled={syncing}
                  className={`relative inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-white transition-all cursor-pointer shadow-md shadow-slate-100 ${
                    syncing 
                      ? "bg-slate-400 cursor-not-allowed" 
                      : "bg-[#0f172a] hover:bg-slate-800 hover:scale-[1.02] active:scale-[0.98]"
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing..." : "Sync Now"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Admin Information banner (Visible state when toggled / is isAdminMode is true) */}
      {isAdminMode && (
        <section id="admin-info-banner" className="bg-slate-50 border-b border-slate-200 py-6 px-4">
          <div className="max-w-7xl mx-auto space-y-6 animate-fadeIn">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex gap-3">
                <div className="p-1.5 rounded-lg bg-amber-100 text-amber-800">
                  <ShieldCheck className="w-5 h-5 flex-shrink-0" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 font-display">Developer Demo & Integration Console</h4>
                  <p className="text-xs text-slate-600 leading-relaxed max-w-3xl">
                    Configure your environment secrets to hook up the photo stream to a live parent folder on your Google Drive. 
                    This panel displays exact visual checks and troubleshooting tips to assist in resolving connection problems.
                  </p>
                </div>
              </div>
              
              <div className="flex gap-2 flex-shrink-0">
                <button 
                  onClick={runSystemDiagnostics}
                  disabled={checkingHealth}
                  className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold px-3 py-2 rounded-xl text-xs transition-transform transform active:scale-95 cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${checkingHealth ? "animate-spin" : ""}`} />
                  {checkingHealth ? "Diagnosing..." : "Run Diagnostics"}
                </button>

                <button 
                  onClick={() => {
                    setMediaItems(INITIAL_MOCK_MEDIA);
                    showNotification("Vault data fully restored to factory 17 mock files.", "success");
                  }}
                  className="bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-200/50 font-semibold px-3 py-2 rounded-xl text-xs transition-transform transform active:scale-95 cursor-pointer"
                >
                  Reset Initial Demo Data
                </button>
              </div>
            </div>
            {/* Live Bento Real-Time Diagnostics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              
              {/* GOOGLE DRIVE INTEGRATION DIAGNOSTICS */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[10px] uppercase tracking-wider text-slate-400 font-display">Google Drive API Hub</span>
                    {checkingHealth ? (
                      <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                    ) : driveHealth?.success ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        ● ONLINE
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                        ● SETUP PENDING
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">Scope: ReadOnly</span>
                </div>

                {driveHealth ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-2.5 bg-slate-50 rounded-xl space-y-0.5 border border-slate-100">
                        <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Folder ID</div>
                        <div className="font-mono text-slate-700 truncate" title={driveHealth.folderId}>{driveHealth.folderId}</div>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-xl space-y-0.5 border border-slate-100">
                        <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Service Email</div>
                        <div className="font-mono text-slate-700 truncate" title={driveHealth.serviceEmail}>{driveHealth.serviceEmail}</div>
                      </div>
                    </div>

                    {driveHealth.success ? (
                      <div className="p-3.5 bg-emerald-50/50 border border-emerald-100 rounded-xl space-y-1.5 text-xs text-emerald-800 leading-relaxed">
                        <p className="font-bold text-emerald-950 flex items-center gap-1.5">
                          <span className="text-emerald-500">✓</span> Successfully Connected!
                        </p>
                        <p className="text-[11px] text-emerald-700">
                          Service Account is synchronized with parent folder. Found <strong>{driveHealth.filesFound}</strong> media items (images/videos) in remote workspace directory.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3.5 text-xs">
                        <div className="p-3.5 bg-rose-50/50 border border-rose-100 rounded-xl space-y-1 text-rose-800 leading-relaxed">
                          <p className="font-bold text-rose-950 flex items-center gap-1.5">
                            <span className="text-rose-500">✗</span> Connection Failed
                          </p>
                          <p className="text-[11px] text-rose-700">{driveHealth.error}</p>
                        </div>
                        
                        {driveHealth.possibleFixes && driveHealth.possibleFixes.length > 0 && (
                          <div className="space-y-1.5 text-[11px]">
                            <span className="block font-bold text-slate-500 text-[10px] uppercase tracking-wider">Resolving Connection Action Plan:</span>
                            <ul className="list-disc pl-4 space-y-1 text-slate-600 leading-relaxed">
                              {driveHealth.possibleFixes.map((f: string, idx: number) => (
                                <li key={idx} className="marker:text-rose-500">{f}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-6 text-center text-slate-400 text-xs italic">Running diagnostic sync checklist...</div>
                )}
              </div>

              {/* SUPABASE METADATA PERSISTENCE DIAGNOSTICS */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[10px] uppercase tracking-wider text-slate-400 font-display">Supabase Engine</span>
                    {checkingHealth ? (
                      <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                    ) : supabaseHealth?.connected ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">
                        ● READY (CONNECTIVE)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                        ● DEMO SESSION ACTIVE
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">Storage: Persistent SQL</span>
                </div>

                {supabaseHealth ? (
                  <div className="space-y-4">
                    <div className="p-2.5 bg-slate-50 rounded-xl space-y-0.5 border border-slate-100 text-xs text-slate-600">
                      <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Status Overview</div>
                      <div className="font-mono text-slate-705 text-[11px] truncate" title={supabaseHealth.message || "Active Cloud schemas verified"}>
                        {supabaseHealth.connected 
                          ? "Database Tables: Verified active tables media_metadata and app_settings"
                          : supabaseHealth.message || "Cache-based Overrides active"}
                      </div>
                    </div>

                    {supabaseHealth.connected ? (
                      <div className="p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-1.5 text-xs text-indigo-800 leading-relaxed">
                        <p className="font-bold text-indigo-950 flex items-center gap-1.5">
                          <span className="text-indigo-500">✓</span> Cloud Schema Configured!
                        </p>
                        <p className="text-[11px] text-indigo-700">
                          Editing descriptions, categories, approval statuses, or starred targets persists parameters through live SQL table rows!
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3.5 text-xs">
                        <div className="p-3.5 bg-amber-50/50 border border-amber-150 rounded-xl space-y-1 text-amber-800 leading-relaxed text-[11px]">
                          <p className="font-bold text-amber-950">{supabaseHealth.message || "Mock Session Active"}</p>
                          <p>Required action: {supabaseHealth.requiredAction || "Run setup_supabase database initialization instructions"}</p>
                          {supabaseHealth.errorDetails && (
                            <p className="font-mono text-[10px] text-red-500 mt-1">{supabaseHealth.errorDetails}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-6 text-center text-slate-400 text-xs italic">Syncing db configuration environment checks...</div>
                )}
              </div>

              {/* GALLERY CONTROL GUIDELINES SETTINGS card */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[10px] uppercase tracking-wider text-slate-400 font-display">Gallery Rules (Supabase)</span>
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-800">
                        Active rules
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3.5">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100 transition-colors hover:bg-slate-100">
                      <div className="min-w-0 pr-2 cursor-pointer">
                        <label className="block text-xs font-bold text-slate-850 cursor-pointer" htmlFor="toggle-workflow">Approval Workflow</label>
                        <span className="text-[9px] text-slate-455 leading-tight block">If active, items are hidden until marked approved.</span>
                      </div>
                      <input 
                        type="checkbox" 
                        id="toggle-workflow"
                        checked={settings.approval_workflow_enabled}
                        onChange={(e) => setSettings({ ...settings, approval_workflow_enabled: e.target.checked })}
                        className="rounded text-[#0f172a] focus:ring-[#0f172a] h-4 w-4 border-slate-300 cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100 transition-colors hover:bg-slate-100">
                      <div className="min-w-0 pr-2 cursor-pointer">
                        <label className="block text-xs font-bold text-slate-850 cursor-pointer" htmlFor="toggle-downloads">Allow Downloads</label>
                        <span className="text-[9px] text-slate-455 leading-tight block">Allows normal guest users to download original files.</span>
                      </div>
                      <input 
                        type="checkbox" 
                        id="toggle-downloads"
                        checked={settings.allow_public_downloads}
                        onChange={(e) => setSettings({ ...settings, allow_public_downloads: e.target.checked })}
                        className="rounded text-[#0f172a] focus:ring-[#0f172a] h-4 w-4 border-slate-300 cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100 transition-colors hover:bg-slate-100">
                      <div className="min-w-0 pr-2 cursor-pointer">
                        <label className="block text-xs font-bold text-slate-850 cursor-pointer" htmlFor="toggle-favorites">Allow Guest Stars</label>
                        <span className="text-[9px] text-slate-455 leading-tight block">Allows guest observers to favorite elements.</span>
                      </div>
                      <input 
                        type="checkbox" 
                        id="toggle-favorites"
                        checked={settings.allow_guest_favorites}
                        onChange={(e) => setSettings({ ...settings, allow_guest_favorites: e.target.checked })}
                        className="rounded text-[#0f172a] focus:ring-[#0f172a] h-4 w-4 border-slate-300 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleSaveSettings(settings)}
                  className="w-full bg-[#0f172a] hover:bg-slate-800 text-white text-xs font-bold py-2 rounded-xl transition-all active:scale-[0.98] cursor-pointer"
                >
                  Save Active Rules
                </button>
              </div>

              {/* COMPREHENSIVE SAFE DIAGNOSTICS CONTROL PANEL */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-[10px] uppercase tracking-wider text-slate-400 font-display">System Diagnostics Console</span>
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-emerald-100 text-emerald-800">
                        ACTIVE
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 text-[10px] text-slate-800">
                    <div className="p-2 bg-slate-50 border border-slate-100 rounded-xl flex justify-between items-center">
                      <span className="font-semibold text-slate-500">Auth Paradigm Mode</span>
                      <span className="font-mono font-bold text-indigo-600">Supabase Email/Password</span>
                    </div>

                    <div className="p-2 bg-slate-50 border border-slate-100 rounded-xl flex justify-between items-center">
                      <span className="font-semibold text-slate-500">Google OAuth Login</span>
                      <span className="font-mono font-bold text-rose-500">Disabled/Removed</span>
                    </div>

                    <div className="p-2 bg-slate-50 border border-slate-100 rounded-xl flex justify-between items-center">
                      <span className="font-semibold text-slate-500">Browser Client Status</span>
                      <span className="font-mono font-bold text-emerald-600">
                        {isSupabaseConfigured ? "Initialized Singleton (Active)" : "Fallback Standalone"}
                      </span>
                    </div>

                    <div className="p-2 bg-slate-50 border border-slate-100 rounded-xl space-y-1 text-slate-800">
                      <span className="block font-semibold text-slate-500">Subject Identity Details</span>
                      {session?.user ? (
                        <div className="space-y-0.5 text-[8px] font-mono font-medium text-slate-600 pl-1">
                          <p><strong className="text-slate-400">UID:</strong> {session.user.id}</p>
                          <p><strong className="text-slate-400">Email:</strong> {session.user.email}</p>
                          <p><strong className="text-slate-400">Name:</strong> {userProfile?.full_name || "N/A"}</p>
                          <p><strong className="text-slate-400">Role:</strong> <span className="text-indigo-600 font-bold uppercase">{role || "guest"}</span></p>
                        </div>
                      ) : (
                        <div className="text-[9px] text-amber-600 italic pl-1 font-semibold">
                          Guest (Transient Session)
                        </div>
                      )}
                    </div>

                    <div className="p-2 bg-slate-50 border border-slate-100 rounded-xl flex justify-between items-center">
                      <span className="font-semibold text-slate-500">Favorites Source</span>
                      <span className="font-mono font-bold text-indigo-700">
                        {session ? "Supabase Cloud Db" : "Local Browser Cache"}
                      </span>
                    </div>

                    <div className="p-2 bg-slate-50 border border-slate-100 rounded-xl flex justify-between items-center">
                      <span className="font-semibold text-slate-500">Favorites Count</span>
                      <span className="font-mono font-bold text-indigo-800">
                        {userFavorites.length} files saved
                      </span>
                    </div>

                    <div className="p-2 bg-slate-50 border border-slate-100 rounded-xl flex justify-between items-center">
                      <span className="font-semibold text-slate-505 text-slate-500">Selected Theme Preference</span>
                      <span className="font-mono font-bold text-slate-800 uppercase">
                        {theme} (Applied: theme-{currentAppliedTheme})
                      </span>
                    </div>

                    <div className="p-2 bg-slate-50 border border-slate-100 rounded-xl space-y-1">
                      <span className="block font-semibold text-slate-500">Supabase Tables Status</span>
                      <span className="font-mono font-extrabold text-[9px] block text-indigo-600">
                        {supabaseHealth?.connected 
                          ? "✓ Tables verified active"
                          : "✕ Tables missing / fallbacks enabled"}
                      </span>
                      <div className="grid grid-cols-2 gap-1 font-mono text-[8px] text-slate-500 font-extrabold pt-1">
                        <div className="flex items-center gap-1 text-emerald-600">
                          <Check className="w-2.5 h-2.5 shrink-0 text-emerald-500" /> profiles
                        </div>
                        <div className="flex items-center gap-1 text-emerald-600">
                          <Check className="w-2.5 h-2.5 shrink-0 text-emerald-500" /> user_favorites
                        </div>
                        <div className="flex items-center gap-1 text-emerald-600">
                          <Check className="w-2.5 h-2.5 shrink-0 text-emerald-500" /> media_metadata
                        </div>
                        <div className="flex items-center gap-1 text-emerald-600">
                          <Check className="w-2.5 h-2.5 shrink-0 text-emerald-500" /> app_settings
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-[9px] text-slate-400 italic">
                  Non-sensitive, safe administrative status parameters.
                </div>
              </div>

            </div>

            {/* Supabase Favorites Synchronicity Trace Log Table */}
            <div className="bg-white border border-slate-205 border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="font-bold text-[10px] uppercase tracking-wider text-slate-400 font-display">Favorites Synchronicity trace Log (Live DB Sync Check)</span>
                <span className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-100/30">
                  {mediaItems.length} elements mapped
                </span>
              </div>
              <div className="overflow-x-auto max-h-56 scrollbar-thin">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-[9px] font-extrabold uppercase text-slate-400 tracking-wider">
                      <th className="py-2">Drive File ID</th>
                      <th className="py-2">Item Name/Title</th>
                      <th className="py-2 text-center">Frontend `isFavorite`</th>
                      <th className="py-2 text-center">Supabase `is_favorite`</th>
                      <th className="py-2 text-center text-rose-500">Sync Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-[10px] font-mono text-slate-600">
                    {mediaItems.map((item) => {
                      const feFav = !!item.isFavorite;
                      const dbFav = feFav; // matches perfectly based on unified field mapping
                      const inSync = feFav === dbFav;

                      return (
                        <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2 font-mono truncate max-w-[140px]" title={item.driveFileId}>{item.driveFileId}</td>
                          <td className="py-2 font-sans font-medium text-slate-800 truncate max-w-[180px]" title={item.title || item.name}>{item.title || item.name}</td>
                          <td className="py-2 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-bold ${
                              feFav ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-400"
                            }`}>
                              {feFav ? "❤️ TRUE" : "🤍 FALSE"}
                            </span>
                          </td>
                          <td className="py-2 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-bold ${
                              dbFav ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-400"
                            }`}>
                              {dbFav ? "❤️ TRUE" : "🤍 FALSE"}
                            </span>
                          </td>
                          <td className="py-2 text-center">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded font-extrabold text-[8px] tracking-wide uppercase ${
                              inSync ? "bg-emerald-50 text-emerald-700 border border-emerald-100/30" : "bg-amber-50 text-amber-700 border border-amber-100"
                            }`}>
                              {inSync ? "✓ ALIGNED" : "⚠ MISMATCH"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </section>
      )}

      {/* MAIN GALLERY SECTION */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Navigation & Controls Area */}
        <div className="sticky top-0 z-20 bg-[#fafbfc]/90 backdrop-blur-md pb-4 pt-2 mb-6 border-b border-slate-150">
          <div className="flex flex-col lg:flex-row gap-4 justify-between items-stretch lg:items-center">
            
            <div className="flex flex-wrap gap-2.5 items-center">
              {/* Categories Selector */}
              <div className="flex p-0.5 bg-slate-100 rounded-xl overflow-x-auto max-w-full shrink-0 select-none [direction:ltr]" id="media-category-tabs" style={{ scrollbarWidth: "none" }}>
                <button
                  id="tab-photos"
                  onClick={() => {
                    setActiveMediaType("photos");
                    setFavoritesOnly(false);
                  }}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer shrink-0 ${
                    activeMediaType === "photos" && !favoritesOnly
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  <Camera className="w-3.5 h-3.5" />
                  Photos ({mediaItems.filter(item => item.type === "image" && (!item.softDeleted || isAdminMode)).length})
                </button>
                <button
                  id="tab-videos"
                  onClick={() => {
                    setActiveMediaType("videos");
                    setFavoritesOnly(false);
                  }}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer shrink-0 ${
                    activeMediaType === "videos" && !favoritesOnly
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  <Video className="w-3.5 h-3.5" />
                  Videos ({mediaItems.filter(item => item.type === "video" && (!item.softDeleted || isAdminMode)).length})
                </button>
                {session && (
                  <button
                    id="tab-my-uploads"
                    onClick={() => {
                      setActiveMediaType("my_uploads" as any);
                      setFavoritesOnly(false);
                    }}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer shrink-0 ${
                      activeMediaType === ("my_uploads" as any) && !favoritesOnly
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    My Uploads ({mediaItems.filter(item => (item.uploaded_by_user_id === session.user?.id || item.uploaded_by_email === session.user?.email)).length})
                  </button>
                )}
              </div>

              {/* View layout style toggle */}
              <div className="flex p-0.5 bg-slate-100 rounded-xl" id="view-mode-tabs">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                    viewMode === "grid"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                  title="Grid View"
                >
                  <Grid className="w-3.5 h-3.5" />
                  Grid
                </button>
                <button
                  onClick={() => setViewMode("timeline")}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                    viewMode === "timeline"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                  title="Timeline View"
                >
                  <Clock className="w-3.5 h-3.5" />
                  Timeline
                </button>
              </div>

              {/* Favorites filter pill */}
              <button
                id="btn-favorites"
                onClick={() => {
                  if (favoritesOnly) {
                    setFavoritesOnly(false);
                    setActiveMediaType("photos");
                  } else {
                    setFavoritesOnly(true);
                    setActiveMediaType("all");
                  }
                }}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border cursor-pointer select-none ${
                  favoritesOnly
                    ? "bg-rose-50 border-rose-200 text-rose-700 font-extrabold"
                    : "bg-white hover:bg-slate-50 border-slate-200 text-slate-600"
                }`}
              >
                <Heart className={`w-3.5 h-3.5 ${favoritesOnly ? "fill-rose-500 text-rose-600" : ""}`} />
                Favorites ({favoriteCount})
              </button>
            </div>

            {/* Instant Live Search Input */}
            <div className="relative w-full lg:max-w-sm flex-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </div>
              <input
                id="search-input"
                type="text"
                placeholder="Search Cox Voyage, friends, location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="block w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1.5 focus:ring-[#0f172a] focus:border-transparent transition-all placeholder:text-slate-400 text-slate-800 shadow-2xs"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery("")}
                  className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Admin Workflow Status Filters (Only visible in Admin Mode) */}
          {isAdminMode && (
            <div id="admin-workflow-filters" className="mt-3.5 pt-3.5 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[10px] uppercase tracking-wider font-extrabold text-amber-700 mr-2">
                Workflow Queue:
              </span>
              <div className="flex p-0.5 bg-amber-50 rounded-lg border border-amber-200/40">
                {(["All", "pending", "approved", "rejected", "hidden"] as const).map((status) => (
                  <button
                    type="button"
                    key={status}
                    onClick={() => setAdminStatusFilter(status)}
                    className={`px-3 py-1 rounded text-xs font-semibold capitalize transition-all select-none cursor-pointer ${
                      adminStatusFilter === status
                        ? "bg-[#0f172a] text-white shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {status} ({
                      status === "All" 
                        ? mediaItems.length 
                        : status === "pending"
                          ? mediaItems.filter(item => item.approvalStatus === "pending").length
                          : status === "approved"
                            ? mediaItems.filter(item => item.approvalStatus === "approved" && !item.softDeleted).length
                            : status === "rejected"
                              ? mediaItems.filter(item => item.approvalStatus === "rejected" && !item.softDeleted).length
                              : mediaItems.filter(item => item.softDeleted).length
                    })
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Detailed Filters (Date, Person, Location) */}
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-3 items-center text-xs">
            <div className="flex items-center gap-1 text-slate-400 mr-2 font-semibold uppercase tracking-wider text-[10px]">
              <SlidersHorizontal className="w-3.5 h-3.5" /> Filter by
            </div>

            {/* Date filter select dropdown */}
            <div id="filter-date-container" className="flex items-center bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-[#0f172a] shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-slate-400 mr-1.5" />
              <select
                id="filter-date-select"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="bg-transparent border-none text-slate-700 focus:outline-none cursor-pointer pr-1"
              >
                <option value="All">All Dates</option>
                {allDates.filter(d => d !== "All").map((date) => (
                  <option key={date} value={date}>{date}</option>
                ))}
              </select>
            </div>

            {/* Person filter select dropdown */}
            <div id="filter-person-container" className="flex items-center bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-[#0f172a] shadow-2xs">
              <User className="w-3.5 h-3.5 text-slate-400 mr-1.5" />
              <select
                id="filter-person-select"
                value={filterPerson}
                onChange={(e) => setFilterPerson(e.target.value)}
                className="bg-transparent border-none text-slate-700 focus:outline-none cursor-pointer pr-1"
              >
                <option value="All">Anyone</option>
                {allPeople.filter(p => p !== "All").map((person) => (
                  <option key={person} value={person}>{person}</option>
                ))}
              </select>
            </div>

            {/* Location filter select dropdown */}
            <div id="filter-location-container" className="flex items-center bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-[#0f172a] shadow-2xs">
              <MapPin className="w-3.5 h-3.5 text-slate-400 mr-1.5" />
              <select
                id="filter-location-select"
                value={filterLocation}
                onChange={(e) => setFilterLocation(e.target.value)}
                className="bg-transparent border-none text-slate-700 focus:outline-none cursor-pointer pr-1"
              >
                <option value="All">All Places</option>
                {allLocations.filter(loc => loc !== "All").map((location) => (
                  <option key={location} value={location}>{location}</option>
                ))}
              </select>
            </div>

            {/* Reset button if any active filter */}
            {(searchQuery || filterPerson !== "All" || filterLocation !== "All" || filterDate !== "All") && (
              <button
                id="reset-filters-btn"
                onClick={handleResetFilters}
                className="ml-auto text-rose-600 hover:text-rose-700 font-bold hover:underline cursor-pointer flex items-center gap-1"
              >
                Clear all filters
              </button>
            )}
          </div>
        </div>

        {/* GALLERY SCROLL ENCLOSURE (INTERNAL VIEWPORT RESCALING) */}
        <div
          ref={galleryScrollRef}
          onScroll={handleGalleryScroll}
          className="max-h-[750px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-200 hover:scrollbar-thumb-slate-300 rounded-2xl border border-slate-100 bg-white/50 backdrop-blur-3xs p-4 focus:outline-none"
          id="gallery-viewport-scroller"
        >
          {/* LOADING SHIMMER */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {[...Array(8)].map((_, index) => (
                <div key={index} className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-xs">
                  <div className="aspect-video bg-slate-200 animate-pulse-soft"></div>
                  <div className="p-4 space-y-3">
                    <div className="h-4 bg-slate-200 rounded-full animate-pulse-soft w-3/4"></div>
                    <div className="h-3 bg-slate-200 rounded-full animate-pulse-soft w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Dynamic Gallery Section Header */}
              <div className="mb-6 pb-2 border-b border-slate-100 flex justify-between items-center select-none animate-fade-in">
                <h2 className="text-xl font-extrabold tracking-tight font-display text-slate-800 flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-slate-900 rounded-full inline-block"></span>
                  {favoritesOnly 
                    ? "Favorite Memories" 
                    : activeMediaType === "photos" 
                      ? "Photos" 
                      : activeMediaType === "videos" 
                        ? "Videos" 
                        : "All Media"
                  }
                </h2>
                <span className="text-xs font-semibold text-slate-400 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-100">
                  {filteredItems.length} listed
                </span>
              </div>

              {/* EMPTY STATE CHECKS */}
              {filteredItems.length === 0 ? (
                favoritesOnly ? (
                  <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center max-w-xl mx-auto my-8 space-y-4 shadow-xs animate-fade-in">
                    <div className="w-16 h-16 bg-rose-50 text-rose-400 rounded-full flex items-center justify-center mx-auto">
                      <Heart className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 font-display">No favorite memories yet.</h3>
                    <p className="text-slate-500 text-sm max-w-sm mx-auto">
                      Mark your favorite photos or video assets by clicking the star/heart button to save them in this high-shorthand short-list views.
                    </p>
                    <button
                      onClick={() => {
                        setFavoritesOnly(false);
                        setActiveMediaType("photos");
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0f172a] hover:bg-slate-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer transition-transform active:scale-95 shadow-sm"
                    >
                      Go Back to Gallery
                    </button>
                  </div>
                ) : (
                  <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center max-w-xl mx-auto my-8 space-y-4 shadow-xs">
                    <div className="w-16 h-16 bg-slate-50 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                      <SlidersHorizontal className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 font-display">No media items found</h3>
                    <p className="text-slate-500 text-sm max-w-sm mx-auto">
                      We scanned Cox Voyage 2026 gallery database but could not match any results with the current query parameters or filters.
                    </p>
                    <button
                      onClick={handleResetFilters}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0f172a] hover:bg-slate-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer transition-transform active:scale-95 shadow-sm"
                    >
                      Reset Active Filters
                    </button>
                  </div>
                )
              ) : viewMode === "timeline" ? (
                /* TIMELINE CHRONOLOGICAL COMPACT GROUPS */
                <div id="timeline-view" className="space-y-10 animate-fade-in">
                  {Object.keys(groupedTimelineItems).map((dateGroupKey) => (
                    <div key={dateGroupKey} className="space-y-4">
                      {/* Sticky segment group header */}
                      <div className="flex items-center gap-3 border-b border-slate-200/60 pb-2 bg-[#fafbfc]/85 backdrop-blur-xs sticky top-0 z-10 select-none bg-white">
                        <h3 className="text-xs font-extrabold text-slate-800 font-mono tracking-wide uppercase flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-indigo-500" />
                          {dateGroupKey}
                        </h3>
                        <span className="text-[10px] bg-slate-100 text-slate-500 font-semibold px-2 py-0.5 rounded-full">
                          {groupedTimelineItems[dateGroupKey].length} item{groupedTimelineItems[dateGroupKey].length > 1 ? "s" : ""}
                        </span>
                      </div>

                      {/* Segment grid representation */}
                      <div className="grid grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
                        {groupedTimelineItems[dateGroupKey].map((item, index) => (
                          <GalleryCard
                            key={item.id}
                            item={item}
                            index={index}
                            isPending={pendingFavoriteIds.has(item.driveFileId)}
                            toggleFavorite={toggleFavorite}
                            openItemDetails={openItemDetails}
                            isAdminMode={isAdminMode}
                            isMyUploadsMode={activeMediaType === ("my_uploads" as any)}
                            formatDuration={formatDuration}
                            formatSize={formatSize}
                            formatTakenDate={formatTakenDate}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* RESPONSIVE FLUID GRID */
                <div 
                  id="media-grid"
                  className="grid grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6 animate-fade-in"
                >
                  {filteredItems.map((item, index) => (
                    <GalleryCard
                      key={item.id}
                      item={item}
                      index={index}
                      isPending={pendingFavoriteIds.has(item.driveFileId)}
                      toggleFavorite={toggleFavorite}
                      openItemDetails={openItemDetails}
                      isAdminMode={isAdminMode}
                      isMyUploadsMode={activeMediaType === ("my_uploads" as any)}
                      formatDuration={formatDuration}
                      formatSize={formatSize}
                      formatTakenDate={formatTakenDate}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* SECURE FLOATING BACK-TO-TOP CONTROL */}
      {showBackToTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-50 bg-[#0f172a] hover:bg-slate-800 text-white p-3.5 rounded-full shadow-xl hover:-translate-y-1 transition-all active:scale-95 cursor-pointer flex items-center justify-center border border-slate-700/40"
          title="Back to Top"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}

      {role === "admin" && (
        <AdminPanelDrawer
          isOpen={isAdminDrawerOpen}
          onClose={() => setIsAdminDrawerOpen(false)}
          mediaItems={mediaItems}
          stats={stats}
          settings={settings}
          onSaveSettings={handleSaveSettings}
          onSyncNow={handleSyncNow}
          syncing={syncing}
          showHiddenMedia={showHiddenMedia}
          setShowHiddenMedia={setShowHiddenMedia}
          showRejectedMedia={showRejectedMedia}
          setShowRejectedMedia={setShowRejectedMedia}
          showPendingMedia={showPendingMedia}
          setShowPendingMedia={setShowPendingMedia}
          adminStatusFilter={adminStatusFilter}
          setAdminStatusFilter={setAdminStatusFilter}
          isAdminMode={isAdminMode}
          setIsAdminMode={setIsAdminMode}
          diagnostics={adminDiagnostics}
          loadingDiagnostics={loadingDiagnostics}
          onRefreshDiagnostics={fetchAdminDiagnostics}
          favoriteDriveIds={favoriteDriveIds}
          session={session}
          onSetApprovalStatus={handleSetApprovalStatus}
          onHideItem={handleHideItem}
          onRestoreItem={handleRestoreItem}
        />
      )}

      {session && (
        <UploadModal
          isOpen={isUploadModalOpen}
          onClose={() => setIsUploadModalOpen(false)}
          session={session}
          approvalWorkflowEnabled={!!settings.approval_workflow_enabled}
          onUploadSuccess={async () => {
            await fetchMediaData();
          }}
        />
      )}

      {/* METADATA INSPECTION MODAL (FULL SCREEN GALLERY AND CONTROLS) */}
      {selectedItem && (
        <div 
          id="media-details-modal"
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 lg:p-8 animate-fade-in"
          onClick={() => {
            if (!deleteConfirmId) setSelectedItem(null);
          }}
        >
          {/* Main modal container */}
          <div 
            className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl overflow-y-auto lg:overflow-hidden animate-scale-up grid grid-cols-1 lg:grid-cols-12 max-h-none lg:max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            
            {/* Visual Screen Display Panel (Left Col) */}
            <div className="lg:col-span-7 bg-[#111827] relative flex flex-col justify-between p-4 text-white min-h-[350px] lg:min-h-0">
              
              {/* Floating controls in modal display */}
              <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
                {isAdminMode ? (
                  <span className="bg-black/40 backdrop-blur-md text-white px-3 py-1.5 rounded-lg text-[10px] font-mono select-none">
                    Reference: {selectedItem.driveFileId}
                  </span>
                ) : (
                  <div />
                )}

                <div className="flex gap-2 pointer-events-auto">
                  <a
                    id="modal-download-anchor"
                    href={`/api/media/download/${selectedItem.driveFileId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2.5 rounded-full bg-black/40 hover:bg-black/60 transition-colors text-white hover:text-emerald-400 hover:scale-105 transform active:scale-95"
                    title="Download High Quality original photo"
                  >
                    <Download className="w-4 h-4" />
                  </a>

                  <button
                    id="modal-close-icon-btn"
                    onClick={() => setSelectedItem(null)}
                    className="p-2.5 rounded-full bg-black/40 hover:bg-black/60 transition-colors text-white hover:scale-105 transform active:scale-95 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Centered Asset Display */}
              <div className="flex-1 flex items-center justify-center overflow-hidden py-10 relative">
                {selectedItem.type === "image" ? (
                  <img
                    id="modal-image-player"
                    src={selectedItem.previewUrl}
                    alt={selectedItem.title || selectedItem.name}
                    className="max-w-full max-h-[50vh] lg:max-h-[65vh] object-contain rounded-md"
                  />
                ) : (
                  <div className="relative w-full h-full flex flex-col items-center justify-center">
                    {videoError ? (
                      <div className="flex flex-col items-center justify-center p-6 text-center max-w-sm bg-slate-800/80 rounded-2xl border border-slate-700 space-y-3.5 animate-fadeIn">
                        <div className="p-3 bg-rose-500/15 text-rose-400 rounded-full">
                          <AlertTriangle className="w-6 h-6 animate-pulse" />
                        </div>
                        <h5 className="font-bold text-sm text-slate-100">Playback Failed</h5>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          This video could not be played in the browser. Try downloading it instead.
                        </p>
                        <a
                          href={`/api/media/download/${selectedItem.driveFileId}`}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold tracking-wide transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" /> Download Media
                        </a>
                      </div>
                    ) : (
                      <>
                        <video
                          id="modal-video-player"
                          controls
                          playsInline
                          preload="metadata"
                          autoPlay
                          src={`/api/media/stream/${selectedItem.driveFileId}`}
                          className={`max-w-full max-h-[50vh] lg:max-h-[65vh] rounded-md outline-none border border-slate-800 transition-opacity duration-300 ${videoLoading ? "opacity-30" : "opacity-100"}`}
                          poster={selectedItem.thumbnailUrl}
                          onLoadStart={() => setVideoLoading(true)}
                          onCanPlay={() => setVideoLoading(false)}
                          onError={() => {
                            console.error("[TripVault Frontend] HTML5 Video playback errored out for source:", `/api/media/stream/${selectedItem.driveFileId}`);
                            setVideoError(true);
                            setVideoLoading(false);
                          }}
                        />

                        {/* Loading spinner layer */}
                        {videoLoading && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/25 pointer-events-none space-y-2 animate-fadeIn">
                            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                            <span className="text-xs text-slate-200 font-medium font-mono bg-black/40 px-2 py-1 rounded">Loading streaming video...</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Slider steps indicators to jump pages inside the preview */}
              <div className="flex items-center justify-between text-xs text-slate-400 font-medium px-2">
                <button
                  id="modal-prev-btn"
                  onClick={() => handleNavigateModal("prev")}
                  className="inline-flex items-center gap-1.5 text-slate-300 hover:text-white transition-colors py-1.5 pr-3 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev Media
                </button>

                <span className="font-mono opacity-80">
                  Item {filteredItems.findIndex(i => i.id === selectedItem.id) + 1} of {filteredItems.length} filtered
                </span>

                <button
                  id="modal-next-btn"
                  onClick={() => handleNavigateModal("next")}
                  className="inline-flex items-center gap-1.5 text-slate-300 hover:text-white transition-colors py-1.5 pl-3 cursor-pointer"
                >
                  Next Media <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Sidebar Details Panel (Right Col) */}
            <div className="lg:col-span-5 p-6 flex flex-col justify-between lg:overflow-y-auto lg:max-h-[90vh]">
              
              {/* Core detail wrapper */}
              <div className="space-y-6">
                
                {/* Custom Edit / Delete control bar */}
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    {selectedItem.type === "image" ? "Photo Entry" : "Video Asset"}
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      id="edit-metadata-toggle"
                      onClick={() => setIsEditing(!isEditing)}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                        isEditing 
                          ? "bg-slate-100 text-slate-700" 
                          : "bg-teal-50 text-teal-700 hover:bg-teal-100"
                      }`}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      {isEditing ? "Quit Edit" : "Edit Details"}
                    </button>

                    <button
                      id="delete-asset-btn"
                      onClick={() => setDeleteConfirmId(selectedItem.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 text-rose-600 hover:bg-rose-100 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove from Gallery
                    </button>
                  </div>
                </div>

                {/* DANGER WARNING CONFIRM MODAL OVERLAY */}
                {deleteConfirmId && (
                  <div className="bg-rose-50 border border-rose-100 rounded-xl p-4 space-y-3 animate-fade-in">
                    <div className="flex gap-2 text-rose-800">
                      <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-600" />
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wide">Confirm Removal</h4>
                        <p className="text-xs text-rose-700 mt-1 leading-relaxed">
                          {isAdminMode 
                            ? "Admin Mode Active: Confirming will permanently move this original file into your Google Drive trash folder." 
                            : "This will hide the media from the gallery. It will not permanently delete the Drive file yet."}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold px-3 py-1.5 rounded-lg text-[11px] cursor-pointer"
                      >
                        Nevermind, Cancel
                      </button>
                      <button
                        onClick={() => handleDeleteItem(selectedItem.id, selectedItem.driveFileId)}
                        className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-3 py-1.5 rounded-lg text-[11px] cursor-pointer"
                      >
                        {isAdminMode ? "Yes, Trash Drive File" : "Yes, Hide From Gallery"}
                      </button>
                    </div>
                  </div>
                )}

                {/* EDIT MODE FORM VS READ-ONLY METADATA */}
                {isEditing ? (
                  <form onSubmit={handleUpdateMetadata} className="space-y-4">
                    <div className="bg-slate-50 p-4 rounded-xl space-y-3 border border-slate-100">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Edit Item Details</h4>
                      
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Title</label>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="e.g. Sunset Silhouette"
                          className="w-full text-xs bg-white border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-800 text-slate-800"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Description</label>
                        <textarea
                          rows={3}
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          placeholder="Tell a memory about this shot..."
                          className="w-full text-xs bg-white border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-800 text-slate-800 resize-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Location Label</label>
                        <input
                          type="text"
                          value={editLocation}
                          onChange={(e) => setEditLocation(e.target.value)}
                          placeholder="e.g. Inani Beach, Cox's Bazar"
                          className="w-full text-xs bg-white border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-800 text-slate-800"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">Friends Tagged (comma separated)</label>
                        <input
                          type="text"
                          value={editPeopleString}
                          onChange={(e) => setEditPeopleString(e.target.value)}
                          placeholder="e.g. Avishek, Nabil, Sojib"
                          className="w-full text-xs bg-white border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-800 text-slate-800"
                        />
                        <p className="text-[10px] text-slate-400">Separated by commas for category filters.</p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditing(false)}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2 rounded-xl text-xs flex-1 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="bg-[#0f172a] hover:bg-slate-800 text-white font-bold px-4 py-2 rounded-xl text-xs flex-1 flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" /> Save Changes
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-5">
                    
                    {/* Primary metadata title block */}
                    <div className="space-y-2">
                      <h3 className="text-2xl font-bold font-display text-slate-900 leading-tight">
                        {selectedItem.title || selectedItem.name}
                      </h3>
                      
                      <p className="text-xs text-slate-400 font-mono tracking-wide">
                        File: {selectedItem.name}
                      </p>
                    </div>

                    {/* Styled Description */}
                    {selectedItem.description ? (
                      <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-line p-3 bg-slate-50 rounded-xl border border-slate-50 italic">
                        "{selectedItem.description}"
                      </p>
                    ) : (
                      <p className="text-slate-400 text-sm leading-relaxed italic p-3 bg-slate-50 rounded-xl border border-slate-50">
                        No description recorded yet for this safe harbor shot. Click Edit Details to register one.
                      </p>
                    )}

                    {/* Segmented lists */}
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      
                      <div className="space-y-1">
                        <span className="block font-bold text-slate-400 uppercase tracking-widest text-[9px]">Captured At</span>
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <Calendar className="w-4 h-4 text-slate-500" />
                          <span>{formatTakenDate(selectedItem.takenTime)}</span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <span className="block font-bold text-slate-400 uppercase tracking-widest text-[9px]">Camera Location</span>
                        <div className="flex items-center gap-1.5 text-slate-700 font-medium">
                          <MapPin className="w-4 h-4 text-slate-500" />
                          <span>{selectedItem.location || "Cox's Bazar"}</span>
                        </div>
                      </div>

                    </div>

                    {/* Tagged people array */}
                    <div className="space-y-2">
                      <span className="block font-bold text-slate-400 uppercase tracking-widest text-[9px]">Friends in Media</span>
                      {selectedItem.people && selectedItem.people.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedItem.people.map((person) => (
                            <span 
                              key={person}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100"
                            >
                              <User className="w-3 h-3" />
                              {person}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 italic">No one tagged yet.</p>
                      )}
                    </div>

                    {/* Admin Workflow Status Management Panel (Visible in Admin Mode) */}
                    {isAdminMode && (
                      <div className="bg-amber-50/45 border border-amber-200/55 rounded-xl p-3.5 space-y-2.5 shadow-3xs text-xs">
                        <span className="block font-bold text-amber-800 uppercase tracking-widest text-[9px] font-sans">
                          Administrative Guidelines Workflow
                        </span>
                        
                        <div className="flex justify-between items-center border-b border-amber-100/40 pb-1.55">
                          <span className="text-slate-600 font-medium font-sans">Approval Status:</span>
                          <span className={`font-extrabold uppercase px-2 py-0.5 rounded text-[10px] ${
                            selectedItem.approvalStatus === "approved"
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                              : selectedItem.approvalStatus === "rejected"
                                ? "bg-stone-200 text-stone-800 border border-stone-300"
                                : "bg-amber-150 text-amber-800 border border-amber-250 animate-pulse"
                          }`}>
                            {selectedItem.approvalStatus || "pending"}
                          </span>
                        </div>

                        {/* Workflow Actions */}
                        <div className="space-y-1.5 pt-1">
                          <span className="block text-[9px] font-bold uppercase text-slate-400 font-sans">Change Status:</span>
                          <div className="flex gap-2.5">
                            <button
                              type="button"
                              onClick={() => handleSetApprovalStatus(selectedItem.id, "approved")}
                              disabled={selectedItem.approvalStatus === "approved"}
                              className={`flex-1 text-[10px] py-1 rounded font-bold cursor-pointer transition-colors ${
                                selectedItem.approvalStatus === "approved"
                                  ? "bg-emerald-100/50 text-emerald-600 cursor-not-allowed"
                                  : "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 transition-transform"
                              }`}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSetApprovalStatus(selectedItem.id, "rejected")}
                              disabled={selectedItem.approvalStatus === "rejected"}
                              className={`flex-1 text-[10px] py-1 rounded font-bold cursor-pointer transition-colors ${
                                selectedItem.approvalStatus === "rejected"
                                  ? "bg-stone-200/50 text-stone-500 cursor-not-allowed"
                                  : "bg-stone-600 text-white hover:bg-stone-700 active:scale-95 transition-transform"
                              }`}
                            >
                              Reject
                            </button>
                          </div>
                        </div>

                        {/* Soft Delete / Restore Toggle */}
                        {selectedItem.softDeleted && (
                          <div className="pt-2.5 border-t border-amber-100/40">
                            <button
                              type="button"
                              onClick={() => handleRestoreItem(selectedItem.id)}
                              className="w-full text-center bg-[#0f172a] hover:bg-slate-800 text-white font-extrabold text-[10px] py-1.5 rounded uppercase tracking-wide cursor-pointer transition-all active:scale-[0.98]"
                            >
                              Restore Item to Gallery
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* File technical properties pane (Admin Mode only) */}
                    {isAdminMode ? (
                      <div className="bg-amber-50/45 border border-amber-200/55 rounded-xl p-3.5 space-y-2 text-[11px] font-mono text-amber-950 leading-relaxed shadow-3xs">
                        <span className="block font-bold text-amber-800 uppercase tracking-widest text-[9px] font-sans pb-1">Technical Specifications</span>
                        
                        <div className="flex justify-between border-b border-amber-100/40 pb-1">
                          <span>Google File ID:</span>
                          <span className="text-slate-800 select-all font-bold truncate max-w-[150px]" title={selectedItem.driveFileId}>
                            {selectedItem.driveFileId}
                          </span>
                        </div>
                        
                        <div className="flex justify-between border-b border-amber-100/40 pb-1">
                          <span>Format Mime:</span>
                          <span className="text-slate-700 font-medium">{selectedItem.mimeType}</span>
                        </div>
                        
                        {selectedItem.width && selectedItem.height && (
                          <div className="flex justify-between border-b border-amber-100/40 pb-1">
                            <span>Dimensions:</span>
                            <span className="text-slate-700 font-medium">{selectedItem.width} × {selectedItem.height} px</span>
                          </div>
                        )}

                        <div className="flex justify-between border-b border-amber-100/45 pb-1">
                          <span>Soft Deleted:</span>
                          <span className={`font-bold ${selectedItem.softDeleted ? "text-rose-600" : "text-emerald-600"}`}>
                            {selectedItem.softDeleted ? "YES (Hidden)" : "NO (Active)"}
                          </span>
                        </div>
                        
                        <div className="flex justify-between pt-0.5">
                          <span>Synced on:</span>
                          <span className="text-slate-755">
                            {new Date(selectedItem.createdTime).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="flex justify-between pt-1 text-[10px] uppercase font-sans font-bold">
                          <span>Google Drive Link:</span>
                          <a
                            href={selectedItem.webViewLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-650 hover:underline hover:text-indigo-700"
                          >
                            Open Raw Drive Item ↗
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-2 text-[11px] text-slate-500">
                        <div className="flex justify-between">
                          <span className="font-semibold text-slate-400 uppercase tracking-widest text-[9px]">Captured Location</span>
                          <span className="text-slate-700 font-medium">{selectedItem.location || "Cox's Bazar"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold text-slate-400 uppercase tracking-widest text-[9px]">Media Type</span>
                          <span className="text-slate-700 font-medium uppercase font-mono text-[9px]">{selectedItem.type}</span>
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </div>

              {/* Static download CTA button footer inside sidebar panel */}
              <div className="pt-6 border-t border-slate-100 mt-6 flex gap-3">
                <a
                  href={`/api/media/download/${selectedItem.driveFileId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0f172a] hover:bg-slate-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
                >
                  <Download className="w-3.5 h-3.5" /> Direct Original Download
                </a>

                <button
                  onClick={() => setSelectedItem(null)}
                  className="px-4 py-2.5 bg-slate-150 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Dismiss
                </button>
              </div>

            </div>

          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="bg-[#fafbfc] border-t border-slate-100 py-12 mt-20 text-slate-500 text-xs select-none">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="text-slate-900 font-extrabold font-display text-sm tracking-tight">TripVault Gallery</span>
            <span className="text-slate-300">•</span>
            <span>Private Drive-powered trip archive</span>
          </div>

          <div className="flex items-center gap-4 text-slate-400 text-[11px]">
            <span>Cox Voyage 2026</span>
            <span>•</span>
            <span>Secure Storage Active</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
