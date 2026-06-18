export interface MediaItem {
  id: string;
  driveFileId: string;
  name: string;
  type: 'image' | 'video';
  mimeType: string;
  thumbnailUrl: string;
  previewUrl: string;
  downloadUrl: string;
  createdTime: string; // ISO string
  modifiedTime: string; // ISO string
  takenTime: string; // Formatting or ISO string
  title: string;
  description: string;
  people: string[];
  location: string;
  width?: number;
  height?: number;
  size?: number;
  duration?: number;
  softDeleted?: boolean;
  approvalStatus?: string;
  adminNotes?: string;
  isFavorite?: boolean;
  uploaded_by_user_id?: string;
  uploaded_by_email?: string;
  original_filename?: string;
  file_size?: number;
  upload_source?: string;
}

export interface SyncStats {
  totalPhotosCount: number;
  totalVideosCount: number;
  lastSyncedTime: string;
  driveFilesFound?: number;
  mediaFilesFound?: number;
  supabaseRowsFound?: number;
  visibleMediaReturned?: number;
  hiddenCount?: number;
  pendingCount?: number;
  rejectedCount?: number;
  approvedCount?: number;
  requireApproval?: boolean;
}
