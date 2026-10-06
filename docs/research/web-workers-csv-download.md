# Research: Moving the CSV export flow into Web Workers

- Date: 2026-10-05
- Scope: `src/` of this repo, `tech_solution.md`, and primary sources (WHATWG/W3C/WICG specs, MDN, MDN browser-compat-data, Vite docs, Chromium source docs).
- Status: research only. No source code was changed.

---

## TL;DR verdict

**Yes, but the worker is the second fix, not the first.**

1. **The biggest main-thread cost today is not CSV serialization. It is the checkpoint.** Every checkpoint copies the whole pending buffer (`[...buffer.current]`) and then `IDBObjectStore.put()` structured-clones it *synchronously*, inside the `put()` call ([IndexedDB 3.0, "add or put": *"Let clone be a clone of value in targetRealm during transaction"*, which runs before the request is returned](https://w3c.github.io/IndexedDB/#add-or-put)). At production settings (checkpoint every 1,000 records, part every 100,000), that means about 100 clones per part, each growing up to 100K records. A rough Node 24 / M1 Pro micro-benchmark (method below) puts `structuredClone` of 50K records at about 60 ms and 100K at about 115 ms. That is a long task by the [W3C Long Tasks definition (>50 ms)](https://w3c.github.io/longtasks/) on roughly every checkpoint in the second half of each part, about 5 s of blocked main thread per part. A worker *moves* this cost off the UI thread but does not *remove* it. Make the checkpoint append-only first.
2. **CSV serialization (`generateCsvBlob`) is CPU-bound and is a real worker candidate.** It took about 90–120 ms per 100K-record part (16.5 MB of CSV) in the same benchmark: one long task per part, which is worse on slower devices.
3. **Fetching and pagination are I/O-bound.** `fetch` is already async, so a worker gives no throughput gain. Moving the loop still helps because it becomes the natural owner of the buffer, the retry logic and the checkpoints. All of these work in a dedicated worker: `fetch`, IndexedDB, Blob, `URL.createObjectURL`, Streams and OPFS ([MDN: APIs available to workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Functions_and_classes_available_to_workers)).
4. **Saving to disk stays on the main thread.** `showSaveFilePicker` is defined only on `Window` and needs transient user activation ([WICG File System Access](https://wicg.github.io/file-system-access/)). An `<a download>` click needs a DOM, which workers do not have. Send the finished part back to the main thread as a `Blob` (cheap, see below), or read it there from OPFS.
5. **A worker does not make resume more robust against tab close.** A dedicated worker stops being "actively needed" when its owner document stops being fully active, and the UA may terminate it ([HTML §10.2.5 worker lifetime](https://html.spec.whatwg.org/multipage/workers.html#the-worker's-lifetime)). Resume must still rely on IndexedDB or OPFS checkpoints.

---

## 1. What runs on the main thread today

Everything runs on the main thread. There is no worker, no OPFS, no File System Access and no streams.

| Concern | Where | What it does on the main thread |
|---|---|---|
| Fetch loop and pagination | `src/hooks/useDownloadOrchestrator.ts:73-122` | Sequential `mockFetchIds` → `mockFetchDetails` with a cursor, wrapped in `withRetry` (`:26-36`, exponential backoff with `setTimeout`). |
| Mock data generation | `src/mocks/api.ts:72-127` | `sleep()` stands in for network latency (`:46-48`). Record synthesis (`:89-124`) is CPU work, but only in the mock. A real `fetch` would cost `response.json()` parsing instead. |
| In-memory buffer | `useDownloadOrchestrator.ts:40, 56, 78` | `useRef<PropertyRecord[]>`, filled with `push(...properties)`. |
| Progress UI | `useDownloadOrchestrator.ts:82` | `setState` on **every batch** (every 50 records). `tech_solution.md:341` says this is throttled to every 1,000 records, but the code does not throttle. |
| Checkpoint to IDB | `useDownloadOrchestrator.ts:84-97` | `pendingBuffer: [...buffer.current]` (array copy), then `upsertEntry` → `put()` clones the whole entry, including the buffer and the `completedParts` array of Blobs (`src/lib/indexeddb.ts:40-44`). |
| Part sealing | `useDownloadOrchestrator.ts:99-118` | `splice` → `generateCsvBlob` → another full `upsertEntry`, which again copies and clones the remaining buffer. |
| CSV serialization | `src/lib/csv.ts:9-39` | Regex escape per field, `records.map(recordToRow).join('\r\n')`, string concatenation, then `new Blob([...])`. Fully synchronous. |
| Final flush and complete/fail writes | `useDownloadOrchestrator.ts:124-156` | Same pattern. |
| Save to disk | `src/lib/csv.ts:41-50`, `src/components/DownloadOverlay.tsx:16-18` | `URL.createObjectURL` + programmatic `<a download>` click, triggered by a user click on "Download Part N". |
| Resume state | `src/lib/indexeddb.ts` (whole file), `src/App.tsx:29-31, 50-53` | One IDB record per company (`keyPath: companyId`). Stale `in-progress` records are marked `failed` on mount. |
| Runtime config | `src/lib/config.ts:19-23`, `src/components/SettingsPanel.tsx:93` | A **mutable module singleton** that `updateConfig` changes. |

`tech_solution.md:411` already lists "Web Worker for the fetch loop" as a rejected option for the POC because of complexity and auth-token passing. This document revisits that decision with measurements.

### Micro-benchmark (indicative only)

Node v24.15 on an Apple M1 Pro, 100K records shaped like `PropertyRecord`, using the exact `escapeField`/`recordToRow` logic. Run three times:

| Operation | Time |
|---|---|
| `generateCsvBlob` equivalent, 100K rows (16.5 MB) | 90–124 ms |
| `structuredClone` of 100K records | 110–121 ms |
| `structuredClone` of 50K records | 57–68 ms |

Browsers and low-end hardware will differ. Run this in Chrome DevTools Performance before you commit to a design. The ratio is the main point: **one CSV generation per part costs about the same as one late checkpoint, and there are about 100 checkpoints per part.**

---

## 2. Per-feature assessment

| Operation | Bound type | Worker benefit | Notes |
|---|---|---|---|
| ID / detail `fetch` + cursor loop | I/O | Low for speed; medium for architecture | `fetch` is async on both threads. In a worker it removes the per-batch `await` continuations from the main thread and lets the worker own the state. Auth: a same-origin worker sends cookies according to the fetch credentials mode, but an in-memory bearer token must be posted to the worker (`tech_solution.md:411`). |
| `response.json()` parsing (real API) | CPU (small) | Low–medium | Each batch is 50 records, so the cost per call is tiny. It does add up over about 12K calls. |
| Mock record synthesis | CPU | n/a | Only exists in the POC. Move it with the loop so the demo stays representative. |
| Buffer accumulation | Memory | Neutral | Same memory, held in a different heap. Converting each batch to CSV text right away (instead of holding objects) cuts both memory and checkpoint cost. |
| Checkpoint `put()` of the full pending buffer | **CPU (structured clone), O(n) per call, O(n²) per part** | **High if moved, higher if redesigned** | The clone is synchronous in `put()` ([IndexedDB](https://w3c.github.io/IndexedDB/#add-or-put)). IndexedDB is exposed in workers (`Exposed=(Window,Worker)`, same spec). The best fix is an append-only checkpoint (see §3). |
| `generateCsvBlob` | CPU | **High** | About 100 ms per part (measured), and it scales with device speed. Pure function, no DOM: it can move as-is. |
| Large Blob assembly | Memory / IPC | Medium | In Chromium, blob data moves to the browser process and can be paged to disk ([Chromium blob README](https://chromium.googlesource.com/chromium/src/+/HEAD/storage/browser/blob/README.md)). Building `new Blob(chunks)` from many small strings avoids one 16 MB JS string. |
| Sending a sealed part to the main thread | IPC | Cheap | `Blob` is [serializable, not transferable](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects). In Chromium the renderer *"just holds a reference"* and can *"pass it to other processes"* ([Chromium blob README](https://chromium.googlesource.com/chromium/src/+/HEAD/storage/browser/blob/README.md)), so posting a 16 MB Blob does not copy 16 MB on the JS heap. The [File API spec](https://w3c.github.io/FileAPI/) defines serialization by byte sequence, so other engines may differ: verify in Firefox and Safari. |
| Progress `setState` | Render | Indirect | The worker should throttle progress messages (for example per checkpoint or every 250 ms). Each `postMessage` is a structured clone plus a main-thread task. |
| History read / delete / stale marking | I/O, tiny | None | Keep on the main thread (`App.tsx:22-31`). |
| Save to disk (anchor or picker) | User-gated | **Not possible in a worker** | `showSaveFilePicker` is `partial interface Window` and throws `SecurityError` without transient activation ([WICG FSA](https://wicg.github.io/file-system-access/)). Workers have no `document` for `<a download>`. |

---

## 3. Recommended architecture

### 3.1 Step 0, before any worker: make checkpoints append-only

The cost comes from re-cloning everything collected since the last part on every checkpoint. Two options:

- **IDB chunk store.** Add an object store, for example `chunks` keyed `[companyId, partNumber, chunkIndex]`, holding the **CSV text** of each 1,000-record window. The main history record keeps only small metadata: `{cursor, partNumber, chunkCount, total}`. Sealing a part becomes `new Blob(chunkStrings)`, followed by deleting those chunks. Each checkpoint then clones about 160 KB of string instead of up to 100K objects. This needs a `DB_VERSION` bump in `src/lib/indexeddb.ts:5`.
- **OPFS append file per part** (best fit once a worker exists, see 3.3).

This change alone removes most of the O(n²) cost, on either thread.

### 3.2 Thread split

```
Main thread (React)                          export.worker.ts (dedicated, module)
-------------------                          ------------------------------------
Settings, History, Overlay UI                fetch loop + withRetry + cursor
useDownloadOrchestrator  --start/resume-->   buffer -> CSV text per batch
  (thin: postMessage + state)                append-only checkpoint (IDB/OPFS)
                         <--progress------   seal part -> Blob (or OPFS file)
                         <--part-sealed---   (Blob, recordCount, partNumber)
                         <--done/failed---
click "Download Part N" -> createObjectURL + <a download>   (or showSaveFilePicker)
```

The **main thread keeps**: all React state, the overlay, settings UI, history reads, the stale-entry sweep on mount, and every user-activated save. The **worker owns**: the loop, the buffer, serialization and checkpoint writes. The worker is the *only writer* to the active company's record during a run, which avoids racing two IDB connections.

### 3.3 Message protocol (sketch)

```ts
// main -> worker
type ToWorker =
  | { type: 'start';  company: Company; config: AppConfig; authToken?: string }
  | { type: 'resume'; companyId: string; config: AppConfig; authToken?: string } // worker reads checkpoint from IDB itself
  | { type: 'cancel' };

// worker -> main
type FromWorker =
  | { type: 'progress'; recordsProcessed: number; currentPart: number }          // throttled
  | { type: 'part-sealed'; partNumber: number; recordCount: number; blob?: Blob } // or OPFS file name
  | { type: 'done'; total: number }
  | { type: 'failed'; message: string; cursor: string | null };
```

Notes:
- **Pass `config` in the message.** The worker gets its own instance of `src/lib/config.ts`, so `updateConfig` calls from `SettingsPanel.tsx:93` on the main thread never reach it. Functions cannot be cloned ([MDN structured clone, `DataCloneError`](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)), so send plain data only.
- **For resume, send the key, not the entry.** Sending `HistoryEntry` with its `pendingBuffer` (`useDownloadOrchestrator.ts:180-191`) would clone the whole buffer across threads again. Let the worker read IndexedDB directly.
- `src/lib/indexeddb.ts` and `src/lib/csv.ts` (except `triggerDownload`) have no DOM dependency and can be imported by the worker as they are. `src/lib/indexeddb.ts:8` opens the DB at module load, which works in workers because IDB is exposed there.

### 3.4 Storage options for parts (pick one)

| Option | How | Pros | Cons |
|---|---|---|---|
| A. Blob in IDB (current model) | Worker builds `Blob`, stores it in IDB, posts it to main | Smallest change; cross-browser | IDB quota (`tech_solution.md:344` estimates about 180 MB) |
| B. OPFS + sync access handle | Worker opens `parts/{company}_{n}.csv` via `navigator.storage.getDirectory()` and calls `createSyncAccessHandle()`, which is **dedicated-worker-only** (`[Exposed=DedicatedWorker]`, [WHATWG fs](https://fs.spec.whatwg.org/); [MDN](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle)). Each batch is `write(TextEncoder bytes, {at})`, then `flush()`. The checkpoint is `{cursor, part, byteOffset}`. On resume, `truncate(byteOffset)`. | Lowest memory (nothing large in the JS heap); true append; precise resume | The handle holds an **exclusive lock** until `close()` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle)); still uses origin quota ([MDN OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)). The checkpoint metadata write (IDB) and the byte write (OPFS) are not atomic, so resume must truncate to the recorded offset. |
| C. Stream directly to a user file (Chromium only) | The main thread calls `showSaveFilePicker()` inside the click handler, then posts the `FileSystemFileHandle` to the worker (handles are serializable, same-origin only, [WHATWG fs](https://fs.spec.whatwg.org/)). The worker calls `createWritable()` (exposed in workers) and writes as it goes. | No quota; no "Download Part N" step | `showSaveFilePicker` support: Chrome/Edge 86+, **no Firefox, no Safari** ([MDN BCD](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)); one picker prompt per file; resuming in a later session needs the handle persisted and permission granted again |

**Recommendation: A first, together with Step 0. Move to B if memory or quota becomes the bottleneck at 600K records.** Treat C as an optional progressive enhancement.

To export from OPFS (option B), the main thread (or the worker) calls `fileHandle.getFile()`, which returns a `File` (a Blob). Then use the existing `triggerDownload`.

### 3.5 Transferable streams: not needed

`ReadableStream`/`WritableStream` are transferable in principle ([MDN Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)), but support is uneven according to [MDN browser-compat-data](https://github.com/mdn/browser-compat-data): `ReadableStream` transferable in Chrome 87, Firefox 103, **Safari 27**; `WritableStream` transferable in Chrome 87, Firefox 103, **Safari: not supported**. The design above sends sealed `Blob`s or OPFS file names, so it needs no stream transfer. `ArrayBuffer` *is* transferable with zero copy, which helps only if you post raw encoded bytes.

### 3.6 Vite wiring

- The recommended form is `new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' })`. `?worker`, `?worker&inline` and `?worker&url` imports are alternatives ([Vite: Web Workers](https://vite.dev/guide/features.html#web-workers)). In dev, imports inside the worker rely on native module-worker support. For production *"it is compiled away"* (same page).
- `worker.format` defaults to `'iife'` (`'es' | 'iife'`) ([Vite worker options](https://vite.dev/config/worker-options.html)). Set `'es'` if the worker needs code splitting. Workers also need their own `worker.plugins`.
- Module workers (`type: 'module'`) are supported in Chrome 80, Firefox 114 and Safari 15 ([MDN BCD `Worker` `ecmascript_modules`](https://github.com/mdn/browser-compat-data/blob/main/api/Worker.json)).
- TypeScript: `tsconfig.app.json:5` has `"lib": ["ES2023", "DOM"]`. The worker file wants `WebWorker` types, typically through a separate tsconfig or a `/// <reference lib="webworker" />` in the worker file.
- React 19 `<StrictMode>` (`src/main.tsx:7`) double-invokes effects in dev. If the worker is created in an effect, `terminate()` it in cleanup, or create it lazily on start, so you never run two loops.

### 3.7 Comlink (optional)

[Comlink](https://github.com/GoogleChromeLabs/comlink) (about 1.1 kB brotli) wraps `postMessage` in an RPC/proxy API, with `Comlink.transfer()` for transferables and `Comlink.proxy()` for callbacks such as `onProgress`. The protocol here has 3 inbound and 4 outbound message types, so a hand-written discriminated union is enough. Use Comlink only if the worker API grows.

---

## 4. Browser-support caveats

From [MDN browser-compat-data](https://github.com/mdn/browser-compat-data) (fetched 2026-10-05). Edge mirrors Chrome.

| Feature | Chrome | Firefox | Safari |
|---|---|---|---|
| Module workers (`type:'module'`) | 80 | 114 | 15 |
| `FileSystemSyncAccessHandle` (OPFS, worker-only) | 102 | 111 | 15.2 |
| `StorageManager.getDirectory()` (OPFS root) | 86 | 111 | 15.2 |
| `FileSystemWritableFileStream` (`createWritable`) | 86 | 111 | 26 |
| `Window.showSaveFilePicker` | 86 | No | No |
| Transferable `ReadableStream` | 87 | 103 | 27 |
| Transferable `WritableStream` | 87 | 103 | No |
| `StorageManager.persist()` | 55 | 57 | 15.2 |
| Background Fetch | 74 | No | No |

OPFS and `showSaveFilePicker` require a secure context ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)). `localhost` counts as secure in dev.

---

## 5. Resumability and lifetime

- **A worker can own resume state at runtime**, because IndexedDB and OPFS are both available to it. The *durable* state must still live in storage.
- **Tab close kills the worker.** A dedicated worker's lifetime follows its owner document. Once that document is no longer fully active, the worker stops being actively needed, its `closing` flag is set, and the UA *"may invoke the terminate a worker algorithm"* ([HTML workers](https://html.spec.whatwg.org/multipage/workers.html#the-worker's-lifetime)). The current recovery logic (`markStaleInProgressAsFailed`, `src/lib/indexeddb.ts:63-70`) stays necessary and correct.
- **Blob URLs created in the worker die with it.** The File API removes blob-URL-store entries whose environment is unloaded ([W3C File API](https://w3c.github.io/FileAPI/)). Post the `Blob` to the main thread and create the URL there, as `triggerDownload` already does.
- **Workers are heavyweight:** *"expected to be long-lived, have a high start-up performance cost, and a high per-instance memory cost"* ([HTML workers](https://html.spec.whatwg.org/multipage/workers.html)). Use one worker per export, not one per batch.
- **Surviving tab close (alternatives, both with caveats):**
  - *Service Worker*: lifetime *"is tied to the execution lifetime of events"*, and the UA may terminate it when it *"has no event to handle"* ([W3C Service Workers](https://w3c.github.io/ServiceWorker/)). It cannot reliably run a 40-minute loop.
  - *Background Fetch*: lets fetches *"continue even if the user closes all windows & workers to the origin"*, but it is a WICG draft, *"not a W3C Standard"* ([WICG Background Fetch](https://wicg.github.io/background-fetch/)), and Chromium-only. It also fits a known list of URLs, not a cursor chain where each request depends on the previous response.

---

## 6. Risks and trade-offs

| Risk / cost | Mitigation |
|---|---|
| More moving parts: a message protocol, two module graphs, two tsconfigs | Keep the worker API small (§3.3); share `lib/` modules |
| Config drift: the worker has its own `config` singleton | Send config in `start`/`resume`; treat it as immutable for the run |
| Two IDB writers race on the same record | The worker is the sole writer during a run; the main thread only reads |
| Progress message spam causes render pressure | Throttle in the worker |
| A worker alone does not fix the O(n²) checkpoint (it only hides it) and still burns CPU and battery | Do Step 0 (append-only) first |
| Debugging is harder (separate DevTools context, errors arrive via `onerror`/`messageerror`) | Send structured `failed` messages; listen for `messageerror` |
| OPFS lock contention (option B), for example in a second tab | Close handles on seal and on cancel; consider a single-tab guard |
| Blob clone cost differs across engines | Measure in Firefox and Safari |
| Auth token in the worker | Post it at start; refresh it through a message if it expires mid-run |

---

## 7. Open questions

1. How does `put()` with a `completedParts` array of Blobs (`useDownloadOrchestrator.ts:92`) behave on each checkpoint? Does the engine re-copy Blob bytes or keep a reference? The spec allows either as long as the difference is not observable ([IndexedDB note "Why create a copy of the value?"](https://w3c.github.io/IndexedDB/#add-or-put)). Measure this in Chrome and Firefox.
2. What is the real API's response size and `json()` parse time at 50 records? This decides whether parsing in the worker matters.
3. Should two tabs be prevented from exporting the same company at once? Neither the current code nor a dedicated worker prevents it.
4. Is it acceptable that Option C (direct-to-disk) works only in Chromium, given the user base?
5. With OPFS, how should a part that is half-written in OPFS but missing its IDB checkpoint be reconciled after a crash? (Proposed: truncate to the last recorded offset.)
6. Should `navigator.storage.persist()` be requested to reduce eviction risk for multi-hundred-MB exports?

---

## Sources

- WHATWG HTML Living Standard, Web workers (lifetime, module workers, cost note): https://html.spec.whatwg.org/multipage/workers.html
- W3C Indexed Database API 3.0, "add or put" (synchronous clone), `Exposed=(Window,Worker)`: https://w3c.github.io/IndexedDB/#add-or-put
- WHATWG File System Standard (OPFS, `createSyncAccessHandle` `[Exposed=DedicatedWorker]`, serializable handles): https://fs.spec.whatwg.org/
- WICG File System Access (`showSaveFilePicker` on `Window`, transient activation): https://wicg.github.io/file-system-access/
- W3C File API (Blob serialization, blob URL lifetime, `createObjectURL` exposure): https://w3c.github.io/FileAPI/
- W3C Long Tasks API (50 ms threshold): https://w3c.github.io/longtasks/
- W3C Service Workers (event-tied lifetime): https://w3c.github.io/ServiceWorker/
- WICG Background Fetch: https://wicg.github.io/background-fetch/
- MDN, Functions and classes available to workers: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Functions_and_classes_available_to_workers
- MDN, Transferable objects: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
- MDN, Structured clone algorithm: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
- MDN, `FileSystemFileHandle.createSyncAccessHandle()`: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle
- MDN, Origin private file system: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- MDN, `Window.showSaveFilePicker()`: https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker
- MDN, `ReadableStream` (transferable): https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream
- MDN browser-compat-data (support versions in §4): https://github.com/mdn/browser-compat-data
- Chromium, Blob storage system README: https://chromium.googlesource.com/chromium/src/+/HEAD/storage/browser/blob/README.md
- Vite, Features → Web Workers: https://vite.dev/guide/features.html#web-workers
- Vite, Worker options: https://vite.dev/config/worker-options.html
- Comlink: https://github.com/GoogleChromeLabs/comlink
