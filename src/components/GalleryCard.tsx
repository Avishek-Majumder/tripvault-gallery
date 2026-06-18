import { Camera, Video, Heart, Eye, Download, MapPin, Calendar, User, RefreshCw } from "lucide-react";
import { MediaItem } from "../types";

interface GalleryCardProps {
  key?: any;
  item: MediaItem;
  index: number;
  isPending: boolean;
  toggleFavorite: (driveFileId: string) => void;
  openItemDetails: (item: MediaItem) => void;
  isAdminMode: boolean;
  isMyUploadsMode?: boolean;
  formatDuration: (seconds?: number) => string;
  formatSize: (bytes?: number) => string;
  formatTakenDate: (dateStr: string) => string;
}

export default function GalleryCard({
  item,
  index,
  isPending,
  toggleFavorite,
  openItemDetails,
  isAdminMode,
  isMyUploadsMode = false,
  formatDuration,
  formatSize,
  formatTakenDate,
}: GalleryCardProps) {
  const isFav = !!item.isFavorite;

  return (
    <article
      id={`media-card-${item.id}`}
      onClick={() => openItemDetails(item)}
      className="group bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-xs hover:shadow-lg hover:border-slate-200/80 transition-all duration-300 transform hover:-translate-y-1 cursor-pointer flex flex-col relative"
    >
      {/* Workflow and Soft-deleted badges inside Admin Mode or My Uploads Mode */}
      {(isAdminMode || isMyUploadsMode) && (
        <span className={`absolute top-3 left-3 z-30 text-white px-2 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider shadow-xs ${
          item.softDeleted 
            ? "bg-rose-600/95" 
            : item.approvalStatus === "pending"
              ? "bg-amber-500/95"
              : item.approvalStatus === "rejected"
                ? "bg-rose-500/95"
                : "bg-emerald-600/95"
        }`}>
          {item.softDeleted 
            ? "Hidden" 
            : item.approvalStatus === "pending"
              ? "Pending Review"
              : item.approvalStatus === "rejected"
                ? "Rejected"
                : "Approved"}
        </span>
      )}

      {/* Media graphic container */}
      <div className="relative aspect-[4/3] bg-slate-900 overflow-hidden">
        <img
          src={item.thumbnailUrl}
          alt={item.title || item.name}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />

        {/* Floating Favorite Star trigger */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (isPending) return;
            toggleFavorite(item.driveFileId);
          }}
          disabled={isPending}
          aria-pressed={isFav}
          className={`absolute top-3 right-3 z-35 p-2 rounded-full backdrop-blur-md shadow-md transition-all duration-300 ${
            isPending ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
          } ${
            isFav
              ? "bg-rose-500 text-white scale-105"
              : "bg-white/95 text-slate-700 hover:text-rose-600 hover:bg-white md:opacity-0 md:group-hover:opacity-100 scale-100 hover:scale-105"
          }`}
          title={isFav ? "Remove from favorites" : "Add to favorites"}
        >
          {isPending ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
          ) : (
            <Heart className={`w-3.5 h-3.5 ${isFav ? "fill-current text-white" : ""}`} />
          )}
        </button>

        {/* Video type pill constant marker */}
        {item.type === "video" && (
          <div className="absolute bottom-3 left-3 z-10 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-xs text-[10px] font-semibold text-white flex items-center gap-1">
            <Video className="w-3.5 h-3.5 fill-white" />
            {item.duration !== undefined && item.duration > 0 && (
              <span className="font-mono">{formatDuration(item.duration)}</span>
            )}
          </div>
        )}

        {/* File Size banner overlay when available */}
        {item.size !== undefined && item.size > 0 && (
          <div className="absolute bottom-3 right-3 z-10 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-xs text-[9px] font-mono text-slate-300">
            {formatSize(item.size)}
          </div>
        )}

        {/* Top items RECENT badge */}
        {index < 3 && !item.softDeleted && (
          <span className="absolute top-3.5 right-12 z-10 bg-indigo-600/90 text-white px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide shadow-xs">
            RECENT
          </span>
        )}

        {/* Hover Actions overlay (supports precise quick triggers) */}
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-between p-3.5 z-10">
          <div className="flex justify-start items-center w-full">
            {/* Quick Download */}
            <a
              href={`/api/media/download/${item.driveFileId}`}
              download
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-2 rounded-full bg-white/85 backdrop-blur-sm text-slate-700 hover:text-indigo-600 hover:bg-white transition-all shadow-xs"
              title="Download original file"
            >
              <Download className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Centered play icon for video, or zoom eye for image */}
          <div className="flex justify-center items-center">
            <span className="w-10 h-10 bg-white/95 text-slate-900 rounded-full flex items-center justify-center shadow-md transform scale-90 group-hover:scale-100 transition-all duration-300">
              {item.type === "video" ? (
                <Video className="w-4.5 h-4.5 fill-slate-900 ml-0.5" />
              ) : (
                <Eye className="w-4.5 h-4.5" />
              )}
            </span>
          </div>

          {/* Quick specs helper text */}
          <div className="text-[10px] text-slate-200 font-mono text-center">
            Click to expand and edit
          </div>
        </div>
      </div>

      {/* Info card details */}
      <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
        <div className="space-y-1">
          {item.location && (
            <span className="inline-flex items-center text-[10px] font-bold text-teal-600 uppercase tracking-widest leading-none">
              <MapPin className="w-3 h-3 mr-0.5" /> {item.location}
            </span>
          )}

          <h3 className="font-bold text-slate-800 line-clamp-1 group-hover:text-slate-950 font-display transition-colors">
            {item.title || item.name}
          </h3>

          {item.description && (
            <p className="text-slate-500 text-xs line-clamp-2 mt-1 font-sans">
              {item.description}
            </p>
          )}

          {isMyUploadsMode && item.approvalStatus === "rejected" && (
            <p className="text-rose-600 dark:text-rose-405 text-[10px] font-bold bg-rose-50 dark:bg-rose-950/20 p-1.5 rounded-lg border border-rose-200/40 mt-2 leading-tight">
              ⚠️ This upload was not approved for the public gallery.
            </p>
          )}
        </div>

        {/* Footer info row */}
        <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1 font-medium text-slate-500">
            <Calendar className="w-3 h-3 text-slate-400" />
            {formatTakenDate(item.takenTime)}
          </span>

          {item.people && item.people.length > 0 && (
            <span className="inline-flex items-center gap-1 font-mono text-[9px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">
              <User className="w-2.5 h-2.5" />
              {item.people.length} Friend{item.people.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
