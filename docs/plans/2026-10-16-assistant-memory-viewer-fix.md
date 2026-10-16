# Assistant UI, Memory, Auto-Sync, Resilient Tools & Premium Inline Viewer Implementation Plan

> **For Claude / Antigravity:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all assistant UI clipping and auto-scroll bugs, eliminate HTTP 429 and 413 payload errors with resilient retries and smart token pruning, implement automatic connection sync on auth detection, build a comprehensive multi-format in-app inline document viewer, update LM Studio branding to "LM Studio (Bionic)", ground web searches with real-time temporal accuracy against hallucinations, and advance JustMyClass Dual Memory & Chat History.

**Architecture:** 
1. **Assistant UI & Auto-Scroll:** Restructure `<aside>` layout with fixed bottom composer (`shrink-0`), dynamic `min-h-0 flex-1` scroll area, `chatEndRef` with `ResizeObserver` for pinning auto-scroll across message additions, streaming tokens, tool approvals, and errors.
2. **Auto-Sync on Connect:** Fix stale closure in `AppLayout.tsx` by using live account reference/API check; auto-trigger background sync immediately upon account authentication and on app startup without manual clicks.
3. **Resilient HTTP & Tool Loop (Fixing 429 & 413):** Protect all rounds of tool execution in `aiOrchestrator.ts` with exponential backoff (1.5s, 3s, 6s), enforce smart conversation pruning (compressing oversized tool outputs to <= 16KB), strip redundant raw PDF base64 once text is extracted, and catch 413/429 with transparent downscaling.
4. **Temporal Grounding & Anti-Hallucination:** Inject current real-time date (`2026-10-16`), sanitize/augment web search queries to target 2026/current data, and enforce strict negative constraints against synthetic paths or hallucinated data.
5. **Multi-Format In-App Inline Viewer:** Overhaul `DocumentViewerModal.tsx` and `filePreviewService.ts` to support code (50+ languages with syntax highlighting, search, line numbers, wrapping, font zoom), PDFs (embedded viewer + text extraction), Word DOCX (formatted paragraph/heading rendering), PPTX (interactive slide deck carousel), Excel/CSV (sortable/searchable data grid), Markdown, images (zoom/rotate), and media with theme-adaptive glassmorphism UI and "Asistan ile İncele" integration.
6. **JustMyClass Dual Memory & Chat History:** Seamless global (Taste) + session-specific memory syncing, auto-loading session memory on switch, chat search/rename/delete, and sliding-window token management.
7. **LM Studio Branding:** Rename "LM Studio" to "LM Studio (Bionic)" across settings, catalog, model picker, and docs.

**Tech Stack:** React 19, TypeScript 5.8, Tailwind CSS v4, Electron 35, Node.js Buffer/crypto, Vitest.

---

### Task 1: Assistant UI Layout & Pinning Auto-Scroll Engine

**Files:**
- Modify: `src/layouts/AppLayout.tsx`
- Modify: `src/index.css` (if custom scroll or keyframes needed)
- Test: `tests/assistantLayoutAndScroll.test.ts`

**Step 1: Write the failing test**
Create `tests/assistantLayoutAndScroll.test.ts` verifying:
1. Auto-scroll triggers on new message, streaming chunk, and error state.
2. Chat history switching triggers scroll-to-bottom and resets scroll flags.
3. Chat layout container classes ensure composer form does not clip or overflow viewport.

**Step 2: Run test to verify it fails**
Run: `npm test tests/assistantLayoutAndScroll.test.ts`
Expected: FAIL (file or tests not yet existing/passing).

**Step 3: Implement minimal implementation**
1. In `src/layouts/AppLayout.tsx`:
   - Add `chatEndRef = useRef<HTMLDivElement | null>(null)`.
   - Implement `scrollToBottom(behavior: 'auto' | 'smooth')` that scrolls both `chatScrollRef.current` and calls `chatEndRef.current?.scrollIntoView({ behavior, block: 'end' })`.
   - Setup a `ResizeObserver` on `chatScrollRef.current` so whenever content grows (markdown render, images, tool cards, reasoning expansion), it pins to bottom if `chatStuckRef.current` is true.
   - Set `chatStuckRef.current = true` whenever user sends a message, and after generating completes or errors out.
   - Fix assistant panel flex structure:
     - Header: `shrink-0`
     - Messages scroll area: `min-h-0 flex-1 overflow-y-auto overflow-x-hidden`
     - Quick prompts: `shrink-0`
     - Chat attachment badge: `shrink-0`
     - Form container: `shrink-0 border-t bg-[var(--jmc-bg-elevated)] pb-3 pt-2 px-3.5`
     - Ensure parent container has `h-full max-h-screen overflow-hidden`.
   - In `catch (err)` block of `handleSendMessage`, call `scrollToBottom('smooth')` so error messages are never hidden below view.

**Step 4: Run test to verify it passes**
Run: `npm test tests/assistantLayoutAndScroll.test.ts`
Expected: PASS.

**Step 5: Commit**
`git add src/layouts/AppLayout.tsx tests/assistantLayoutAndScroll.test.ts`
`git commit -m "fix: resolve assistant panel clipping and implement reliable auto-scroll"`

---

### Task 2: Automatic Sync on Connection & Stale Closure Fix

**Files:**
- Modify: `src/layouts/AppLayout.tsx`
- Modify: `src/features/auth/AuthOnboardingModal.tsx`
- Modify: `src/App.tsx`
- Test: `tests/autoSyncOnConnect.test.ts`

**Step 1: Write the failing test**
Create `tests/autoSyncOnConnect.test.ts` verifying that `handleSyncAll` works even if called when React state `account` is initially pending, using fresh account fetch, and that connection event initiates auto-sync.

**Step 2: Run test to verify it fails**
Run: `npm test tests/autoSyncOnConnect.test.ts`
Expected: FAIL.

**Step 3: Implement minimal implementation**
1. In `src/layouts/AppLayout.tsx`:
   - In `handleSyncAll`, instead of bailing if `!account`, check `const activeAcc = account || (await window.jmcAPI.getAccount())`. If neither exists, then prompt `onOpenAuth()`.
   - In `onAccountChanged` listener:
     - Await fresh account.
     - Immediately invoke `handleSyncAll()` in background without waiting for user action.
   - On initial mount:
     - Check if account exists. If account exists and courses are empty or sync is needed, automatically kick off `handleSyncAll()`.
   - In `src/App.tsx`:
     - In `handleLoginSuccess`: after dispatching `ACCOUNT_CHANGED_EVENT`, notify user that synchronization has started automatically.

**Step 4: Run test to verify it passes**
Run: `npm test tests/autoSyncOnConnect.test.ts`
Expected: PASS.

**Step 5: Commit**
`git add src/layouts/AppLayout.tsx src/App.tsx tests/autoSyncOnConnect.test.ts`
`git commit -m "feat: automatic synchronization on account connection without manual button clicks"`

---

### Task 3: Resilient AI Orchestrator: Fix HTTP 429 & HTTP 413, Multi-Round Tool Safety

**Files:**
- Modify: `electron/services/ai/aiOrchestrator.ts`
- Modify: `electron/services/toolDispatcher.ts`
- Test: `tests/aiResiliencePayloadAndRateLimit.test.ts`

**Step 1: Write the failing test**
Create `tests/aiResiliencePayloadAndRateLimit.test.ts` testing:
1. Tool loop round > 0 handles 429 with exponential backoff and retry instead of crashing.
2. Large tool outputs (> 30KB) are pruned and summarized to prevent HTTP 413.
3. Formatted user message downsamples base64 document attachments if extracted text is already available.
4. Error formatter returns user-friendly localized messages without raw IPC unhandled exceptions.

**Step 2: Run test to verify it fails**
Run: `npm test tests/aiResiliencePayloadAndRateLimit.test.ts`
Expected: FAIL.

**Step 3: Implement minimal implementation**
1. In `electron/services/ai/aiOrchestrator.ts`:
   - Create `executeStreamCallWithRetry`: wraps `executeStreamCall` with exponential backoff for transient 429, 502, 503, 504 errors (retries up to 3 times: 1.5s, 3s, 6s).
   - Use `executeStreamCallWithRetry` for BOTH round 0 AND round > 0 in the tool loop.
   - In `formatUserMessageWithAttachments`:
     - If document has `extractedText` (PDF or DOCX), omit heavy `base64Data` from inlineData parts if total payload size would exceed safe limit (e.g. 500KB), keeping text representation.
   - In `formatToolResultsForModel`:
     - Truncate individual tool output strings to max 16,000 characters with `\n[...Metnin devamı kısaltıldı...]` to prevent payload explosion across multiple tool rounds.
   - If an `HttpError: 413` occurs, catch it and automatically prune `conversation` history (truncate earlier assistant/user messages to last 4 turns and 4,000 chars each) and retry once automatically!
   - In `electron/services/toolDispatcher.ts`:
     - Limit `workspace_read_open_file` raw output to 20,000 chars instead of 60,000 chars.

**Step 4: Run test to verify it passes**
Run: `npm test tests/aiResiliencePayloadAndRateLimit.test.ts`
Expected: PASS.

**Step 5: Commit**
`git add electron/services/ai/aiOrchestrator.ts electron/services/toolDispatcher.ts tests/aiResiliencePayloadAndRateLimit.test.ts`
`git commit -m "fix: prevent HTTP 429 rate limit and HTTP 413 payload too large errors with resilient retries and smart pruning"`

---

### Task 4: Real-Time Temporal Grounding, Anti-Hallucination & Web Search Accuracy

**Files:**
- Modify: `electron/services/ai/aiOrchestrator.ts`
- Modify: `electron/services/toolDispatcher.ts`
- Test: `tests/temporalGrounding.test.ts`

**Step 1: Write the failing test**
Create `tests/temporalGrounding.test.ts` testing:
1. `buildSystemPrompt` injects exact current timestamp (`2026-10-16`), current year `2026`, and strict anti-hallucination rules.
2. Web search queries with outdated years (2022-2024) in the context of recent/current queries are normalized to 2026.
3. Anti-hallucination guard forbids fake file paths or placeholder answers.

**Step 2: Run test to verify it fails**
Run: `npm test tests/temporalGrounding.test.ts`
Expected: FAIL.

**Step 3: Implement minimal implementation**
1. In `electron/services/ai/aiOrchestrator.ts`:
   - Enhance `buildSystemPrompt`:
     - Embed explicit high-priority block:
       ```
       ZAMAN VE GÜNCELLİK ÇAPASI (GÜNCEL YIL: 2026):
       - Şu anki gerçek tarih: 16 Ekim 2026.
       - Eski eğitim verilerine veya 2023-2024 yıllarına takılı kalma.
       - İnternet aramalarında her zaman 2026 ve en güncel verileri hedefle.
       - ASLA uydurma (placeholder), varsayımsal dosya yolu ("C:\Users\...", "/home/...") veya hayali notlar üretme.
       - Bilgi yoksa veya araç sonucunda bulunamadıysa 'kaynakta yer almıyor' olarak dürüstçe bildir.
       ```
2. In `electron/services/toolDispatcher.ts`:
   - In `performWebSearch(query)`:
     - Check if `query` contains past years like `2023` or `2024` together with words like "güncel", "son", "latest", "current", "yeni". Replace them with current year `2026` or append current year for freshness.

**Step 4: Run test to verify it passes**
Run: `npm test tests/temporalGrounding.test.ts`
Expected: PASS.

**Step 5: Commit**
`git add electron/services/ai/aiOrchestrator.ts electron/services/toolDispatcher.ts tests/temporalGrounding.test.ts`
`git commit -m "feat: real-time temporal grounding and anti-hallucination guardrails for web search and model generation"`

---

### Task 5: Document Download Resiliency & Drive Fallback

**Files:**
- Modify: `electron/services/driveService.ts`
- Modify: `electron/services/filePreviewService.ts`
- Modify: `src/layouts/AppLayout.tsx`
- Test: `tests/driveDownloadResilience.test.ts`

**Step 1: Write the failing test**
Create `tests/driveDownloadResilience.test.ts` testing:
1. When Drive v3 metadata call receives 403, it falls back to direct export endpoints (`docs.google.com/.../export?format=pdf` etc.).
2. When downloading an attachment with `alternateLink` (Google Docs/Sheets/Slides), file ID is parsed from all Google URL variants.
3. `handleDownloadAttachment` in `AppLayout.tsx` displays informative progress and doesn't fail silently if course is not yet selected.

**Step 2: Run test to verify it fails**
Run: `npm test tests/driveDownloadResilience.test.ts`
Expected: FAIL.

**Step 3: Implement minimal implementation**
1. In `electron/services/driveService.ts`:
   - Expand file ID extraction regex to handle all Google Drive, Classroom, Docs, Sheets, Slides, and Forms URLs.
   - In `downloadAttachment`:
     - If `files.get` returns 403 / permission error, attempt fallback direct export using Google Docs/Sheets/Slides export URL with access token.
     - Add fallback for public/domain-shared links via `https://drive.google.com/uc?id=${fileId}&export=download`.
     - In CAS save: preserve accurate mime type and extension.
2. In `src/layouts/AppLayout.tsx`:
   - In `handleDownloadAttachment`: if `!selectedCourse`, resolve `courseId` from `att` or first course.

**Step 4: Run test to verify it passes**
Run: `npm test tests/driveDownloadResilience.test.ts`
Expected: PASS.

**Step 5: Commit**
`git add electron/services/driveService.ts electron/services/filePreviewService.ts src/layouts/AppLayout.tsx tests/driveDownloadResilience.test.ts`
`git commit -m "fix: add multi-tier fallback for Google Drive document downloads and preview caching"`

---

### Task 6: Premium Multi-Format In-App Inline Document Viewer

**Files:**
- Modify: `src/components/DocumentViewerModal.tsx`
- Modify: `electron/services/filePreviewService.ts`
- Modify: `src/types/jmc.ts`
- Test: `tests/documentViewerModal.test.ts`

**Step 1: Write the failing test**
Create `tests/documentViewerModal.test.ts` testing:
1. Preview generation for code files supports 50+ languages with line counts.
2. Word DOCX, PPTX slide deck, CSV data tables, Markdown, and PDF formats return structured preview data.
3. DocumentViewerModal renders code viewer with line numbers, search, word wrap, copy, and font size.
4. DocumentViewerModal renders slide deck carousel with Next/Prev and slide numbers.
5. DocumentViewerModal renders data table with search and pagination.
6. "Asistan ile İncele" button sends preview context to active assistant context.

**Step 2: Run test to verify it fails**
Run: `npm test tests/documentViewerModal.test.ts`
Expected: FAIL.

**Step 3: Implement minimal implementation**
1. In `electron/services/filePreviewService.ts`:
   - Add support for all modern code extensions (TypeScript, JS, Python, C, C++, C#, Java, Go, Rust, Ruby, PHP, Dart, Kotlin, Swift, HTML, CSS, SCSS, SQL, Shell, YAML, JSON, TOML, Dockerfile, etc.).
   - Support rich DOCX extraction (structured paragraphs and headings).
   - Support PPTX slide extraction (slide titles and bullet points).
   - Support CSV/TSV table parsing with delimiter detection.
   - Support PDF dataUrl generation for embedded iframe rendering + extracted text fallback.
   - For web/external links, provide embedded iframe/webview preview payload.
2. In `src/components/DocumentViewerModal.tsx`:
   - Redesign with premium UI (glassmorphism header, responsive canvas, dark/light theme integration).
   - **Code Viewer**: Line numbers, search query highlighting, word wrap toggle, font size buttons (11px, 13px, 15px, 17px), syntax badge, copy all / copy selection.
   - **PDF Viewer**: Embedded native PDF renderer `<iframe src={preview.dataUrl} className="w-full h-full border-0" />` with toggle to extracted text mode and search.
   - **Word DOCX Viewer**: Visual document page mode with formatted headings, stylized paragraphs, and clean typography.
   - **Presentation PPTX Viewer**: Interactive slide deck with slide counter, next/previous slide controls, keyboard arrow navigation, slide card animations.
   - **Data Spreadsheet Viewer**: Interactive table with sticky headers, search filter across all rows/columns, row count badge, and clean table borders.
   - **Markdown Viewer**: Live rendered markdown with MarkdownView component + raw source toggle.
   - **Image Viewer**: Zoom in/out, 90-degree rotate, reset zoom, checkered transparency background.
   - **Media Viewer**: Audio/Video HTML5 player with styled controls.
   - **Asistan ile İncele**: One-click action sending content directly to assistant prompt without copy-pasting.

**Step 4: Run test to verify it passes**
Run: `npm test tests/documentViewerModal.test.ts`
Expected: PASS.

**Step 5: Commit**
`git add src/components/DocumentViewerModal.tsx electron/services/filePreviewService.ts src/types/jmc.ts tests/documentViewerModal.test.ts`
`git commit -m "feat: comprehensive premium in-app inline document viewer for all file extensions and formats"`

---

### Task 7: JustMyClass Dual Memory (Taste & Session) & Multi-Session Chat History

**Files:**
- Modify: `electron/services/ai/memoryService.ts`
- Modify: `electron/services/ai/chatSessionService.ts`
- Modify: `src/layouts/AppLayout.tsx`
- Test: `tests/memoryAndChatHistory.test.ts`

**Step 1: Write the failing test**
Update `tests/memoryAndChatHistory.test.ts` testing:
1. Switching sessions automatically loads that session's private memory and restores course context.
2. Memory prompt correctly formats both Global Taste preferences and session-specific memory with strict adherence instructions.
3. Auto-memory extraction recognizes student study rules, departments, and focus topics.
4. Sessions can be renamed, searched, deleted, and created without state inconsistency.

**Step 2: Run test to verify it fails**
Run: `npm test tests/memoryAndChatHistory.test.ts`
Expected: FAIL (or verify new assertions fail).

**Step 3: Implement minimal implementation**
1. In `electron/services/ai/memoryService.ts`:
   - Expand `autoExtractMemories` with broader student preferences (e.g. language preference, formatting preferences like "Türkçe açıkla", "özet geç", "adım adım anlat").
   - Structure `getFormattedMemoryPrompt` with clear Global Profile (Taste) section and Session Memory section.
2. In `src/layouts/AppLayout.tsx`:
   - In `handleSwitchSession`:
     - Switch `currentSessionId`.
     - Load session's messages.
     - Call `void loadMemory()`.
     - If session has `courseId`, select that course to restore context.
   - Add search filter to Chat History drawer.
   - Auto-generate intelligent titles for new chats based on first prompt.

**Step 4: Run test to verify it passes**
Run: `npm test tests/memoryAndChatHistory.test.ts`
Expected: PASS.

**Step 5: Commit**
`git add electron/services/ai/memoryService.ts electron/services/ai/chatSessionService.ts src/layouts/AppLayout.tsx tests/memoryAndChatHistory.test.ts`
`git commit -m "feat: complete JustMyClass dual memory and multi-session chat history system"`

---

### Task 8: LM Studio (Bionic) Branding & Model Picker Refinements

**Files:**
- Modify: `src/features/settings/SettingsModal.tsx`
- Modify: `electron/services/ai/aiOrchestrator.ts`
- Modify: `src/components/icons/ProviderIcon.tsx`
- Modify: `src/components/ModelPicker.tsx`
- Test: `tests/lmStudioBranding.test.ts`

**Step 1: Write the failing test**
Create `tests/lmStudioBranding.test.ts` verifying that LM Studio displayName is "LM Studio (Bionic)" across the orchestrator, settings, and provider icon mappings.

**Step 2: Run test to verify it fails**
Run: `npm test tests/lmStudioBranding.test.ts`
Expected: FAIL.

**Step 3: Implement minimal implementation**
- Update all occurrences of "LM Studio" to "LM Studio (Bionic)" in settings labels, guides, and orchestrator provider catalog.
- Ensure `ProviderIcon.tsx` recognizes "lmstudio" and "bionic" brands with updated tooltip and SVG rendering.

**Step 4: Run test to verify it passes**
Run: `npm test tests/lmStudioBranding.test.ts`
Expected: PASS.

**Step 5: Commit**
`git add src/features/settings/SettingsModal.tsx electron/services/ai/aiOrchestrator.ts src/components/icons/ProviderIcon.tsx src/components/ModelPicker.tsx tests/lmStudioBranding.test.ts`
`git commit -m "feat: update LM Studio branding to LM Studio (Bionic)"`

---

### Task 9: Full Integration Verification & Build Verification

**Files:**
- All modified files
- Run: `npm run typecheck`
- Run: `npm test`
- Run: `npm run build`

**Step 1: Typecheck**
Run: `npm run typecheck`
Expected: 0 errors.

**Step 2: Run full test suite**
Run: `npm test`
Expected: All tests pass.

**Step 3: Run production build**
Run: `npm run build` (or Vite build)
Expected: Clean build without errors.
