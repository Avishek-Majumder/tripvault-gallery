-- Cleanup existing tables if running re-initialization
-- DROP TABLE IF EXISTS media_metadata;
-- DROP TABLE IF EXISTS app_settings;

-- 1. Create Media Metadata Table
CREATE TABLE IF NOT EXISTS media_metadata (
  id BIGSERIAL PRIMARY KEY,
  drive_file_id TEXT UNIQUE NOT NULL,
  title TEXT,
  description TEXT,
  people TEXT[] DEFAULT '{}',
  location_label TEXT,
  is_favorite BOOLEAN DEFAULT false,
  is_hidden BOOLEAN DEFAULT false,
  approval_status TEXT DEFAULT 'approved', -- 'pending' | 'approved' | 'rejected'
  admin_notes TEXT,
  uploaded_by_user_id UUID REFERENCES auth.users(id),
  uploaded_by_email TEXT,
  original_filename TEXT,
  file_size BIGINT,
  upload_source TEXT DEFAULT 'app_upload',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Indices for rapid queries during Drive Sync merges
CREATE INDEX IF NOT EXISTS idx_media_metadata_drive_file_id ON media_metadata(drive_file_id);
CREATE INDEX IF NOT EXISTS idx_media_metadata_is_hidden ON media_metadata(is_hidden);

-- 2. Create App Settings Table
CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  trip_title TEXT DEFAULT 'Cox Voyage 2026',
  gallery_visibility TEXT DEFAULT 'private',
  
  -- Original backend parameter flags
  allow_downloads BOOLEAN DEFAULT true,
  require_approval BOOLEAN DEFAULT false,
  
  -- UI interactive parameter keys (mapped to prevent key conflicts)
  approval_workflow_enabled BOOLEAN DEFAULT false,
  allow_public_downloads BOOLEAN DEFAULT true,
  allow_guest_favorites BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Seed initial settings row
INSERT INTO app_settings (
  id, 
  trip_title, 
  gallery_visibility, 
  allow_downloads, 
  require_approval, 
  approval_workflow_enabled, 
  allow_public_downloads, 
  allow_guest_favorites
) VALUES (
  'default', 
  'Cox Voyage 2026', 
  'private', 
  true, 
  false, 
  false, 
  true, 
  true
) ON CONFLICT (id) DO NOTHING;

-- 3. Create Profiles Table (aligned with auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'guest',
  theme_preference TEXT DEFAULT 'system',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 4. Create User Favorites Table (storing per-user favorites)
CREATE TABLE IF NOT EXISTS user_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  drive_file_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  UNIQUE(user_id, drive_file_id)
);

-- Index for user_favorites queries
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id ON user_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_drive_file_id ON user_favorites(drive_file_id);

-- Safe Alterations for backwards compatibility
ALTER TABLE media_metadata ADD COLUMN IF NOT EXISTS uploaded_by_user_id UUID REFERENCES auth.users(id);
ALTER TABLE media_metadata ADD COLUMN IF NOT EXISTS uploaded_by_email TEXT;
ALTER TABLE media_metadata ADD COLUMN IF NOT EXISTS original_filename TEXT;
ALTER TABLE media_metadata ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE media_metadata ADD COLUMN IF NOT EXISTS upload_source TEXT DEFAULT 'app_upload';


