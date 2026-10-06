# One append-only OPFS file per Export

A dedicated worker appends CSV text for each batch to a single Export File in the Origin Private File System, and the Checkpoint in IndexedDB stores only the cursor, bytes written, and records written. This replaces holding the pending buffer as JSON and completed Parts as Blobs in IndexedDB, which re-cloned up to 100K records on every checkpoint and grew memory and main-thread work with export size.

## Consequences

- Memory stays at about one batch window no matter how large the Export is.
- On resume, the file is truncated to the Checkpoint's byte count before appending, so a Checkpoint must be written only after its bytes are flushed.
- Parts are no longer stored. A Part is a byte-range slice of the Export File (offsets recorded every 100K records) with the header prepended, offered for Excel's 1,048,576-row limit.
