# Client-side export, Chrome only

The backend only exposes the cursor-paginated ID Endpoint and the batch Detail Endpoint, so the browser does all fetching, CSV formatting, and file assembly for an Export of up to ~600K records. This is an internal tool and users are expected to run Google Chrome, so we rely on Chromium-only APIs (OPFS sync access handles, Web Locks) without cross-browser fallbacks.

## Considered Options

- **Backend export job** (server writes the CSV, FE downloads a signed URL): removes tab-lifetime, quota, and PII-at-rest concerns, but the backend will not take on CSV generation.
- **Cross-browser support**: would rule out OPFS sync access handles as the storage path and force an in-memory or IndexedDB-Blob design.

## Consequences

An Export only progresses while a tab of the app is open; closing the tab stops it and recovery relies on the Checkpoint.
