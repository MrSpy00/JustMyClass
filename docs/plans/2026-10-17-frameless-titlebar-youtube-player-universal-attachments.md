# Frameless TitleBar, YouTube Player Fix, Universal Attachments & Release Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the default Windows title bar in favor of a modern theme-matching custom frameless TitleBar, fix YouTube player Error 153 and enhance inline video previews directly under links, fix update checking hanging at "Sunucu sorgulanıyor...", expand assistant file upload to universally support all file types, eradicate all emojis in favor of premium SVG icons, and release a pristine new build while purging old 0.0.1 releases.

**Architecture:** Configure Electron BrowserWindow to purely frameless (`frame: false` without triggering Windows WCO) coupled with our custom React TitleBar featuring drag regions and window control IPCs. Intercept YouTube webRequests with consistent origins, matching referrers, clean User-Agent, and frame header stripping to eliminate Error 153. Implement ultra-fast dual-path update checking (instant `latest.yml` fetch fallback alongside GitHub API), expand file parsing to audio/video/archives/data/documents, run full tests, bump to v0.1.0, and build/publish via `gh`.

**Tech Stack:** Electron 35, React 19, TypeScript 5.8, Tailwind CSS v4, Lucide React, Vitest, electron-builder, GitHub CLI (`gh`).

---

### Task 1: Frameless Window & Modern Custom TitleBar

**Files:**
- Modify: `electron/main.ts:355-385`
- Modify: `src/components/TitleBar.tsx`
- Modify: `src/App.tsx:210-220`
- Test: `tests/buildConfig.test.ts`

**Step 1: Write/Update test for frameless configuration**
Ensure `createWindow` configurations in tests enforce `frame: false` and ensure Windows does not enable Window Controls Overlay (avoiding default Windows caption buttons).

**Step 2: Modify `electron/main.ts`**
Remove `titleBarStyle: 'hidden'` on Windows (which in Chromium on Windows enables Window Controls Overlay with default Windows `— 口 ✕` buttons). Use purely `frame: false`, and conditional `titleBarStyle: 'hidden'` strictly for macOS (`darwin`).

**Step 3: Refine `src/components/TitleBar.tsx`**
Ensure TitleBar has:
- Smooth backdrop and border matching active theme tokens
- Custom graduation/class logo SVG (zero emojis)
- "JustMyClass" text + dynamic version badge
- Sizable drag region (`-webkit-app-region: drag`) and `-webkit-app-region: no-drag` on interactive elements
- Premium Lucide icons (`Minus`, `Square`, `Copy`, `X`) for Minimize, Maximize/Restore, Close
- Double-click to maximize/unmaximize

**Step 4: Verify visually and run tests**
Run: `npm test tests/buildConfig.test.ts`
Expected: PASS

---

### Task 2: Eliminate YouTube Player Error 153 & Header Negotiation

**Files:**
- Modify: `electron/main.ts:288-354`
- Modify: `index.html:1-25`
- Modify: `src/lib/youtube.ts:115-135`
- Modify: `src/components/DocumentViewerModal.tsx:1644-1675`
- Test: `tests/linkDetection.test.ts`

**Step 1: Write test verifying YouTube embed URL and origin generation**
Ensure `getYouTubeEmbedUrl` formats `https://www.youtube.com/embed/${videoId}?origin=https://www.youtube.com&enablejsapi=1&rel=0`.

**Step 2: Add `<meta name="referrer" content="strict-origin-when-cross-origin" />` to `index.html`**
Allows iframes to properly send origin referrers without leaking file:// paths.

**Step 3: Modify `electron/main.ts` webRequest interception**
- For `youtube.com` and `googlevideo.com`, sanitize `requestHeaders`:
  - `requestHeaders['Referer'] = 'https://www.youtube.com/'`
  - `requestHeaders['Origin'] = 'https://www.youtube.com'`
  - Strip `Electron/...` and `JustMyClass/...` from `User-Agent` for YouTube domains so Google does not flag or reject the embed client with Error 153.
- In `onHeadersReceived`:
  - Strip `x-frame-options` and adjust `content-security-policy` `frame-ancestors` returned by YouTube so Chromium never blocks the embedded iframe.

**Step 4: Update `src/lib/youtube.ts` & `DocumentViewerModal.tsx`**
Switch embed player URLs to `https://www.youtube.com/embed/${videoId}?origin=https://www.youtube.com&enablejsapi=1&rel=0` with `referrerPolicy="strict-origin-when-cross-origin"`.

**Step 5: Run tests**
Run: `npm test tests/linkDetection.test.ts`
Expected: PASS

---

### Task 3: Premium Inline YouTube Cards under Links

**Files:**
- Modify: `src/components/YouTubeInlineCard.tsx`
- Modify: `src/components/ClickableText.tsx`
- Modify: `src/components/MarkdownView.tsx`
- Modify: `src/components/CourseOverview.tsx`
- Test: `tests/clickableText.test.ts`

**Step 1: Write test for inline card placement and rendering**
Verify that text with YouTube URLs renders the inline preview card directly below each link rather than at the bottom of the document.

**Step 2: Refine `YouTubeInlineCard.tsx`**
- Show crisp YouTube thumbnail (`i.ytimg.com/vi/.../hqdefault.jpg`) with a sleek gradient play badge.
- Fetch video metadata via oEmbed for real video title and author name.
- When clicked, expand to smooth responsive 16:9 iframe player in-place.
- Buttons for "Tarayıcıda Aç" (ExternalLink SVG) and "Kapat" (X SVG).
- Complete ban on unicode emojis (use only Lucide SVG icons).

**Step 3: Run tests**
Run: `npm test tests/clickableText.test.ts`
Expected: PASS

---

### Task 4: Fix Update Checking Hang ("Sunucu sorgulanıyor...")

**Files:**
- Modify: `electron/services/updateService.ts:615-815`
- Modify: `src/features/settings/SettingsModal.tsx:305-385, 930-985`
- Test: `tests/updateService.test.ts`

**Step 1: Write test for `latest.yml` fallback and timeout behavior**
Verify that update checking completes within 4 seconds even if GitHub API returns 403 or times out.

**Step 2: Enhance `updateService.ts` with Fast Dual-Path Update Check**
- Primary/Fallback fast check: Download `https://github.com/MrSpy00/JustMyClass/releases/latest/download/latest.yml` (direct raw asset, completely immune to GitHub API 60 req/hr rate limits!).
- Parse `version` and SHA-256 / SHA-512 from `latest.yml`.
- If `latest.yml` indicates an update or current version, resolve immediately in <300ms!
- If GitHub API is queried, enforce a strict 4000ms timeout with `electron.net.fetch` (Chromium network stack with native Windows proxy support).
- Never allow `stage: 'checking'` to hang indefinitely: automatically transition to `not-available` or `error` with clear user feedback.

**Step 3: Safeguard `SettingsModal.tsx`**
Add a watchdog timer on the frontend: if `stage === 'checking'` for >4s, clear busy state and show result.

**Step 4: Run tests**
Run: `npm test tests/updateService.test.ts`
Expected: PASS

---

### Task 5: Universal Assistant File Attachments

**Files:**
- Modify: `electron/services/filePreviewService.ts:1460-1663`
- Modify: `electron/main.ts:828-877`
- Modify: `src/layouts/AppLayout.tsx`
- Test: `tests/documentExtraction.test.ts`

**Step 1: Write tests for extended file format extraction**
Cover CSV, TSV, XML, HTML, SVG, Markdown, Code, JSON, Audio/Video files, Archives.

**Step 2: Update `extractUniversalAttachmentText` in `filePreviewService.ts`**
- Add support for media metadata extraction (audio/video duration, format, title).
- Robust UTF-8, UTF-16, Latin1 fallback for text files.
- Full office document support (PDF, DOCX, DOC, PPTX, PPT, XLSX, XLS, ODT, ODS, ODP, RTF).
- Full source code and markup support (`.c`, `.cpp`, `.h`, `.cs`, `.py`, `.js`, `.ts`, `.tsx`, `.java`, `.rs`, `.go`, `.php`, `.rb`, `.swift`, `.kt`, `.dart`, `.sql`, `.sh`, `.bat`, `.ps1`, `.yaml`, `.yml`, `.json`, `.xml`, `.html`, `.css`, `.md`, `.log`, `.ini`, `.env`).
- In `main.ts`: Expand file dialog filters to "Tüm Desteklenen Dosyalar (*.*)" as top option.

**Step 3: Run tests**
Run: `npm test tests/documentExtraction.test.ts`
Expected: PASS

---

### Task 6: Zero Emoji Audit & Premium SVG Icons

**Files:**
- Scan: Entire `src/` and `electron/` for any emoji characters
- Replace any emoji occurrences with clean Lucide React SVGs

**Step 1: Run comprehensive emoji & symbol scanner script**
Ensure zero emojis exist in UI components.

**Step 2: Run all test suites**
Run: `npm test`
Expected: All 36 test files pass (619+ tests).

---

### Task 7: Version Bump, Build Windows Binaries & Release Deployment

**Files:**
- Modify: `package.json` (bump version to `0.1.0`)
- Modify: `src/components/TitleBar.tsx` (reflect `v0.1.0` dynamically or statically)

**Step 1: Purge old 0.0.1 releases and tags**
- Run `gh release delete v0.0.1 -y --cleanup-tag`
- Delete local git tag: `git tag -d v0.0.1` (if present)
- Push tag deletion: `git push origin :refs/tags/v0.0.1` (if remote tag exists)

**Step 2: Git commit and push**
- `git add .`
- `git commit -m "feat: frameless custom TitleBar, fix YouTube player Error 153, inline video preview cards, fast latest.yml update checks, and universal assistant file support"`
- `git push origin main`

**Step 3: Build Windows Binaries**
- Run: `npm run build:win:unsigned`
- Verifies generation of:
  - `release/JustMyClass-Setup-0.1.0-x64.exe`
  - `release/JustMyClass-Portable-0.1.0.exe`
  - `release/latest.yml`

**Step 4: Create new GitHub Release v0.1.0 and upload assets**
- Run `gh release create v0.1.0 release/JustMyClass-Setup-0.1.0-x64.exe release/JustMyClass-Portable-0.1.0.exe release/latest.yml --title "JustMyClass 0.1.0 - Modern Frameless TitleBar, YouTube In-App Player & Universal Attachments" --notes "..."`
