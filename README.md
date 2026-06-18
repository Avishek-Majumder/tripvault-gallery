# 📥 TripVault Gallery • Cox Voyage 2026

TripVault Gallery is a secure, collaborative full-stack photo and video gallery built for collecting of high-quality memories from our group trip to Cox's Bazar. Friends can upload high-resolution media directly through the browser, of whether those files are stored on personal gadgets, with seamless synchronization to a secure, shared Google Drive folder and robust database metadata indexing.

---

## ✨ Features

- 📂 **Dual-Ingress Google Drive Synchronization**: Auto-scans, syncs, and indexes files deposited in a shared Google Drive folder. Sync can also be manually forced instantly with a single click.
- ⚡ **In-App Direct Media Upload**: Friends can upload pictures and videos directly through a drag-and-drop or file browser picker.
- 👥 **Role-Based Auth & Upload Queue**: Secure accounts (guest vs. user vs. admin) with an admin approval workflow panel. Admin can approve, reject, hide, or restore guest uploads.
- 🎭 **Responsive Modern Screen Engine**: Fully responsive designs supporting pixel-perfect displays from 320px mobile up to ultra-wide desktop monitors.
- 🎥 **Smooth Micro-Interactions & Playback**: Fast video streaming controls, immersive previews, and custom responsive layouts.
- 💖 **Durable Cross-Platform Favorites**: Persisted under active profiles globally on a live PostgreSQL schema, with responsive guest fallback storage local to the device cache.
- 🎨 **High-Identity Color Themes**: Light, Dark, and a System theme loaded with colorful synth/neon aesthetics.
- 📈 **Real-Time Database Diagnostics**: Complete, on-demand admin checkups, table verification status, and serverless warning triggers.

---

## 🛠️ Tech Stack

- **Frontend Core**: React 19, Vite, Tailwind CSS, Lucide-React, Motion React animation physics.
- **Backend Services**: Express (Node monolith, packed via `esbuild`).
- **Database Engine**: Supabase (PostgreSQL relational backend).
- **Storage Infrastructure**: Google Drive API (v3) via Server-to-Server Service Accounts.

---

## ⚙️ Local Setup Guide

Follow these beginner-friendly steps to launch TripVault Gallery on your developer machine.

### 1. Clone the Codebase
Download and open the codebase inside your designated workspace directory.

### 2. Install Project Dependencies
Run the package manager installation script to pull in runtime and compile tools:
```bash
npm install
```

### 3. Generate Environment File
Copy the configuration template from `.env.example` to a local `.env` file:
```bash
cp .env.example .env
```
*(Ensure `.env` matches your secret settings. Do not commit `.env` to public code repositories – it is ignored by default in `.gitignore`)*

---

## 🔑 Required Environment Variables

Configure these keys inside your local `.env` file:

```env
# SUPABASE DATABASE SETTINGS (BACKEND ONLY SECRETS)
SUPABASE_URL=your_supabase_project_api_url
SUPABASE_ANON_KEY=your_supabase_anon_browser_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_master_key

# SUPABASE DATABASE SETTINGS (CLIENT FRONTEND ACCESSIBLE)
VITE_SUPABASE_URL=your_supabase_project_api_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_browser_key

# SEED OR BOOTSTRAP ADMIN CREDENTIALS
ADMIN_EMAIL=avishekmajumderpciu@gmail.com
ADMIN_NAME=Avishek Majumder
ADMIN_DEFAULT_PASSWORD=specify_a_secure_admin_password_here

# GOOGLE DRIVE AND GCLOUD SERVICE ACCOUNT DETAILS
GOOGLE_DRIVE_FOLDER_ID=your_shared_gdrive_folder_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project-id.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PEM_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
```

---

## 🗃️ Supabase Database Architecture

TripVault uses a PostgreSQL schema hosted on Supabase for indexing metadata, profile roles, and synced favorites.

### How to run `supabase/schema.sql`:
1. Log in to your [Supabase Dashboard](https://supabase.com).
2. Create or navigate to your PostgreSQL project.
3. Open the **SQL Editor** tab from the left navigation panel.
4. Click **New query**.
5. Copy the contents of the `supabase/schema.sql` file located in this repository and paste it into the query workspace.
6. Click **Run** to execute the scripts. This boots the following tables:
   - `profiles`: Holds user identities, full display names, theme configurations, and account privileges.
   - `media_items`: Indexes cached drive IDs, title, type, taken dates, approval workflows, and soft-delete statuses.
   - `user_favorites`: Stores composite keys mapping active accounts with marked drive entries.

---

## 📁 Google Drive API Integration

To map media uploads to your Google Drive account:
1. Create a project in the [Google Cloud Console](https://console.cloud.google.com).
2. Enable the **Google Drive API**.
3. Create an **IAM Service Account** and download its JSON Credentials file.
4. Extract `client_email` and `private_key` from the JSON block, placing them into your `.env` config.
5. Create a shared folder on Google Drive where trip media files are collected.
6. Copy the unique Folder ID from the Drive browser URL bar (the hash after `/folders/`).
7. **Crucial:** Click **Share** on your Google Drive folder and invite the Service Account email address (`client_email`) as an **Editor**.

---

## 💻 Running the Application

### Launch Local Development Server
Starts the full-stack App. The Express server boots on Port 3000 and serves Vite in development middleware mode.
```bash
npm run dev
```
Open **`http://localhost:3000`** in your web browser.

### Build the Application
Compiles the static frontend files into `dist/` and bundles the Express monolith server as `dist/server.cjs` using `esbuild`.
```bash
npm run build
```

### Start in Production Mode
Starts the bundled, high-performance, single-instance Express monolith container.
```bash
npm run start
```

---

## 🚀 Vercel Deployment Guide

To deploy the frontend React gallery app statically to Vercel:

### ⚡ Vite Build Output Config
- **Build Command**: `npm run build` or `vite build`
- **Output Directory**: `dist`

### 📋 Vercel Environment Variables Checklist
Make sure you insert these environment variables in your Vercel project Settings workspace:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

## ⚠️ Known Limitation: Large Upload Files on Vercel

> [!WARNING]
> **Serverless Function Request Body Payload Constraints**
> Because Vercel utilizes an ephemeral, stateless Serverless function arch, standard monolith custom server entry points in `server.ts` cannot execute persistently or stream giant video feeds directly on Vercel without adaptations. 
> 
> Most importantly, Vercel imposes a **strict 4.5 MB body request payload limit** across serverless endpoints. Large in-app image and video uploads **will fail** when routed through Vercel serverless functions.
> 
> **Workaround / Production Guardrails:**
> 1. Make direct folder uploads on your Google Drive application or upload through your synced Google Drive local phone/laptop desktop client directly.
> 2. Once deposited, click **Sync Now** inside the TripVault web interface to instantly index metadata into the gallery library. 
> 3. For sustained production in-app direct media uploads, host the custom Express `server.ts` monolith container on persistent target environments (such as **Google Cloud Run**, Render, Heroku, or Railway), which support streaming multi-part forms and giant in-transit payloads.

---

## 🩺 Troubleshooting Guide

### 💥 My Supabase tables are missing
* **Symptom:** Profile creations or favorites queries fail with database table errors in the console.
* **Solution:** Confirm your DB is properly initialized. Go to your Supabase web dashboard SQL Editor and run the raw SQL blocks outlined in `supabase/schema.sql` to install the schema, triggers, and default index keys.

### ⛓️ Wrong Supabase URL or Anon key
* **Symptom:** Browser fails to fetch with network errors or "API Key invalid" alerts.
* **Solution:** Verify that `VITE_SUPABASE_URL` matches exactly with the API endpoint in your `.env` file and does not have trailing slashes. Re-copy the browser anonymous key into `VITE_SUPABASE_ANON_KEY`.

### 🚗 Google Drive Sync fails and spins indefinitely
* **Symptom:** Clicking "Sync Now" yields errors or mock fallbacks inside the Admin diagnostics.
* **Solution:** 
  1. Check your Google Cloud Service Account credentials (make sure `GOOGLE_PRIVATE_KEY` has exact newlines, is wrapped in quotes, and starts with private key headers).
  2. Confirm your GDrive folder is Shared with the Service Account email address. If the Service Account is not a folder member, it receives permission queries denials.

### 🔇 Video does not play or playback fails
* **Symptom:** Clicking a video shows a gray placeholder saying "Playback Failed" or "HTML5 stream error".
* **Solution:** Drive stream streaming relies on temporary media stream pipes. If your service account lacks permissions, streaming channels fail. Ensure the video MIME Type is correctly recognized (`video/mp4` or compatible) and try downloading the file directly via the download icon.

### 🛡️ Admin panel is not visible
* **Symptom:** Logged-in admin can't find the Admin controls.
* **Solution:** Ensure your active email address matches the designated seed `ADMIN_EMAIL` on setup. Verify if your user profile in the Supabase database `profiles` table has its `role` enum field set to `'admin'`.

### ❤️ Favorites count is not updating immediately
* **Symptom:** Clicking favorites turns the heart icon gray or does not increment stats instantly.
* **Solution:** Ensure you are authenticated. Guests get their favorites tracked in their local storage chunk cache; check if browser cache blocking is active. For logged-in users, verify if the backend table `user_favorites` matches successfully.

---

## 📱 Responsive Layout QA & Device Checklist

TripVault Gallery is engineered with a **fluid display grid** and **dynamic container padding** to support extreme device responsiveness and orientation changes seamlessly. 

Use this checklist during manual testing / QA in Chrome DevTools Device Mode:

| Target Device | Target Size | Mode / Specs | Expected Layout Behavior |
| :--- | :--- | :--- | :--- |
| **Small Mobile** | `320px × 568px` | iPhone SE (Compact) | 1-col media cards, compact headers, hidden labels, scrollable filter tabs. |
| **Android Mobile** | `360px × 800px` | Galaxy S20 / Pixel | 1-to-2-col cards, full-width search input, stacked stats metrics block. |
| **iPhone Modern** | `390px × 844px` | iPhone 12/13/14/15 Pro | 2-col flex cards nicely padded, compact quick icons, inline user avatars. |
| **Large Mobile** | `430px × 932px` | iPhone 14/15 Pro Max | Fluid card spacing, dual-column metrics panel. |
| **Foldables** | `480px × 800px` | Slate Folded / Small Tablet | 2-column card grid, inline search bar, adaptive side modal. |
| **Mid-Size Tablet** | `768px × 1024px`| iPad Portrait | 3-column content grid, desktop action buttons, persistent modal info. |
| **iPad Pro / Air** | `834px × 1194px`| iPad Air / Pro | Full-row tabs, roomy spacing, inline diagnostic specifications. |
| **Small Desktop / Air**| `1024px × 768px`| Tablet Landscape / Air | 4-column cards, side-by-side details panel in display modals. |
| **Standard Laptop** | `1366px × 768px`| Common Chromebooks | 4-to-5 columns, sticky filter bars, elegant visual negative space. |
| **Full HD Desktop** | `1920px × 1080px`| 1080p Monitors | 5-column grid, max-width wrapper bounds (`max-w-7xl`). |
| **Large Monitors / 2K**| `2560px × 1440px`| QHD Screens | Clean centered viewport margins, high-density elements alignment. |

### 🔍 Verification Procedure:
1. **Swipe and Gestures**: Open on any touch device and test folder-sync triggers, drag-and-drop triggers, and multi-file selections.
2. **Device Orientation Switch**:
   - Verify modal fits horizontally and vertically during portrait and landscape toggling.
   - Confirm video controls and full screen image zoom elements adjust height to prevent viewport spills.
3. **Deep Scale Browser Zoom (90%, 100%, 125%)**:
   - Ensure header elements wrap cleanly without clipping action buttons or overflowing profile titles.
   - Ensure the system diagnostics pane remains fully readable within the Admin Panel.
4. **Modals Close Handlers**: Hit `Escape` key on any screen to close active detailed item view, admin drawers, and upload overlays.

