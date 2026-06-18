import express from "express";
import path from "path";
import dotenv from "dotenv";
import multer from "multer";
import { Readable } from "stream";
import { google } from "googleapis";
import { createServer as createViteServer } from "vite";
import { INITIAL_MOCK_MEDIA } from "./src/mockData";
import { MediaItem } from "./src/types";
import { getSupabase, markSupabaseTablesMissing, isSupabaseDisabled, getAuthSupabase } from "./server/supabaseClient";

// Load environment variables from .env file
dotenv.config();

// Initialize custom overrides store to persist user metadata edits even after a Google Drive sync
interface MetadataEdit {
  title?: string;
  description?: string;
  people?: string[];
  location?: string;
  softDeleted?: boolean;
}

// Maps driveFileId -> user custom modifications
const metadataOverrides: Record<string, MetadataEdit> = {};

// Configure Multer for processing file binary streams
const uploadStorage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 250 * 1024 * 1024 // 250MB limit for high-res videos
  },
  fileFilter: (req: any, file: any, cb: any) => {
    // Basic catch-all filter; fine-grained validation occurs at individual route level
    if (file.mimetype && (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/"))) {
      cb(null, true);
    } else {
      cb(new Error("Only photos and videos are allowed."));
    }
  }
});

// Memory fallback for settings
const defaultSettings = {
  trip_title: "Cox Voyage 2026",
  gallery_visibility: "private",
  allow_downloads: true,
  require_approval: false,
  approval_workflow_enabled: false,
  allow_public_downloads: true,
  allow_guest_favorites: true
};
let localSettings = { ...defaultSettings };

// Dynamic state store of media items in the backend
let serverMediaStore: MediaItem[] = [...INITIAL_MOCK_MEDIA];
let lastSyncedTime: string = new Date().toISOString();

// Helper to retrieve and verify Supabase Auth user from request JWT token
async function getUserFromRequest(req: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.split(" ")[1];
  if (!token) return null;

  const supabase = getAuthSupabase();
  if (!supabase) return null;

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return null;
    }
    return user;
  } catch (err) {
    return null;
  }
}

// Helper to determine if user has admin privileges
function isAdminUser(user: any) {
  if (!user || !user.email) return false;
  return user.email.trim().toLowerCase() === "avishekmajumderpciu@gmail.com";
}


// Helper to merge GDrive list items with Supabase metadata rows or metadata overrides
function mergeAndFilterMedia(
  syncedItems: MediaItem[],
  dbRecords: any[] | null,
  includeHidden: boolean,
  includeUnapproved: boolean,
  user?: any
) {
  const dbMap = new Map();
  if (dbRecords) {
    dbRecords.forEach((row: any) => {
      dbMap.set(row.drive_file_id, row);
    });
  }

  let list = syncedItems.map((item) => {
    const row = dbMap.get(item.driveFileId);
    if (row) {
      return {
        ...item,
        title: row.title !== null && row.title !== undefined ? row.title : (item.title || item.name),
        description: row.description || "",
        people: row.people || [],
        location: row.location_label || "",
        isFavorite: row.is_favorite || false,
        softDeleted: row.is_hidden || false,
        approvalStatus: row.approval_status || "approved",
        adminNotes: row.admin_notes || "",
        uploaded_by_user_id: row.uploaded_by_user_id || "",
        uploaded_by_email: row.uploaded_by_email || "",
        original_filename: row.original_filename || "",
        file_size: row.file_size ? Number(row.file_size) : undefined,
        upload_source: row.upload_source || "sync"
      };
    } else {
      const overrides: any = metadataOverrides[item.driveFileId] || {};
      return {
        ...item,
        title: overrides.title || item.title || item.name,
        description: overrides.description || "",
        people: overrides.people || [],
        location: overrides.location || "",
        softDeleted: overrides.softDeleted !== undefined ? overrides.softDeleted : (item.softDeleted || false),
        isFavorite: overrides.isFavorite || false,
        approvalStatus: overrides.approvalStatus || "approved",
        adminNotes: overrides.adminNotes || "",
        uploaded_by_user_id: overrides.uploaded_by_user_id || "",
        uploaded_by_email: overrides.uploaded_by_email || "",
        original_filename: overrides.original_filename || "",
        file_size: overrides.file_size || undefined,
        upload_source: overrides.upload_source || "sync"
      };
    }
  });

  if (!includeHidden) {
    list = list.filter(item => !item.softDeleted);
  }
  if (!includeUnapproved) {
    list = list.filter(item => item.approvalStatus === "approved" || (user && item.uploaded_by_user_id === user.id));
  }

  return list;
}

// Helper to merge GDrive list items with Supabase metadata rows
async function getMergedMediaItems(includeHidden: boolean, includeUnapproved: boolean, user?: any) {
  const supabase = getSupabase();
  let dbRecords: any[] | null = null;
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("media_metadata")
        .select("*");
      if (!error && data) {
        dbRecords = data;
      }
    } catch (err) {
      console.error("[Supabase merge exception] Falling back to memory overrides:", err);
    }
  }
  return mergeAndFilterMedia([...serverMediaStore], dbRecords, includeHidden, includeUnapproved, user);
}


// Preseed overrides with our gorgeous mock descriptions so that the initial demo has fantastic metadata
INITIAL_MOCK_MEDIA.forEach((item) => {
  metadataOverrides[item.driveFileId] = {
    title: item.title,
    description: item.description,
    people: item.people,
    location: item.location
  };
});

// Read environment config securely
const googleEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
const googleKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || "";

/**
 * Creates authenticated Google Drive SDK Client using service credentials
 */
function getDriveClient() {
  if (!googleEmail) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL configuration.");
  }
  if (!googleKey) {
    throw new Error("Missing GOOGLE_PRIVATE_KEY configuration.");
  }
  
  if (!googleEmail.includes("@") || !googleEmail.endsWith(".gserviceaccount.com")) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL format is invalid. Must end with '.gserviceaccount.com'.");
  }

  if (!googleKey.includes("-----BEGIN PRIVATE KEY-----") || !googleKey.includes("-----END PRIVATE KEY-----")) {
    throw new Error("GOOGLE_PRIVATE_KEY format is invalid. Ensure BEGIN and END banners are intact.");
  }

  const auth = new google.auth.JWT({
    email: googleEmail,
    key: googleKey,
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive"
    ]
  });
  
  return google.drive({ version: "v3", auth });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Logging requests
  app.use((req, res, next) => {
    console.log(`[TripVault API] ${req.method} ${req.url}`);
    next();
  });

  // --- API ROUTE 1: GET /api/media ---
  // Return all items from server storage supporting Supabase metadata synchronization
  app.get("/api/media", async (req, res) => {
    const user = await getUserFromRequest(req);
    const isAdmin = isAdminUser(user);
    // Admins always retrieve the complete library to compute counters and filter in the UI
    const includeHidden = isAdmin || req.query.includeHidden === "true";
    const includeUnapproved = isAdmin || req.query.includeUnapproved === "true";


    try {
      const mergedList = await getMergedMediaItems(includeHidden, includeUnapproved, user);
      res.json({
        success: true,
        media: mergedList,
        syncStats: {
          totalPhotosCount: mergedList.filter((item) => item.type === "image").length,
          totalVideosCount: mergedList.filter((item) => item.type === "video").length,
          lastSyncedTime,
        }
      });
    } catch (err: any) {
      console.error("[GET /api/media failed] Falling back to default list:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- API ROUTE 2: GET /api/drive/sync ---
  // Performs the real Google Drive listings list operation, separating photos and videos automatically!
  // If keys are not provided, gracefully falls back to mock synchronization, reporting the status.
  app.get("/api/drive/sync", async (req, res) => {
    const isMockMode = 
      !folderId || folderId === "YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE" ||
      !googleEmail || googleEmail.startsWith("your-service-account") ||
      !googleKey || googleKey.includes("YOUR_PRIVATE_KEY_HERE");

    const includeHidden = req.query.includeHidden === "true";
    const includeUnapproved = includeHidden;

    // Step 9: Make sure active settings are loaded or app_settings row is auto-created
    let activeSettings = { ...localSettings };
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { data: dbSettings } = await supabase
          .from("app_settings")
          .select("*")
          .eq("id", "default")
          .single();
        if (dbSettings) {
          activeSettings = { ...activeSettings, ...dbSettings };
        } else {
          const { data: seeded } = await supabase
            .from("app_settings")
            .insert([{ id: "default", ...defaultSettings }])
            .select()
            .single();
          if (seeded) {
            activeSettings = { ...activeSettings, ...seeded };
          }
        }
      } catch (err) {
        console.error("Failed to load / seed app settings during sync:", err);
      }
    }

    if (isMockMode) {
      console.log("[TripVault API] Real credentials not set. Running simulated synchronization scan.");
      lastSyncedTime = new Date().toISOString();
      
      const driveFilesFound = INITIAL_MOCK_MEDIA.length;
      const mediaFilesFound = INITIAL_MOCK_MEDIA.length;

      let dbRecords: any[] | null = null;
      let supabaseRowsFound = 0;

      if (supabase) {
        try {
          const { data: existingRows } = await supabase
            .from("media_metadata")
            .select("*")
            .in("drive_file_id", INITIAL_MOCK_MEDIA.map(item => item.driveFileId));

          const dbMap = new Map<string, any>(existingRows?.map((r: any) => [r.drive_file_id, r]) || []);

          const upsertRows = INITIAL_MOCK_MEDIA.map((item) => {
            const existing = dbMap.get(item.driveFileId);
            if (existing) {
              return {
                drive_file_id: item.driveFileId,
                title: existing.title !== null && existing.title !== undefined ? existing.title : item.title,
                description: existing.description || "",
                people: existing.people || [],
                location_label: existing.location_label || "",
                is_favorite: existing.is_favorite || false,
                is_hidden: existing.is_hidden || false,
                approval_status: existing.approval_status || "approved",
                admin_notes: existing.admin_notes || ""
              };
            } else {
              const defaultApproval = (activeSettings.require_approval || activeSettings.approval_workflow_enabled) ? "pending" : "approved";
              return {
                drive_file_id: item.driveFileId,
                title: item.title,
                description: "",
                people: [],
                location_label: "",
                is_favorite: false,
                is_hidden: false,
                approval_status: defaultApproval,
                admin_notes: ""
              };
            }
          });

          const { data: upsertedData, error: upsertErr } = await supabase
            .from("media_metadata")
            .upsert(upsertRows, { onConflict: "drive_file_id" })
            .select();

          if (upsertErr) {
            const isMissing = upsertErr.message?.includes("Could not find") || upsertErr.message?.includes("relation") || upsertErr.code === "PGRST205";
            if (isMissing) {
              markSupabaseTablesMissing();
            } else {
              console.warn("[TripVault DB Warning] Mock database synchronization skipped saving to table (falling back to memory overrides):", upsertErr.message);
            }
          }
          dbRecords = upsertedData || existingRows || null;
          supabaseRowsFound = dbRecords ? dbRecords.length : 0;
        } catch (dbErr: any) {
          console.warn("[TripVault DB Schema] Failed to seed metadata for mock items. Schema might not be fully loaded:", dbErr.message || dbErr);
        }
      }

      // Step E & F: Merge and Filter
      const fullMergedList = mergeAndFilterMedia([...INITIAL_MOCK_MEDIA], dbRecords, true, true);
      
      const hiddenCount = fullMergedList.filter(item => item.softDeleted).length;
      const pendingCount = fullMergedList.filter(item => item.approvalStatus === "pending").length;
      const rejectedCount = fullMergedList.filter(item => item.approvalStatus === "rejected").length;
      const approvedCount = fullMergedList.filter(item => item.approvalStatus === "approved").length;
      const visibleMediaReturned = fullMergedList.filter(item => !item.softDeleted && item.approvalStatus === "approved").length;

      const filteredList = mergeAndFilterMedia([...INITIAL_MOCK_MEDIA], dbRecords, includeHidden, includeUnapproved);

      return res.json({
        success: true,
        mode: "mock",
        message: "Vault synced in Demo Fallback Mode. Configure Secrets to activate real folder integration.",
        media: filteredList,
        driveFilesFound,
        mediaFilesFound,
        supabaseRowsFound,
        visibleMediaReturned,
        hiddenCount,
        pendingCount,
        rejectedCount,
        approvedCount,
        requireApproval: !!(activeSettings.require_approval || activeSettings.approval_workflow_enabled),
        syncStats: {
          totalPhotosCount: filteredList.filter((item) => item.type === "image").length,
          totalVideosCount: filteredList.filter((item) => item.type === "video").length,
          lastSyncedTime,
          driveFilesFound,
          mediaFilesFound,
          supabaseRowsFound,
          visibleMediaReturned,
          hiddenCount,
          pendingCount,
          rejectedCount,
          approvedCount,
          requireApproval: !!(activeSettings.require_approval || activeSettings.approval_workflow_enabled)
        }
      });
    }

    try {
      console.log(`[TripVault API] Querying files inside shared parent folder ID: ${folderId}`);
      const drive = getDriveClient();

      // Step A & B: Fetch all files from folder first to perform true count of files found
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        orderBy: "createdTime desc",
        pageSize: 500,
        fields: "files(id, name, mimeType, size, createdTime, modifiedTime, thumbnailLink, webViewLink, webContentLink, imageMediaMetadata, videoMediaMetadata)"
      });

      const allDriveFiles = response.data.files || [];
      const driveFilesFound = allDriveFiles.length;

      // Step C: Filter only image/* and video/* files
      const driveFiles = allDriveFiles.filter(file => {
        const mime = file.mimeType || "";
        return mime.startsWith("image/") || mime.startsWith("video/");
      });
      const mediaFilesFound = driveFiles.length;

      console.log(`[TripVault API] Google Drive search found ${driveFilesFound} overall files. ${mediaFilesFound} are media items (images/videos).`);

      const syncedItems: MediaItem[] = driveFiles.map((file) => {
        const driveFileId = file.id || "";
        const mimeType = file.mimeType || "";
        const isVideo = mimeType.startsWith("video/");
        const type = isVideo ? "video" : "image";
        
        const baseName = file.name || "Untitled_Media";
        const cleanTitle = baseName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");

        const createdTime = file.createdTime || new Date().toISOString();
        const modifiedTime = file.modifiedTime || createdTime;

        let takenTime = "";
        if (file.imageMediaMetadata?.time) {
          takenTime = file.imageMediaMetadata.time.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
        } else {
          takenTime = createdTime.substring(0, 10) + " " + createdTime.substring(11, 16);
        }

        const width = isVideo ? file.videoMediaMetadata?.width : file.imageMediaMetadata?.width;
        const height = isVideo ? file.videoMediaMetadata?.height : file.imageMediaMetadata?.height;
        const sizeVal = file.size ? parseInt(file.size, 10) : undefined;
        const durationVal = isVideo && file.videoMediaMetadata?.durationMillis
          ? Math.round(parseInt(file.videoMediaMetadata.durationMillis, 10) / 1000)
          : undefined;

        let thumbnailUrl = file.thumbnailLink || "";
        if (!thumbnailUrl) {
          thumbnailUrl = isVideo 
            ? "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=500&q=80"
            : "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=500&q=80";
        }

        const previewUrl = isVideo 
          ? (file.webContentLink || file.webViewLink || "https://assets.mixkit.co/videos/preview/mixkit-waves-breaking-in-the-sunset-1185-large.mp4")
          : (file.thumbnailLink ? file.thumbnailLink.replace(/=s\d+$/, "=s1600") : "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1600&q=80");

        const downloadUrl = file.webContentLink || file.webViewLink || "";

        return {
          id: `gdrive_${driveFileId}`,
          driveFileId,
          name: baseName,
          type,
          mimeType,
          thumbnailUrl,
          previewUrl,
          downloadUrl,
          createdTime,
          modifiedTime,
          takenTime,
          title: cleanTitle,
          description: "",
          people: [],
          location: "",
          width: width || 1920,
          height: height || 1080,
          size: sizeVal,
          duration: durationVal,
          softDeleted: false
        };
      });

      serverMediaStore = syncedItems;
      lastSyncedTime = new Date().toISOString();

      let dbRecords: any[] | null = null;
      let supabaseRowsFound = 0;

      // Step D: Upsert into Supabase preserving user edits
      if (supabase) {
        try {
          const { data: existingRows } = await supabase
            .from("media_metadata")
            .select("*")
            .in("drive_file_id", syncedItems.map(item => item.driveFileId));

          const dbMap = new Map<string, any>(existingRows?.map((r: any) => [r.drive_file_id, r]) || []);

          const upsertRows = syncedItems.map((item) => {
            const existing = dbMap.get(item.driveFileId);
            if (existing) {
              return {
                drive_file_id: item.driveFileId,
                title: existing.title !== null && existing.title !== undefined ? existing.title : item.title,
                description: existing.description || "",
                people: existing.people || [],
                location_label: existing.location_label || "",
                is_favorite: existing.is_favorite || false,
                is_hidden: existing.is_hidden || false,
                approval_status: existing.approval_status || "approved",
                admin_notes: existing.admin_notes || ""
              };
            } else {
              const defaultApproval = (activeSettings.require_approval || activeSettings.approval_workflow_enabled) ? "pending" : "approved";
              return {
                drive_file_id: item.driveFileId,
                title: item.title,
                description: "",
                people: [],
                location_label: "",
                is_favorite: false,
                is_hidden: false,
                approval_status: defaultApproval,
                admin_notes: ""
              };
            }
          });

          const { data: upsertedData, error: upsertErr } = await supabase
            .from("media_metadata")
            .upsert(upsertRows, { onConflict: "drive_file_id" })
            .select();

          if (upsertErr) {
            const isMissing = upsertErr.message?.includes("Could not find") || upsertErr.message?.includes("relation") || upsertErr.code === "PGRST205";
            if (isMissing) {
              markSupabaseTablesMissing();
            } else {
              console.warn("[TripVault DB Warning] Active database synchronization skipped saving to table (falling back to memory overrides):", upsertErr.message);
            }
          }
          dbRecords = upsertedData || existingRows || null;
          supabaseRowsFound = dbRecords ? dbRecords.length : 0;
        } catch (dbErr: any) {
          console.warn("[TripVault DB Schema] Failed to seed synced media files. Schema might not be fully loaded:", dbErr.message || dbErr);
        }
      }

      // Step E & F: Merge and Filter
      const fullMergedList = mergeAndFilterMedia(syncedItems, dbRecords, true, true);
      
      const hiddenCount = fullMergedList.filter(item => item.softDeleted).length;
      const pendingCount = fullMergedList.filter(item => item.approvalStatus === "pending").length;
      const rejectedCount = fullMergedList.filter(item => item.approvalStatus === "rejected").length;
      const approvedCount = fullMergedList.filter(item => item.approvalStatus === "approved").length;
      const visibleMediaReturned = fullMergedList.filter(item => !item.softDeleted && item.approvalStatus === "approved").length;

      const filteredList = mergeAndFilterMedia(syncedItems, dbRecords, includeHidden, includeUnapproved);

      res.json({
        success: true,
        mode: "real",
        message: `Synced successfully! Gathered ${syncedItems.length} photos & videos from drive index.`,
        media: filteredList,
        driveFilesFound,
        mediaFilesFound,
        supabaseRowsFound,
        visibleMediaReturned,
        hiddenCount,
        pendingCount,
        rejectedCount,
        approvedCount,
        requireApproval: !!(activeSettings.require_approval || activeSettings.approval_workflow_enabled),
        syncStats: {
          totalPhotosCount: filteredList.filter((item) => item.type === "image").length,
          totalVideosCount: filteredList.filter((item) => item.type === "video").length,
          lastSyncedTime,
          driveFilesFound,
          mediaFilesFound,
          supabaseRowsFound,
          visibleMediaReturned,
          hiddenCount,
          pendingCount,
          rejectedCount,
          approvedCount,
          requireApproval: !!(activeSettings.require_approval || activeSettings.approval_workflow_enabled)
        }
      });
    } catch (err: any) {
      console.error("[TripVault API] Google Drive integration crashed:", err);
      res.status(500).json({
        success: false,
        error: "Google Drive API returned an authentication or communication failure.",
        details: err.message || err,
        code: err.code || 500,
        possibleFixes: [
          "Verify the GOOGLE_SERVICE_ACCOUNT_EMAIL was shared as a shared viewer in your drive folder.",
          "Check that Google Drive API has been turned on in your GCP API console."
        ]
      });
    }
  });

  // --- API ROUTE 2.1: GET /api/debug/sync-status ---
  // Safely details folder listings and database stats without revealing access keys
  app.get("/api/debug/sync-status", async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!isAdminUser(user)) {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }
    const isDriveConfigured = !!(
      googleEmail && !googleEmail.startsWith("your-service-account") &&
      googleKey && !googleKey.includes("YOUR_PRIVATE_KEY_HERE") &&
      folderId && folderId !== "YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE"
    );

    const supabase = getSupabase();
    const isSupabaseConfigured = !!(
      supabase &&
      process.env.SUPABASE_URL && !process.env.SUPABASE_URL.includes("your-supabase") &&
      process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY.includes("your-service")
    );

    let folderListed = false;
    let driveFilesFound = 0;
    let imageFilesCount = 0;
    let videoFilesCount = 0;

    if (isDriveConfigured) {
      try {
        const drive = getDriveClient();
        const response = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          pageSize: 200,
          fields: "files(id, name, mimeType)"
        });
        const files = response.data.files || [];
        folderListed = true;
        driveFilesFound = files.length;
        imageFilesCount = files.filter(f => (f.mimeType || "").startsWith("image/")).length;
        videoFilesCount = files.filter(f => (f.mimeType || "").startsWith("video/")).length;
      } catch (err: any) {
        console.error("Debug GDrive sync-status failed:", err.message);
      }
    }

    let supabaseTableExists = false;
    let supabaseRowsCount = 0;
    let pendingCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    let hiddenCount = 0;
    let visibleCount = 0;

    if (isSupabaseConfigured && supabase) {
      try {
        const { data: rows, error } = await supabase
          .from("media_metadata")
          .select("is_hidden, approval_status");
        
        if (!error && rows) {
          supabaseTableExists = true;
          supabaseRowsCount = rows.length;
          rows.forEach((r: any) => {
            if (r.approval_status === "pending") pendingCount++;
            else if (r.approval_status === "rejected") rejectedCount++;
            else approvedCount++;

            if (r.is_hidden) hiddenCount++;
            else visibleCount++;
          });
        }
      } catch (err: any) {
        console.error("Debug Supabase sync-status failed:", err.message);
      }
    }

    res.json({
      googleDriveConfigured: isDriveConfigured,
      supabaseConfigured: isSupabaseConfigured,
      folderListed,
      driveFilesFound,
      imageFilesCount,
      videoFilesCount,
      supabaseTableExists,
      supabaseRowsCount,
      approvalStatusCounts: {
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount
      },
      hiddenCount,
      visibleCount
    });
  });

  // --- API ROUTE 2.2: POST /api/admin/repair-metadata ---
  // Re-syncs Drive files & creates missing DB rows, setting approval status back to approved and unhidden
  app.post("/api/admin/repair-metadata", async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!isAdminUser(user)) {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }
    const isMockMode = 
      !folderId || folderId === "YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE" ||
      !googleEmail || googleEmail.startsWith("your-service-account") ||
      !googleKey || googleKey.includes("YOUR_PRIVATE_KEY_HERE");

    let driveFiles: any[] = [];
    if (isMockMode) {
      driveFiles = INITIAL_MOCK_MEDIA.map(item => ({
        id: item.driveFileId,
        name: item.name,
        mimeType: item.mimeType
      }));
    } else {
      try {
        const drive = getDriveClient();
        const response = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          pageSize: 500,
          fields: "files(id, name, mimeType)"
        });
        driveFiles = response.data.files || [];
      } catch (err: any) {
        return res.status(500).json({ success: false, error: "Failed to read Google Drive files during repair", details: err.message });
      }
    }

    const mediaFiles = driveFiles.filter(f => {
      const mime = f.mimeType || "";
      return mime.startsWith("image/") || mime.startsWith("video/");
    });

    const supabase = getSupabase();
    if (!supabase) {
      return res.json({
        success: false,
        message: "Supabase client not configured. Cannot perform metadata repair on database."
      });
    }

    try {
      const { data: existingRows, error: fetchError } = await supabase
        .from("media_metadata")
        .select("*")
        .in("drive_file_id", mediaFiles.map(item => item.id));

      if (fetchError) {
        return res.status(500).json({ success: false, error: "Error fetching existing rows in repair", details: fetchError.message });
      }

      const dbMap = new Map<string, any>(existingRows?.map((r: any) => [r.drive_file_id, r]) || []);
      let repairedCount = 0;
      let createdCount = 0;

      const repairRows = mediaFiles.map((item) => {
        const existing = dbMap.get(item.id);
        const cleanTitle = item.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
        if (existing) {
          let updated = false;
          const updatedRow = { ...existing };
          if (!updatedRow.approval_status || updatedRow.approval_status === "pending") {
            updatedRow.approval_status = "approved";
            updated = true;
          }
          if (updatedRow.is_hidden === null || updatedRow.is_hidden === undefined) {
            updatedRow.is_hidden = false;
            updated = true;
          }
          if (updated) repairedCount++;
          return updatedRow;
        } else {
          createdCount++;
          return {
            drive_file_id: item.id,
            title: cleanTitle,
            description: "",
            people: [],
            location_label: "",
            is_favorite: false,
            is_hidden: false,
            approval_status: "approved",
            admin_notes: ""
          };
        }
      });

      if (repairRows.length > 0) {
        const { error: upsertErr } = await supabase
          .from("media_metadata")
          .upsert(repairRows, { onConflict: "drive_file_id" });
        if (upsertErr) {
          throw upsertErr;
        }
      }

      res.json({
        success: true,
        message: `Metadata repair operation completed. Processed ${mediaFiles.length} media item references.`,
        summary: {
          totalChecked: mediaFiles.length,
          newRowsCreated: createdCount,
          existingRowsRepaired: repairedCount
        }
      });

    } catch (err: any) {
      console.error("[TripVault API] Repair metadata crashed:", err);
      res.status(500).json({ success: false, error: "Metadata repair error: " + err.message });
    }
  });

  // --- API ROUTE 2.3: GET /api/admin/diagnostics ---
  // Returns diagnostic stats for administrative views
  app.get("/api/admin/diagnostics", async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!isAdminUser(user)) {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }

    const supabase = getSupabase();
    let supabaseTablesStatus = "Verified active";
    if (isSupabaseDisabled()) {
      supabaseTablesStatus = "Profiles table missing. Run supabase/schema.sql.";
    }

    const isDriveConfigured = !!(
      googleEmail && !googleEmail.startsWith("your-service-account") &&
      googleKey && !googleKey.includes("YOUR_PRIVATE_KEY_HERE") &&
      folderId && folderId !== "YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE"
    );

    res.json({
      success: true,
      authMode: "email/password",
      currentUserEmail: user.email,
      role: "admin",
      supabaseTablesStatus,
      favoriteSource: supabase ? "Supabase DB" : "Memory Fallback",
      currentTheme: "system",
      driveSyncStatus: isDriveConfigured ? "Connected (Live GDrive)" : "Disconnected (Mock Fallback)",
      lastSyncedTime,
      deploymentWarning: "Large in-app uploads may not work on Vercel serverless functions because Vercel has strict function payload limits. For large videos, upload directly to the shared Google Drive folder and use Sync Now."
    });
  });

  // --- API ROUTE 3: PATCH /api/media/:id ---
  // Modifies metadata for an asset, persisting into Supabase if accessible, with local storage fallback
  app.patch("/api/media/:id", async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!isAdminUser(user)) {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }
    const { id } = req.params;
    const updates = req.body;

    const driveFileId = id.startsWith("gdrive_") ? id.replace("gdrive_", "") : id;
    console.log(`[TripVault API] Applying PATCH updates for ${driveFileId}:`, updates);

    // Save fallback overrides locally
    const currentOverride = metadataOverrides[driveFileId] || {};
    metadataOverrides[driveFileId] = {
      ...currentOverride,
      title: updates.title !== undefined ? updates.title : currentOverride.title,
      description: updates.description !== undefined ? updates.description : currentOverride.description,
      people: updates.people !== undefined ? updates.people : currentOverride.people,
      location: updates.location_label !== undefined ? updates.location_label : (updates.location !== undefined ? updates.location : currentOverride.location),
      softDeleted: updates.is_hidden !== undefined ? updates.is_hidden : (updates.softDeleted !== undefined ? updates.softDeleted : currentOverride.softDeleted),
    };

    // Update frontend cache store item
    const index = serverMediaStore.findIndex((item) => item.driveFileId === driveFileId || item.id === id);
    if (index !== -1) {
      const liveItem = serverMediaStore[index];
      serverMediaStore[index] = {
        ...liveItem,
        title: updates.title !== undefined ? updates.title : liveItem.title,
        description: updates.description !== undefined ? updates.description : liveItem.description,
        people: updates.people !== undefined ? updates.people : liveItem.people,
        location: updates.location_label !== undefined ? updates.location_label : (updates.location !== undefined ? updates.location : liveItem.location),
        softDeleted: updates.is_hidden !== undefined ? updates.is_hidden : (updates.softDeleted !== undefined ? updates.softDeleted : liveItem.softDeleted),
        modifiedTime: new Date().toISOString()
      };
    }

    const supabase = getSupabase();
    if (supabase) {
      try {
        const dbFields: any = {};
        if (updates.title !== undefined) dbFields.title = updates.title;
        if (updates.description !== undefined) dbFields.description = updates.description;
        if (updates.people !== undefined) dbFields.people = updates.people;
        if (updates.location_label !== undefined) {
          dbFields.location_label = updates.location_label;
        } else if (updates.location !== undefined) {
          dbFields.location_label = updates.location;
        }
        if (updates.is_favorite !== undefined) dbFields.is_favorite = updates.is_favorite;
        if (updates.is_hidden !== undefined) {
          dbFields.is_hidden = updates.is_hidden;
        } else if (updates.softDeleted !== undefined) {
          dbFields.is_hidden = updates.softDeleted;
        }
        if (updates.approval_status !== undefined) dbFields.approval_status = updates.approval_status;
        if (updates.admin_notes !== undefined) dbFields.admin_notes = updates.admin_notes;

        dbFields.updated_at = new Date().toISOString();

        const { data, error } = await supabase
          .from("media_metadata")
          .upsert({ drive_file_id: driveFileId, ...dbFields }, { onConflict: "drive_file_id" })
          .select()
          .single();

        if (!error && data) {
          const finishedItem = index !== -1 ? serverMediaStore[index] : null;
          return res.json({
            success: true,
            message: "Metadata updated successfully in Supabase.",
            item: finishedItem ? {
              ...finishedItem,
              title: data.title || finishedItem.title,
              description: data.description || "",
              people: data.people || [],
              location: data.location_label || "",
              isFavorite: data.is_favorite || false,
              softDeleted: data.is_hidden || false,
              approvalStatus: data.approval_status || "approved",
              adminNotes: data.admin_notes || ""
            } : null
          });
        }

        if (error) {
          console.error("Supabase direct modification failed:", error.message);
        }
      } catch (dbErr: any) {
        console.error("Failed to modify metadata row in Supabase:", dbErr.message);
      }
    }

    const simpleItem = index !== -1 ? serverMediaStore[index] : null;
    res.json({
      success: true,
      message: "Metadata updated successfully in local memory (Supabase offline).",
      item: simpleItem ? {
        ...simpleItem,
        isFavorite: (currentOverride as any).isFavorite || false,
        approvalStatus: (currentOverride as any).approvalStatus || "approved",
        adminNotes: (currentOverride as any).adminNotes || ""
      } : null
    });
  });

  // --- API ROUTE 3.3: POST /api/media/:driveFileId/favorite ---
  app.post("/api/media/:id/favorite", async (req, res) => {
    const { id } = req.params;
    const driveFileId = id.startsWith("gdrive_") ? id.replace("gdrive_", "") : id;

    const supabase = getSupabase();
    if (supabase) {
      try {
        const { data: current, error: getErr } = await supabase
          .from("media_metadata")
          .select("*")
          .eq("drive_file_id", driveFileId)
          .maybeSingle();

        if (getErr) {
          const isMissing = getErr.message?.includes("Could not find") || getErr.message?.includes("relation") || getErr.code === "PGRST205";
          if (isMissing) {
            markSupabaseTablesMissing();
          } else {
            console.warn("[TripVault DB Warning] Fetch metadata failed:", getErr.message);
          }
        }

        let updatedData: any = null;
        let updateErr: any = null;

        if (current) {
          const nextFavorite = !Boolean(current.is_favorite);
          const { data, error } = await supabase
            .from("media_metadata")
            .update({
              is_favorite: nextFavorite,
              updated_at: new Date().toISOString()
            })
            .eq("drive_file_id", driveFileId)
            .select()
            .single();
          
          updatedData = data;
          updateErr = error;

          if (!error && data) {
            console.log(`[Favorite Toggle - Update] driveFileId: ${driveFileId.substring(0, 8)}..., previousFavorite: ${current.is_favorite}, nextFavorite: ${nextFavorite}, serverReturnedFavorite: ${data.is_favorite}`);
          }
        } else if (!isSupabaseDisabled()) {
          // Rule 2: Handle missing metadata row
          const nextFavorite = true;
          const { data, error } = await supabase
            .from("media_metadata")
            .insert({
              drive_file_id: driveFileId,
              is_favorite: nextFavorite,
              approval_status: "approved",
              is_hidden: false,
              updated_at: new Date().toISOString()
            })
            .select()
            .single();

          updatedData = data;
          updateErr = error;

          if (!error && data) {
            console.log(`[Favorite Toggle - Insert] driveFileId: ${driveFileId.substring(0, 8)}..., previousFavorite: null/false, nextFavorite: ${nextFavorite}, serverReturnedFavorite: ${data.is_favorite}`);
          }
        }

        if (!updateErr && updatedData) {
          if (!metadataOverrides[driveFileId]) {
            metadataOverrides[driveFileId] = {};
          }
          (metadataOverrides[driveFileId] as any).isFavorite = updatedData.is_favorite;
          
          return res.json({
            success: true,
            driveFileId,
            isFavorite: updatedData.is_favorite,
            metadata: updatedData
          });
        } else if (updateErr) {
          const isMissing = updateErr.message?.includes("Could not find") || updateErr.message?.includes("relation") || updateErr.code === "PGRST205";
          if (isMissing) {
            markSupabaseTablesMissing();
          } else {
            console.warn("[TripVault DB Warning] Supabase favorite sync returned error, falling back locally:", updateErr.message);
          }
        }
      } catch (err: any) {
        console.warn("[Supabase Toggle Favorite Exec Error]:", err.message || err);
      }
    }

    // Offline / Fallback handling if Supabase is missing or errored
    const overrides = metadataOverrides[driveFileId] || {};
    const previousFavorite = (overrides as any).isFavorite === true;
    const nextFavorite = !previousFavorite;
    (overrides as any).isFavorite = nextFavorite;
    metadataOverrides[driveFileId] = overrides;

    console.log(`[Favorite Toggle - Memory Fallback] driveFileId: ${driveFileId.substring(0, 8)}..., previousFavorite: ${previousFavorite}, nextFavorite: ${nextFavorite}, serverReturnedFavorite: ${nextFavorite}`);

    res.json({
      success: true,
      driveFileId,
      isFavorite: nextFavorite,
      message: "Favorite status toggled locally (Supabase offline)",
      metadata: { drive_file_id: driveFileId, is_favorite: nextFavorite }
    });
  });

  // --- API ROUTE 3.4: POST /api/media/:driveFileId/hide ---
  app.post("/api/media/:id/hide", async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!isAdminUser(user)) {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }
    const { id } = req.params;
    const driveFileId = id.startsWith("gdrive_") ? id.replace("gdrive_", "") : id;

    const overrides = metadataOverrides[driveFileId] || {};
    overrides.softDeleted = true;
    metadataOverrides[driveFileId] = overrides;

    const supabase = getSupabase();
    if (supabase) {
      try {
        const { error } = await supabase
          .from("media_metadata")
          .upsert({ drive_file_id: driveFileId, is_hidden: true, updated_at: new Date().toISOString() }, { onConflict: "drive_file_id" });
        if (!error) {
          return res.json({ success: true, isHidden: true });
        }
      } catch (err: any) {
        console.error("Supabase hide failed:", err.message);
      }
    }

    res.json({ success: true, isHidden: true, message: "Media hidden locally (Supabase offline)" });
  });

  // --- API ROUTE 3.5: POST /api/media/:driveFileId/restore ---
  app.post("/api/media/:id/restore", async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!isAdminUser(user)) {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }
    const { id } = req.params;
    const driveFileId = id.startsWith("gdrive_") ? id.replace("gdrive_", "") : id;

    const overrides = metadataOverrides[driveFileId] || {};
    overrides.softDeleted = false;
    metadataOverrides[driveFileId] = overrides;

    const supabase = getSupabase();
    if (supabase) {
      try {
        const { error } = await supabase
          .from("media_metadata")
          .upsert({ drive_file_id: driveFileId, is_hidden: false, updated_at: new Date().toISOString() }, { onConflict: "drive_file_id" });
        if (!error) {
          return res.json({ success: true, isHidden: false });
        }
      } catch (err: any) {
        console.error("Supabase restore failed:", err.message);
      }
    }

    res.json({ success: true, isHidden: false, message: "Media restored locally (Supabase offline)" });
  });

  // --- API ROUTE 3.6: GET /api/settings ---
  app.get("/api/settings", async (req, res) => {
    try {
      const supabase = getSupabase();
      if (supabase) {
        const { data, error } = await supabase
          .from("app_settings")
          .select("*")
          .eq("id", "default")
          .single();

        if (!error && data) {
          return res.json({ success: true, settings: data });
        }

        if (error && error.code === "PGRST116") {
          const { data: seeded, error: seedErr } = await supabase
            .from("app_settings")
            .insert([{ id: "default", ...defaultSettings }])
            .select()
            .single();
          if (!seedErr && seeded) {
            return res.json({ success: true, settings: seeded });
          }
        }
      }
    } catch (err: any) {
      console.error("Error reading database settings:", err.message);
    }

    res.json({ success: true, settings: localSettings });
  });

  // --- API ROUTE 3.7: PATCH /api/settings ---
  app.patch("/api/settings", async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!isAdminUser(user)) {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }
    const updates = req.body;
    console.log("[TripVault API] Updating settings:", updates);

    const allowedKeys = [
      "trip_title", 
      "gallery_visibility", 
      "allow_downloads", 
      "require_approval", 
      "approval_workflow_enabled", 
      "allow_public_downloads", 
      "allow_guest_favorites"
    ];
    const patchObj: any = {};
    for (const k of allowedKeys) {
      if (updates[k] !== undefined) {
        patchObj[k] = updates[k];
      }
    }

    localSettings = { ...localSettings, ...patchObj };

    try {
      const supabase = getSupabase();
      if (supabase) {
        const { data, error } = await supabase
          .from("app_settings")
          .upsert({ id: "default", ...patchObj, updated_at: new Date().toISOString() })
          .select()
          .single();

        if (!error && data) {
          return res.json({ success: true, settings: data });
        }
        if (error) {
          console.error("Supabase settings update error:", error.message);
          return res.status(500).json({ success: false, message: "Database error", error: error.message });
        }
      }
    } catch (err: any) {
      console.error("Error writing settings database:", err.message);
    }

    res.json({ success: true, settings: localSettings, message: "Settings updated in server memory (Supabase offline)" });
  });

  // --- API ROUTE 4: DELETE /api/drive/file/:fileId ---
  // Permanently or soft deletes Google Drive item reference. Falls back to memory list removal for mock cases
  app.delete("/api/drive/file/:fileId", async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!isAdminUser(user)) {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }
    const { fileId } = req.params;
    console.log(`[TripVault API] Delete request initiated for drive file ID: ${fileId}`);

    const isMockId = !fileId || fileId.startsWith("drive_file_id_");

    if (isMockId) {
      serverMediaStore = serverMediaStore.filter((item) => item.driveFileId !== fileId);
      return res.json({
        success: true,
        message: "Deleted the asset reference from temporary dashboard list successfully (Mock Mode)."
      });
    }

    try {
      const drive = getDriveClient();
      
      console.log(`[TripVault API] Attempting to trash file in real Google Drive: ${fileId}`);
      
      // Moving files to trash is the official safe workspace way to remove files
      await drive.files.update({
        fileId: fileId,
        requestBody: { trashed: true }
      });

      // Filter element out of current live list
      serverMediaStore = serverMediaStore.filter((item) => item.driveFileId !== fileId);
      
      // Also remove local metadata override entries
      delete metadataOverrides[fileId];

      res.json({
        success: true,
        message: "File moved to Google Drive folder Trash, and reference has been removed from list."
      });
    } catch (err: any) {
      console.error("[TripVault API] Failed to delete file in real Drive:", err);
      // Fallback: still delete reference from UI map so state stays fast
      serverMediaStore = serverMediaStore.filter((item) => item.driveFileId !== fileId);
      res.json({
        success: true,
        warning: true,
        message: "Reference removed from UI collection, but Google Drive backend trashed was bypassed locally.",
        details: err.message || err
      });
    }
  });

  // --- API ROUTE 4.4: POST /api/upload ---
  // Authenticated route for uploading photos or videos to Google Drive
  app.post("/api/upload", (req, res, next) => {
    uploadStorage.single("file")(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ success: false, error: "This video is too large for the current upload mode." });
        }
        return res.status(400).json({ success: false, error: err.message || "Upload failed. Please try again." });
      }
      next();
    });
  }, async (req, res) => {
    try {
      // 1. Strict Server-Side Authorization Verification (never trust client)
      const user = await getUserFromRequest(req);
      if (!user) {
        return res.status(401).json({ success: false, error: "Please sign in to upload trip memories." });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, error: "No media file provided for upload." });
      }

      // Reject empty uploads
      if (req.file.size === 0) {
        return res.status(400).json({ success: false, error: "Upload failed. File is empty." });
      }

      // 2. Validate MIME Type on Backend (never rely only on frontend tags)
      const mimeType = req.file.mimetype || "";
      const isImage = mimeType.startsWith("image/");
      const isVideo = mimeType.startsWith("video/");

      if (!isImage && !isVideo) {
        return res.status(400).json({ success: false, error: "Only photos and videos are allowed." });
      }

      // 3. Validate File Extension as secondary check
      if (!req.file.originalname) {
        return res.status(400).json({ success: false, error: "Upload failed. Missing filename." });
      }
      const ext = path.extname(req.file.originalname).toLowerCase();
      const allowedImageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".bmp", ".tiff", ".svg"];
      const allowedVideoExts = [".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv", ".3gp", ".ogg"];

      if (isImage && !allowedImageExts.includes(ext)) {
        return res.status(400).json({ success: false, error: "Only photos and videos are allowed." });
      }
      if (isVideo && !allowedVideoExts.includes(ext)) {
        return res.status(400).json({ success: false, error: "Only photos and videos are allowed." });
      }

      // 4. Force Strict File Size Limits based on File Category
      if (isImage && req.file.size > 25 * 1024 * 1024) {
        return res.status(400).json({ success: false, error: "This photo is too large. Max allowed is 25 MB." });
      }
      if (isVideo && req.file.size > 250 * 1024 * 1024) {
        return res.status(400).json({ success: false, error: "This video is too large for the current upload mode." });
      }

      const title = (req.body.title || "").trim();
      const description = (req.body.description || "").trim();
      const location = (req.body.location || "").trim();
      const peopleRaw = (req.body.people || "").trim();
      const people = peopleRaw ? peopleRaw.split(",").map((p: string) => p.trim()).filter(Boolean) : [];

      // Determine active settings
      let activeSettings = { ...localSettings };
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data: dbSettings } = await supabase
            .from("app_settings")
            .select("*")
            .eq("id", "default")
            .single();
          if (dbSettings) {
            activeSettings = { ...activeSettings, ...dbSettings };
          }
        } catch (_) {}
      }

      const isAdmin = isAdminUser(user);
      const requireApproval = (activeSettings.require_approval || activeSettings.approval_workflow_enabled) && !isAdmin;
      const approvalStatus = requireApproval ? "pending" : "approved";

      console.log(`[TripVault API] Processing upload request. User: ${user.email}, IsAdmin: ${isAdmin}, RequireApproval: ${requireApproval}`);

      // Check for standalone mock mode
      const isMockMode = 
        !folderId || folderId === "YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE" ||
        !googleEmail || googleEmail.startsWith("your-service-account") ||
        !googleKey || googleKey.includes("YOUR_PRIVATE_KEY_HERE");

      let fileId = "";
      let webViewLink = "";
      let thumbnailUrl = "";
      let createdTime = new Date().toISOString();

      if (isMockMode) {
        console.log("[TripVault API] Google Drive credentials not loaded. Simulating successful memory upload locally!");
        fileId = `mock_drive_file_${Date.now()}_` + Math.random().toString(36).substring(2, 7);
        webViewLink = isVideo 
          ? "https://www.w3schools.com/html/mov_bbb.mp4" 
          : "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80";
        thumbnailUrl = isVideo
          ? "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=300&q=80"
          : "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=300&q=80";
      } else {
        // Real Google Drive API Upload
        const drive = getDriveClient();
        
        // Convert Buffer to stream
        const bufferStream = new Readable();
        bufferStream.push(req.file.buffer);
        bufferStream.push(null);

        const driveResponse = await drive.files.create({
          requestBody: {
            name: req.file.originalname,
            parents: [folderId],
            mimeType: req.file.mimetype
          },
          media: {
            mimeType: req.file.mimetype,
            body: bufferStream
          },
          fields: "id, name, mimeType, size, createdTime, webViewLink, thumbnailLink"
        });

        const driveFile = driveResponse.data;
        if (!driveFile || !driveFile.id) {
          throw new Error("Google Drive upload completed but returned no valid File ID.");
        }

        fileId = driveFile.id;
        webViewLink = driveFile.webViewLink || "";
        thumbnailUrl = driveFile.thumbnailLink || driveFile.webViewLink || "";
        if (driveFile.createdTime) {
          createdTime = driveFile.createdTime;
        }
      }

      // Upsert into Supabase RLS media_metadata
      if (supabase) {
        const metadataToInsert = {
          drive_file_id: fileId,
          title: title || req.file.originalname,
          description: description,
          location_label: location,
          people: people,
          uploaded_by_user_id: user.id,
          uploaded_by_email: user.email,
          original_filename: req.file.originalname,
          file_size: req.file.size,
          upload_source: "app_upload",
          approval_status: approvalStatus,
          is_hidden: false,
          is_favorite: false
        };

        const { error: insertError } = await supabase
          .from("media_metadata")
          .upsert([metadataToInsert], { onConflict: "drive_file_id" });

        if (insertError) {
          console.error("[Upload API] DB Metadata upsert error:", insertError.message);
        }
      } else {
        // Fallback overrides
        metadataOverrides[fileId] = {
          title: title || req.file.originalname,
          description: description,
          location: location,
          people: people,
          softDeleted: false
        };
      }

      // Populate into our local cache
      const itemType = isImage ? "image" : "video";
      const newMediaItem: MediaItem = {
        id: `gdrive_${fileId}`,
        driveFileId: fileId,
        name: req.file.originalname,
        type: itemType,
        mimeType: req.file.mimetype,
        thumbnailUrl: thumbnailUrl,
        previewUrl: webViewLink,
        downloadUrl: webViewLink,
        createdTime: createdTime,
        modifiedTime: new Date().toISOString(),
        takenTime: createdTime,
        title: title || req.file.originalname,
        description: description,
        people: people,
        location: location,
        width: 1920,
        height: 1080,
        size: req.file.size,
        duration: 0,
        softDeleted: false,
        uploaded_by_user_id: user.id,
        uploaded_by_email: user.email,
        approvalStatus: approvalStatus
      };

      const existingIdx = serverMediaStore.findIndex(item => item.driveFileId === fileId);
      if (existingIdx !== -1) {
        serverMediaStore[existingIdx] = newMediaItem;
      } else {
        // Prepend to show immediately in UI
        serverMediaStore.unshift(newMediaItem);
      }

      res.json({
        success: true,
        message: requireApproval ? "Upload successful. Waiting for admin approval." : "Upload successful. Added to gallery.",
        requireApproval,
        file: {
          id: fileId,
          name: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size
        },
        item: newMediaItem
      });

    } catch (err: any) {
      console.error("[POST /api/upload failed]:", err);
      res.status(500).json({ success: false, error: err.message || "Upload failed. Please try again." });
    }
  });

  // --- API ROUTE 4.4a: POST /api/upload/resumable/start ---
  // Future-ready Placeholder: Starts an official Google Drive resumable transfer session.
  // This endpoint serves as a production architecture plan for seamless chunk deposits,
  // bypassing serverless execution payload limits.
  app.post("/api/upload/resumable/start", async (req, res) => {
    try {
      const user = await getUserFromRequest(req);
      if (!user) {
        return res.status(401).json({ success: false, error: "Please sign in to initiate uploads." });
      }

      const { filename, mimeType, size } = req.body;
      if (!filename || !mimeType) {
        return res.status(400).json({ success: false, error: "Missing required filename or mimeType." });
      }

      console.log(`[TripVault Resumable Plan] Resumable session requested by ${user.email}: ${filename} (${size} bytes)`);

      // NOTE: In production, we request a dedicated session URL directly from Google Drive:
      // const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      //   method: 'POST',
      //   headers: {
      //     'Authorization': `Bearer ${srvToken}`,
      //     'X-Upload-Content-Type': mimeType,
      //     'X-Upload-Content-Length': size
      //   }
      // });
      // The session URL returned in the 'Location' response header would be returned as the upload target.

      const sessionId = `resumable_session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      res.json({
        success: true,
        message: "Resumable upload session initiated successfully.",
        sessionId,
        uploadUrl: `/api/upload/resumable/chunk?session=${sessionId}`,
        chunkSize: 8 * 1024 * 1024 // 8MB recommended chunk size standard
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- API ROUTE 4.4b: PUT /api/upload/resumable/chunk ---
  // Future-ready Placeholder: Commits an individual binary chunk into active session storage
  app.put("/api/upload/resumable/chunk", async (req, res) => {
    try {
      const { session } = req.query;
      if (!session) {
        return res.status(400).json({ success: false, error: "Missing session identifier." });
      }

      // NOTE: In production, chunks are buffered sequentially or piped straight to Google.
      // E.g. web clients execute PUT with standard 'Content-Range: bytes START-END/TOTAL' headers.

      res.json({
        success: true,
        message: "Chunk accepted successfully.",
        bytesReceived: Number(req.headers["content-length"]) || 0
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- API ROUTE 4.4c: POST /api/upload/resumable/finish ---
  // Future-ready Placeholder: Concludes a completed chunk stream session & triggers db sync
  app.post("/api/upload/resumable/finish", async (req, res) => {
    try {
      const user = await getUserFromRequest(req);
      if (!user) {
        return res.status(401).json({ success: false, error: "Please sign in." });
      }

      const { sessionId, title, location, peopleRaw } = req.body;
      if (!sessionId) {
        return res.status(400).json({ success: false, error: "Missing sessionId." });
      }

      console.log(`[TripVault Resumable Plan] Finalizing session metadata mapping for sessionId: ${sessionId}`);

      res.json({
        success: true,
        message: "Resumable session completed. Metadata committed.",
        fileId: `resumable_drive_${Date.now()}`
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- API ROUTE 4.5: POST /api/drive/reset ---
  // Resets all metadata overrides and soft-deleted states back to initial demo data
  app.post("/api/drive/reset", async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!isAdminUser(user)) {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }
    console.log("[TripVault API] Client triggered full state & metadata reset");
    // Clear overrides
    for (const key in metadataOverrides) {
      delete metadataOverrides[key];
    }
    // Reseed overrides
    INITIAL_MOCK_MEDIA.forEach((item) => {
      metadataOverrides[item.driveFileId] = {
        title: item.title,
        description: item.description,
        people: item.people,
        location: item.location,
        softDeleted: false
      };
    });
    // Revert store
    serverMediaStore = [...INITIAL_MOCK_MEDIA];
    lastSyncedTime = new Date().toISOString();

    const supabase = getSupabase();
    if (supabase) {
      try {
        // Erase table data and reseed defaults
        await supabase.from("media_metadata").delete().neq("drive_file_id", "");
        
        const newInserts = INITIAL_MOCK_MEDIA.map((item) => ({
          drive_file_id: item.driveFileId,
          title: item.title,
          description: item.description || "",
          people: item.people || [],
          location_label: item.location || "",
          is_favorite: false,
          is_hidden: false,
          approval_status: "approved",
          admin_notes: ""
        }));
        await supabase.from("media_metadata").insert(newInserts);
        
        // Reset settings
        localSettings = { ...defaultSettings };
        await supabase.from("app_settings").upsert({ id: "default", ...defaultSettings });
      } catch (dbErr: any) {
        console.error("Database reset error:", dbErr.message);
      }
    }

    const list = await getMergedMediaItems(true, true);

    res.json({
      success: true,
      message: "Gallery state, custom descriptions, and soft-deleted states have been fully reset.",
      media: list,
      syncStats: {
        totalPhotosCount: list.filter((item) => item.type === "image").length,
        totalVideosCount: list.filter((item) => item.type === "video").length,
        lastSyncedTime
      }
    });
  });

  // --- API ROUTE 5: GET /api/health/drive ---
  // Comprehensive active diagnostic status monitor
  app.get("/api/health/drive", async (req, res) => {
    const maskedFolder = folderId 
      ? (folderId.length > 8 ? `${folderId.substring(0, 4)}...${folderId.substring(folderId.length - 4)}` : "***") 
      : "Not Configured";
    const maskedEmail = googleEmail 
      ? (googleEmail.length > 10 ? `${googleEmail.substring(0, 5)}...${googleEmail.substring(googleEmail.indexOf("@"))}` : "***") 
      : "Not Configured";

    const possibleFixes: string[] = [];
    if (!folderId || folderId === "YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE") {
      possibleFixes.push("Set GOOGLE_DRIVE_FOLDER_ID in environment secrets.");
    }
    if (!googleEmail || googleEmail.startsWith("your-service-account")) {
      possibleFixes.push("Configure GOOGLE_SERVICE_ACCOUNT_EMAIL with your GCP Service Account address.");
    }
    if (!googleKey || googleKey.includes("YOUR_PRIVATE_KEY_HERE")) {
      possibleFixes.push("Paste your real GOOGLE_PRIVATE_KEY. Ensure it begins with -----BEGIN PRIVATE KEY-----");
    }

    if (possibleFixes.length > 0) {
      return res.json({
        success: false,
        folderId: maskedFolder,
        serviceEmail: maskedEmail,
        canConnectToDrive: false,
        error: "Configuration is incomplete. Secret keys contain default placeholders.",
        possibleFixes
      });
    }

    try {
      const drive = getDriveClient();
      
      // Test-fetch 3 elements to verify credential parsing, permissions, and API status
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        pageSize: 3,
        fields: "files(id, name, mimeType)"
      });

      const filesList = response.data.files || [];

      res.json({
        success: true,
        folderId: maskedFolder,
        serviceEmail: maskedEmail,
        canConnectToDrive: true,
        filesFound: filesList.length,
        sampleFiles: filesList.map((f) => ({
          id: f.id ? (f.id.length > 6 ? `${f.id.substring(0, 3)}...${f.id.substring(f.id.length - 3)}` : f.id) : "",
          name: f.name || "Unnamed",
          mimeType: f.mimeType || "unknown"
        }))
      });
    } catch (err: any) {
      console.error("[TripVault Health] Diagnostic scan encountered error:", err);
      
      const errMsg = err.message || "";
      const errCode = err.code || "";
      const fixes: string[] = [];

      if (errMsg.includes("PEM_read_bio_PrivateKey") || errMsg.includes("error:0909006C") || errMsg.includes("key") || errMsg.includes("Key")) {
        fixes.push("GOOGLE_PRIVATE_KEY formatting is broken. Ensure standard newlines are preserved properly instead of single-line spacing.");
      } else if (errCode === 403 || errMsg.includes("accessNotConfigured") || errMsg.includes("not enabled")) {
        fixes.push("The Google Drive API is disabled in your GCP Developers Console. Go to APIs & Services, search Google Drive API, and click Enable.");
      } else if (errCode === 404 || errMsg.includes("File not found") || errMsg.includes("not found")) {
        fixes.push("The folder ID is wrong, or the Service Account has not been added as a shared member. Open your Drive folder -> click Share -> invite your Service Account address as 'Viewer'.");
      } else {
        fixes.push("Verify that you copied the folder ID exactly (excluding full URL paths).");
        fixes.push("Add your GCP Service Account email as a 'Viewer' with shared permissions in your Drive folder settings.");
      }

      res.status(200).json({
        success: false,
        folderId: maskedFolder,
        serviceEmail: maskedEmail,
        canConnectToDrive: false,
        error: errMsg || "Connection validation timed out.",
        possibleFixes: fixes
      });
    }
  });

  // Endpoint to serve client-side public Supabase keys securely from system environment
  app.get("/api/config/supabase", (req, res) => {
    res.json({
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ""
    });
  });

  // --- API ROUTE 6: GET /api/health/supabase ---
  // Supabase credential and live schema scanner (queries tables directly to verify existence)
  app.get("/api/health/supabase", async (req, res) => {
    const url = process.env.SUPABASE_URL || "";
    const anonKey = process.env.SUPABASE_ANON_KEY || "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    const fixes: string[] = [];
    if (!url || url.includes("your-supabase")) {
      fixes.push("Configure direct SUPABASE_URL in your cloud secret environment variable keys.");
    }
    if (!anonKey || anonKey.includes("your-anon")) {
      fixes.push("Input correct public SUPABASE_ANON_KEY value.");
    }
    if (!serviceKey || serviceKey.includes("your-service")) {
      fixes.push("Define SUPABASE_SERVICE_ROLE_KEY environment secrets for private metadata querying.");
    }

    if (fixes.length > 0) {
      return res.json({
        success: false,
        connected: false,
        message: "Supabase tables are missing",
        requiredAction: "Run supabase/schema.sql in Supabase SQL Editor",
        fixes
      });
    }

    try {
      const supabase = getSupabase();
      if (!supabase) {
        return res.json({
          success: false,
          connected: false,
          message: isSupabaseDisabled() ? "Supabase tables are missing" : "Supabase connection is not initiated",
          requiredAction: isSupabaseDisabled()
            ? "Run supabase/schema.sql in Supabase SQL Editor"
            : "Check your SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY values",
          fixes: [
            isSupabaseDisabled()
              ? "Please execute our updated '/supabase/schema.sql' file inside your Supabase SQL Editor."
              : "Verify your environment variable keys to connect to a live Supabase database."
          ]
        });
      }

      // Live query check on all four required tables
      const mediaRes = await supabase.from("media_metadata").select("id").limit(1);
      const settingsRes = await supabase.from("app_settings").select("id").limit(1);
      const profilesRes = await supabase.from("profiles").select("id").limit(1);
      const favoritesRes = await supabase.from("user_favorites").select("id").limit(1);

      const errors = [];
      const missingTables = [];

      if (mediaRes.error) {
        errors.push(mediaRes.error);
        if (mediaRes.error.message?.includes("does not exist") || mediaRes.error.code === "PGRST205") {
          missingTables.push("media_metadata");
        }
      }
      if (settingsRes.error) {
        errors.push(settingsRes.error);
        if (settingsRes.error.message?.includes("does not exist") || settingsRes.error.code === "PGRST205") {
          missingTables.push("app_settings");
        }
      }
      if (profilesRes.error) {
        errors.push(profilesRes.error);
        if (profilesRes.error.message?.includes("does not exist") || profilesRes.error.code === "PGRST205") {
          missingTables.push("profiles");
        }
      }
      if (favoritesRes.error) {
        errors.push(favoritesRes.error);
        if (favoritesRes.error.message?.includes("does not exist") || favoritesRes.error.code === "PGRST205") {
          missingTables.push("user_favorites");
        }
      }

      if (errors.length > 0) {
        const dbErr = errors[0];
        console.error("[Supabase Health] Live check failed:", dbErr);
        return res.json({
          success: false,
          connected: false,
          message: missingTables.length > 0 
            ? `Supabase integration is partially down. Missing structure: ${missingTables.join(", ")}`
            : "Supabase tables are missing",
          requiredAction: "Please execute our updated '/supabase/schema.sql' file inside your Supabase SQL Editor to provision the tables, unique roles, and constraints properly.",
          errorDetails: errors.map(e => e.message).join(" | "),
          missingTables: missingTables
        });
      }

      res.json({
        success: true,
        connected: true,
        tablesFound: ["media_metadata", "app_settings", "profiles", "user_favorites"]
      });
    } catch (err: any) {
      console.error("[Supabase Health] Connection/Client error:", err);
      res.json({
        success: false,
        connected: false,
        message: "Supabase connection failed: " + (err.message || err),
        requiredAction: "Check your SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY values"
      });
    }
  });

  // --- API ROUTE 7: GET /api/media/stream/:fileId ---
  // Secure backend video streaming endpoint supporting Range requests
  app.get("/api/media/stream/:fileId", async (req, res) => {
    const { fileId } = req.params;
    const range = req.headers.range;

    // Logging only safe information (fileId partial, mimeType check, range existence)
    const partialId = fileId ? fileId.substring(0, 8) : "null";
    console.log(`[TripVault Streaming] Request for fileId: ${partialId}..., Range header exists: ${range ? "Yes" : "No"}`);

    const isMockMode = 
      !folderId || folderId === "YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE" ||
      !googleEmail || googleEmail.startsWith("your-service-account") ||
      !googleKey || googleKey.includes("YOUR_PRIVATE_KEY_HERE") ||
      fileId.startsWith("drive_file_id_");

    if (isMockMode) {
      console.log(`[TripVault Streaming] Serving mock stream redirection for file: ${partialId}`);
      const foundItem = serverMediaStore.find(item => item.driveFileId === fileId);
      const mockUrl = foundItem?.previewUrl || "https://assets.mixkit.co/videos/preview/mixkit-waves-breaking-in-the-sunset-1185-large.mp4";
      return res.redirect(302, mockUrl);
    }

    try {
      const drive = getDriveClient();

      // Retrieve metadata to verify existence, fetch mimeType and actual file size
      let fileMeta;
      try {
        const metadataRes = await drive.files.get({
          fileId,
          fields: "id, name, mimeType, size"
        });
        fileMeta = metadataRes.data;
      } catch (metaErr: any) {
        console.error(`[TripVault Streaming] Metadata retrieve failed for ${partialId}:`, metaErr.message);
        return res.status(404).json({
          success: false,
          error: "Specified video file reference not found in your Google Drive.",
          message: metaErr.message
        });
      }

      // Check mimeType is a video
      const mimeType = fileMeta.mimeType || "";
      console.log(`[TripVault Streaming] File found on drive: ${fileMeta.name}, mimeType: ${mimeType}`);

      if (!mimeType.startsWith("video/")) {
        console.warn(`[TripVault Streaming] Non-video file mimeType: ${mimeType}`);
        return res.status(400).json({
          success: false,
          error: "The requested media file is not a supported video file."
        });
      }

      const sizeStr = fileMeta.size;
      const size = sizeStr ? parseInt(sizeStr, 10) : null;

      const options: any = {
        responseType: "stream"
      };
      if (range) {
        options.headers = { Range: range };
      }

      let googleResponse;
      try {
        googleResponse = await drive.files.get(
          { fileId, alt: "media" },
          options
        );
      } catch (streamErr: any) {
        console.error(`[TripVault Streaming] Stream initiation failed with Range, retrying standard stream:`, streamErr.message);
        if (range) {
          googleResponse = await drive.files.get(
            { fileId, alt: "media" },
            { responseType: "stream" }
          );
        } else {
          throw streamErr;
        }
      }

      const driveHeaders = googleResponse.headers;

      // Extract headers from modern Web Headers class or classic plain object safely
      const getHeader = (h: any, name: string): string | undefined => {
        if (!h) return undefined;
        if (typeof h.get === "function") {
          return h.get(name) || undefined;
        }
        return h[name.toLowerCase()] || h[name];
      };

      const contentLength = getHeader(driveHeaders, "content-length");
      const contentRange = getHeader(driveHeaders, "content-range");

      // Set headers required for successful streaming to browser
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "private, max-age=3600");

      if (contentLength) {
        res.setHeader("Content-Length", contentLength);
      } else if (size !== null && !range) {
        res.setHeader("Content-Length", size);
      }

      if (contentRange) {
        res.setHeader("Content-Range", contentRange);
      }

      const hasRangeResponse = !!contentRange || googleResponse.status === 206;
      res.status(hasRangeResponse ? 206 : 200);

      googleResponse.data.on("error", (pipeErr: any) => {
        console.error("[TripVault Streaming] Error in pipeline transfer stream:", pipeErr);
      });

      googleResponse.data.pipe(res);

    } catch (err: any) {
      console.error("[TripVault Streaming] Streaming process failure:", err);
      return res.status(500).json({
        success: false,
        error: "Google Drive streaming backend integration experienced an unexpected error.",
        details: err.message || err
      });
    }
  });

  // --- API ROUTE 8: GET /api/media/download/:fileId ---
  // Proxied endpoint to download media assets directly from Google Drive securely
  app.get("/api/media/download/:fileId", async (req, res) => {
    const { fileId } = req.params;
    const partialId = fileId ? fileId.substring(0, 8) : "null";
    console.log(`[TripVault API] Download initiated for drive file: ${partialId}...`);

    const isMockId = !fileId || fileId.startsWith("drive_file_id_");

    if (isMockId) {
      const foundItem = serverMediaStore.find(item => item.driveFileId === fileId);
      const downloadUrl = foundItem?.previewUrl || "https://assets.mixkit.co/videos/preview/mixkit-waves-breaking-in-the-sunset-1185-large.mp4";
      return res.redirect(302, downloadUrl);
    }

    try {
      const drive = getDriveClient();
      
      const metadataRes = await drive.files.get({
        fileId: fileId,
        fields: "name, mimeType, size"
      });

      const fileMeta = metadataRes.data;
      const fileName = fileMeta.name || "downloaded-media";
      const mimeType = fileMeta.mimeType || "application/octet-stream";

      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader("Content-Type", mimeType);
      if (fileMeta.size) {
        res.setHeader("Content-Length", fileMeta.size);
      }

      const response = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "stream" }
      );

      response.data.pipe(res);
    } catch (err: any) {
      console.error("[TripVault API] Secured direct download failed:", err);
      // Fallback redirect if streaming fails
      res.status(500).json({
        success: false,
        error: "Failed to download requested item from Google Drive.",
        details: err.message || err
      });
    }
  });

  // =========================================================================
  // --- USER PROFILE & FAVORITES API ENDPOINTS ---
  // =========================================================================

  // GET /api/me: Returns current authenticated user profile
  app.get("/api/me", async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.json({ guest: true, role: "guest" });
    }

    const email = (user.email || "").trim().toLowerCase();
    const isMatchedAdmin = email === "avishekmajumderpciu@gmail.com";

    const supabase = getSupabase();
    if (!supabase) {
      // Supabase is disabled/not connected, fallback to basic fields
      const role = isMatchedAdmin ? "admin" : "guest";
      return res.json({
        guest: false,
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || user.user_metadata?.name || "",
        avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || "",
        role: role,
        theme_preference: "system"
      });
    }

    try {
      const role = isMatchedAdmin ? "admin" : "guest";
      const fullName = user.user_metadata?.full_name || user.user_metadata?.name || "";
      const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || "";

      // Upsert profile
      const { data: profile, error: upsertErr } = await supabase
        .from("profiles")
        .upsert({
          id: user.id,
          email: user.email,
          full_name: fullName,
          avatar_url: avatarUrl,
          role: role,
          updated_at: new Date().toISOString()
        }, { onConflict: "id" })
        .select()
        .single();

      if (upsertErr) {
        console.warn("[Profile Sync Error]:", upsertErr.message);
        // Fallback to direct auth data
        return res.json({
          guest: false,
          id: user.id,
          email: user.email,
          full_name: fullName,
          avatar_url: avatarUrl,
          role: role,
          theme_preference: "system",
          dbWarning: upsertErr.message
        });
      }

      res.json({
        guest: false,
        ...profile
      });
    } catch (err: any) {
      console.error("[GET /api/me Exception]:", err.message);
      res.json({
        guest: false,
        id: user.id,
        email: user.email,
        role: isMatchedAdmin ? "admin" : "guest",
        theme_preference: "system",
        error: err.message
      });
    }
  });

  // GET /api/favorites: Returns list of drive_file_ids that are favorited by the current logged-in user
  app.get("/api/favorites", async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabase = getSupabase();
    if (!supabase) {
      // Return favorites from in-memory metadataOverrides fallback
      const memoryFavs = Object.keys(metadataOverrides).filter(
        (key) => (metadataOverrides[key] as any).isFavorite === true
      );
      return res.json({ success: true, favorites: memoryFavs });
    }

    try {
      const { data, error } = await supabase
        .from("user_favorites")
        .select("drive_file_id")
        .eq("user_id", user.id);

      if (error) {
        console.error("[GET /api/favorites DB Error]:", error?.message);
        return res.status(500).json({ error: error.message });
      }

      const fileIds = (data || []).map((f: any) => f.drive_file_id);
      res.json({ success: true, favorites: fileIds });
    } catch (err: any) {
      console.error("[GET /api/favorites Exception]:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/favorites/:driveFileId: Adds a favorite for the logged-in user
  app.post("/api/favorites/:driveFileId", async (req, res) => {
    const { driveFileId } = req.params;
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabase = getSupabase();
    if (!supabase) {
      // Save to memory metadataOverrides fallback
      if (!metadataOverrides[driveFileId]) {
        metadataOverrides[driveFileId] = {};
      }
      (metadataOverrides[driveFileId] as any).isFavorite = true;
      return res.json({ success: true, isFavorite: true, driveFileId, message: "Favorite added to local fallback memory" });
    }

    try {
      const { error } = await supabase
        .from("user_favorites")
        .upsert({
          user_id: user.id,
          drive_file_id: driveFileId,
          created_at: new Date().toISOString()
        }, { onConflict: "user_id,drive_file_id" });

      if (error) {
        console.error("[POST /api/favorites Error]:", error?.message);
        return res.status(500).json({ error: error.message });
      }

      res.json({ success: true, isFavorite: true, driveFileId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/favorites/:driveFileId: Removes a favorite for the logged-in user
  app.delete("/api/favorites/:driveFileId", async (req, res) => {
    const { driveFileId } = req.params;
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabase = getSupabase();
    if (!supabase) {
      // Save to memory metadataOverrides fallback
      if (!metadataOverrides[driveFileId]) {
        metadataOverrides[driveFileId] = {};
      }
      (metadataOverrides[driveFileId] as any).isFavorite = false;
      return res.json({ success: true, isFavorite: false, driveFileId, message: "Favorite removed from local fallback memory" });
    }

    try {
      const { error } = await supabase
        .from("user_favorites")
        .delete()
        .match({ user_id: user.id, drive_file_id: driveFileId });

      if (error) {
        console.error("[DELETE /api/favorites Error]:", error?.message);
        return res.status(500).json({ error: error.message });
      }

      res.json({ success: true, isFavorite: false, driveFileId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/profile/theme: Saves theme preference for the user
  app.patch("/api/profile/theme", async (req, res) => {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { theme } = req.body;
    if (!theme || !["light", "dark", "system"].includes(theme)) {
      return res.status(400).json({ error: "Invalid theme preference style" });
    }

    const supabase = getSupabase();
    if (supabase) {
      try {
        const { error } = await supabase
          .from("profiles")
          .update({ theme_preference: theme, updated_at: new Date().toISOString() })
          .eq("id", user.id);

        if (error) {
          console.error("[PATCH /api/profile/theme Error]:", error?.message);
          return res.status(500).json({ error: error.message });
        }
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    res.json({ success: true, theme });
  });

  // Mount Vite development middlewares or production static assets handler
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[TripVault Server] Live and hearing at: http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("[TripVault Server] Startup crashed:", err);
});
