import React, { useState, useRef } from "react";
import { 
  X, 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  Image as ImageIcon, 
  Video, 
  MapPin, 
  Loader2,
  Tag,
  RefreshCw,
  AlertTriangle
} from "lucide-react";

interface QueuedFile {
  id: string;
  file: File;
  status: "waiting" | "uploading" | "success" | "failed";
  progress: number;
  error?: string;
}

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: any;
  approvalWorkflowEnabled: boolean;
  onUploadSuccess: () => Promise<void>;
}

export default function UploadModal({
  isOpen,
  onClose,
  session,
  approvalWorkflowEnabled,
  onUploadSuccess
}: UploadModalProps) {
  if (!isOpen) return null;

  // Selected files queue with complex statuses
  const [selectedFiles, setSelectedFiles] = useState<QueuedFile[]>([]);
  const [dragActive, setDragActive] = useState<boolean>(false);

  // Form Metadata (applied as primary description block/tags for the files)
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [location, setLocation] = useState<string>("");
  const [peopleTags, setPeopleTags] = useState<string>("");

  // Upload progress counters
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadIndex, setUploadIndex] = useState<number>(0);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [status, setStatus] = useState<"idle" | "success" | "error" | "partial_error">("idle");
  const [successMsg, setSuccessMsg] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // File drag & drop mechanics
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(e.target.files);
    }
  };

  // Perform client-side limits validation before adding to list
  const addFilesToQueue = (files: FileList) => {
    const newItems: QueuedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const mimeType = file.type || "";
      const isImage = mimeType.startsWith("image/");
      const isVideo = mimeType.startsWith("video/");

      let initialStatus: "waiting" | "failed" = "waiting";
      let error = "";

      if (!isImage && !isVideo) {
        initialStatus = "failed";
        error = "Only photos and videos are allowed.";
      } else if (isImage && file.size > 25 * 1024 * 1024) {
        initialStatus = "failed";
        error = "This photo is too large. Max allowed is 25 MB.";
      } else if (isVideo && file.size > 250 * 1024 * 1024) {
        initialStatus = "failed";
        error = "This video is too large for the current upload mode.";
      } else if (file.size === 0) {
        initialStatus = "failed";
        error = "Upload failed. File is empty.";
      }

      newItems.push({
        id: `file_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}`,
        file,
        status: initialStatus,
        progress: 0,
        error
      });
    }

    setSelectedFiles(prev => [...prev, ...newItems]);
    setStatus("idle");
    setErrorMsg("");
  };

  const removeFile = (id: string) => {
    setSelectedFiles(prev => prev.filter(item => item.id !== id));
  };

  const retryFile = (id: string) => {
    setSelectedFiles(prev => prev.map(item => {
      if (item.id === id) {
        // Re-validate just in case
        const file = item.file;
        const mimeType = file.type || "";
        const isImage = mimeType.startsWith("image/");
        const isVideo = mimeType.startsWith("video/");
        
        let initialStatus: "waiting" | "failed" = "waiting";
        let error = "";

        if (!isImage && !isVideo) {
          initialStatus = "failed";
          error = "Only photos and videos are allowed.";
        } else if (isImage && file.size > 25 * 1024 * 1024) {
          initialStatus = "failed";
          error = "This photo is too large. Max allowed is 25 MB.";
        } else if (isVideo && file.size > 250 * 1024 * 1024) {
          initialStatus = "failed";
          error = "This video is too large for the current upload mode.";
        } else if (file.size === 0) {
          initialStatus = "failed";
          error = "Upload failed. File is empty.";
        }

        return {
          ...item,
          status: initialStatus,
          progress: 0,
          error
        };
      }
      return item;
    }));
  };

  const resetForm = () => {
    setSelectedFiles([]);
    setTitle("");
    setDescription("");
    setLocation("");
    setPeopleTags("");
    setUploading(false);
    setUploadProgress(0);
    setUploadIndex(0);
    setStatus("idle");
    setErrorMsg("");
  };

  // Upload files sequentially to avoid server bottleneck and resource spikes
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check if there are wait/failed items to deploy
    const pendingItems = selectedFiles.filter(item => item.status === "waiting" || item.status === "failed");
    if (pendingItems.length === 0) {
      setErrorMsg("Please add or fix file errors before submitting.");
      return;
    }

    setUploading(true);
    setStatus("idle");
    setErrorMsg("");

    const headers: Record<string, string> = {};
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    let successCount = 0;
    let failureCount = 0;

    // Loop through ALL items sequentially
    for (let i = 0; i < selectedFiles.length; i++) {
      const item = selectedFiles[i];

      // Skip already successful ones
      if (item.status === "success") {
        successCount++;
        continue;
      }

      // If it contains a terminal size/type validation error, count as failure and skip
      if (item.status === "failed" && item.error && item.error !== "Upload failed. Please try again.") {
        failureCount++;
        continue;
      }

      // Update current active upload state
      setUploadIndex(i);
      setUploadProgress(10);
      setSelectedFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: "uploading", progress: 10 } : f));

      const file = item.file;
      const formData = new FormData();
      formData.append("file", file);

      // Single file vs Bulk metadata attribution
      if (selectedFiles.length === 1) {
        formData.append("title", title || file.name);
        formData.append("description", description);
        formData.append("location", location);
        formData.append("people", peopleTags);
      } else {
        formData.append("title", file.name);
        formData.append("location", location);
        formData.append("people", peopleTags);
      }

      try {
        // Mock intermediate uploading state update
        setSelectedFiles(prev => prev.map(f => f.id === item.id ? { ...f, progress: 40 } : f));
        setUploadProgress(40);

        const res = await fetch("/api/upload", {
          method: "POST",
          headers,
          body: formData
        });

        // Simulating upload feedback timing
        setSelectedFiles(prev => prev.map(f => f.id === item.id ? { ...f, progress: 75 } : f));
        setUploadProgress(75);

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || "Upload rejected by administrative policies.");
        }

        // Successfully updated this specific item
        setSelectedFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: "success", progress: 100, error: undefined } : f));
        successCount++;
        setUploadProgress(100);

      } catch (err: any) {
        console.error(`[Upload Failed] For file "${file.name}":`, err);
        const errorText = err.message || "Upload failed. Please try again.";
        setSelectedFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: "failed", progress: 0, error: errorText } : f));
        failureCount++;
      }
    }

    setUploading(false);

    // Conclude overall status feedback for the user
    if (successCount === selectedFiles.length) {
      setStatus("success");
      const customSuccessText = approvalWorkflowEnabled
        ? "Upload successful. Waiting for admin approval."
        : "Upload successful. Added to gallery.";
      setSuccessMsg(customSuccessText);

      // Trigger parents refresh automatically so live items display
      await onUploadSuccess();
    } else if (successCount > 0 && failureCount > 0) {
      setStatus("partial_error");
      setErrorMsg("Some trip files failed to upload. You can retry individual failures below.");
      await onUploadSuccess(); // Refresh what was successful
    } else {
      setStatus("error");
      setErrorMsg("Upload halted. None of the selected files could be synchronized to secure storage.");
    }
  };

  const totalSizeMB = (selectedFiles.reduce((acc, f) => acc + f.file.size, 0) / (1024 * 1024)).toFixed(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in" id="upload-modal-wrapper">
      <div 
        className="absolute inset-0 cursor-default" 
        onClick={() => {
          if (!uploading) onClose();
        }}
      />

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh] animate-slide-up">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-500/10 text-emerald-600 p-2 rounded-xl">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 dark:text-white text-sm">Upload Trip Memories</h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium font-mono">
                Image limit: 25 MB • Video limit: 250 MB
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-650 transition-colors disabled:opacity-30 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {status === "success" ? (
            <div className="text-center py-8 space-y-4">
              <div className="inline-flex p-3 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-full animate-bounce">
                <CheckCircle2 className="w-12 h-12" />
              </div>
              <div className="space-y-1 px-4">
                <h4 className="font-extrabold text-slate-900 dark:text-white text-base">Memories Deposited!</h4>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{successMsg}</p>
              </div>
              <div className="pt-4">
                <button
                  onClick={resetForm}
                  className="px-6 py-2.5 bg-emerald-600 text-white text-xs font-bold rounded-xl shadow-xs hover:bg-emerald-700 cursor-pointer"
                >
                  Upload More Memories
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleUploadSubmit} className="space-y-5">
              
              {/* Host Payload Warnings */}
              <div className="p-3 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/40 dark:border-amber-900/30 rounded-2xl flex items-start gap-2.5 text-amber-800 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                <div className="text-[10.5px] leading-relaxed">
                  <strong className="block font-bold mb-0.5 text-amber-900 dark:text-amber-300">Serverless Capacity Alert</strong>
                  Large in-app uploads may not work on Vercel serverless functions because Vercel has strict function payload limits. For large videos, upload directly to the shared Google Drive folder and use <strong>Sync Now</strong>.
                </div>
              </div>

              {/* Global Error Banner */}
              {errorMsg && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-900/30 rounded-2xl flex items-start gap-2 text-rose-700 dark:text-rose-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="text-xs font-medium leading-normal">{errorMsg}</div>
                </div>
              )}

              {/* File Dropping Section */}
              {selectedFiles.length === 0 ? (
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl py-8 px-4 text-center cursor-pointer transition-all ${
                    dragActive 
                      ? "border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/10" 
                      : "border-slate-300 dark:border-slate-800 hover:border-indigo-500 hover:bg-slate-50/50 dark:hover:bg-slate-850/20"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <div className="flex flex-col items-center gap-2">
                    <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded-full text-slate-400 dark:text-slate-500">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Drag & drop files here, or click to browse</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Supports JPG, PNG, WEBP, MV, MP4. Size image limit 25MB • Video limit 250MB.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Selected files ({selectedFiles.length})</span>
                    <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-400">{totalSizeMB} MB total</span>
                  </div>
                  
                  {/* File Queue List */}
                  <div className="max-h-48 overflow-y-auto border border-slate-150 dark:border-slate-800/80 rounded-2xl divide-y divide-slate-100 dark:divide-slate-800/60 p-2 bg-slate-50/50 dark:bg-slate-950/30 space-y-1.5">
                    {selectedFiles.map((queued) => {
                      const file = queued.file;
                      const isImage = file.type.startsWith("image/");
                      return (
                        <div key={queued.id} className="flex flex-col gap-1.5 p-2 rounded-xl border border-slate-100 dark:border-slate-800/40 bg-white dark:bg-slate-900/40">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              {file.type.startsWith("video/") ? (
                                <Video className="w-4 h-4 text-indigo-500 shrink-0" />
                              ) : (
                                <ImageIcon className="w-4 h-4 text-emerald-500 shrink-0" />
                              )}
                              <div className="truncate flex flex-col">
                                <span className="font-extrabold text-slate-705 dark:text-slate-200 truncate pr-2">{file.name}</span>
                                <span className="text-[9px] text-slate-400 font-mono">{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                              </div>
                            </div>
                            
                            {/* Actions Right-side */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              {/* Status Badge */}
                              {queued.status === "waiting" && (
                                <span className="text-[8px] font-bold tracking-wider uppercase px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded font-sans">
                                  Waiting
                                </span>
                              )}
                              {queued.status === "uploading" && (
                                <span className="text-[8px] font-bold tracking-wider uppercase px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded animate-pulse font-sans">
                                  Uploading {queued.progress}%
                                </span>
                              )}
                              {queued.status === "success" && (
                                <span className="text-[8px] font-bold tracking-wider uppercase px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded flex items-center gap-0.5 font-sans">
                                  ✓ Success
                                </span>
                              )}
                              {queued.status === "failed" && (
                                <span className="text-[8px] font-bold tracking-wider uppercase px-1.5 py-0.5 bg-rose-50 dark:bg-rose-955 text-rose-600 dark:text-rose-450 rounded font-sans">
                                  Failed
                                </span>
                              )}

                              {/* Retry action */}
                              {queued.status === "failed" && (
                                <button
                                  type="button"
                                  onClick={() => retryFile(queued.id)}
                                  title="Retry Upload"
                                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500 hover:text-indigo-600"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Remove Queue item action */}
                              {!uploading && (
                                <button
                                  type="button"
                                  onClick={() => removeFile(queued.id)}
                                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400 hover:text-rose-500 cursor-pointer"
                                  title="Remove from queue"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Progress bar inside the individual item */}
                          {queued.status === "uploading" && (
                            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1 overflow-hidden mt-0.5">
                              <div 
                                className="bg-indigo-600 h-full transition-all duration-350"
                                style={{ width: `${queued.progress}%` }}
                              />
                            </div>
                          )}

                          {/* Individual error message */}
                          {queued.status === "failed" && queued.error && (
                            <div className="text-[9px] text-rose-500 bg-rose-500/5 p-1 px-2 rounded-md font-medium border border-rose-500/20 flex items-center gap-1 leading-normal font-sans">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span>{queued.error}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {!uploading && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs font-bold text-indigo-650 dark:text-indigo-400 hover:underline cursor-pointer"
                    >
                      + Add more files
                    </button>
                  )}
                </div>
              )}

              {/* Rich optional description block (Only if files selected and not in success state) */}
              {selectedFiles.length > 0 && status !== "success" && (
                <div className="space-y-3.5 border-t border-slate-150 dark:border-slate-800/80 pt-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Metadata options</p>

                  {/* Title (Only shown for SINGLE file because title belongs to individual records) */}
                  {selectedFiles.length === 1 && (
                    <div className="space-y-1.5">
                      <label htmlFor="upload-title" className="block text-xs font-bold text-slate-700 dark:text-slate-350">Memory Title</label>
                      <input
                        id="upload-title"
                        type="text"
                        disabled={uploading}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Sunset at Cox's Bazar beach"
                        className="w-full px-3.5 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-1 focus:ring-indigo-500 focus:outline-none text-slate-800 dark:text-white disabled:opacity-50"
                      />
                    </div>
                  )}

                  {/* Description (Only for SINGLE file) */}
                  {selectedFiles.length === 1 && (
                    <div className="space-y-1.5">
                      <label htmlFor="upload-description" className="block text-xs font-bold text-slate-700 dark:text-slate-350">Description Details</label>
                      <textarea
                        id="upload-description"
                        disabled={uploading}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Add some background context or custom details about this trip photo..."
                        rows={2}
                        className="w-full px-3.5 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-1 focus:ring-indigo-500 focus:outline-none text-slate-800 dark:text-white resize-none disabled:opacity-50"
                      />
                    </div>
                  )}

                  {/* Location label (Bulk & Single) */}
                  <div className="space-y-1.5">
                    <label htmlFor="upload-location" className="block text-xs font-bold text-slate-700 dark:text-slate-350 inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-rose-500" />
                      <span>Where was this?</span>
                    </label>
                    <input
                      id="upload-location"
                      type="text"
                      disabled={uploading}
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="e.g. Inani Beach, Cox's Bazar"
                      className="w-full px-3.5 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-1 focus:ring-indigo-500 focus:outline-none text-slate-800 dark:text-white disabled:opacity-50"
                    />
                  </div>

                  {/* People tags (Bulk & Single) */}
                  <div className="space-y-1.5">
                    <label htmlFor="upload-people" className="block text-xs font-bold text-slate-700 dark:text-slate-350 inline-flex items-center gap-1">
                      <Tag className="w-3.5 h-3.5 text-amber-500" />
                      <span>Who was there?</span>
                    </label>
                    <input
                      id="upload-people"
                      type="text"
                      disabled={uploading}
                      value={peopleTags}
                      onChange={(e) => setPeopleTags(e.target.value)}
                      placeholder="comma-separated, e.g. Avishek, Mom, Dad"
                      className="w-full px-3.5 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-1 focus:ring-indigo-500 focus:outline-none text-slate-800 dark:text-white disabled:opacity-50"
                    />
                  </div>
                </div>
              )}

              {/* Progress Tracker Banner */}
              {uploading && (
                <div className="space-y-2 border-t border-slate-100 dark:border-slate-800/60 pt-4">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-550" />
                      <span>Uploading memory ({uploadIndex + 1}/{selectedFiles.length})</span>
                    </span>
                    <span className="font-mono text-indigo-600 dark:text-indigo-400">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-indigo-600 h-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 font-medium">Please do not refresh. Compressing and depositing bytes sequentially to cloud storage...</p>
                </div>
              )}

              {!uploading && selectedFiles.length > 0 && (
                <div className="pt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="flex-1 py-3 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 border border-slate-205 dark:border-slate-800 text-slate-700 dark:text-slate-350 font-bold text-xs rounded-xl transition-all cursor-pointer"
                  >
                    Clear All
                  </button>
                  <button
                    type="submit"
                    className="flex-3 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all active:scale-98 cursor-pointer"
                  >
                    Deposit {selectedFiles.length} {selectedFiles.length === 1 ? "Memory" : "Memories"}
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
