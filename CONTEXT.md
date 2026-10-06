# CSV Bulk Export

Internal tool that exports every record belonging to a Company as CSV, entirely in the browser, from a backend that only serves paginated lists.

## Language

**Company**:
The owner whose records are exported; one Export is made per Company at a time.

**Export**:
One run that collects all records of a Company into a CSV, from start until completed or abandoned. At most one Export per Company is kept; starting again replaces it.
_Avoid_: Download, job, history entry

**Export File**:
The single CSV that an Export writes into as records arrive.
_Avoid_: Combined CSV, merged file

**Part**:
A slice of a completed Export File, each up to 100,000 records with its own header row, offered so each slice fits in a spreadsheet.
_Avoid_: Chunk, split

**Checkpoint**:
The last saved position of an Export, from which it can resume without re-fetching earlier records.
_Avoid_: Snapshot, save point

**Cursor**:
The opaque token from the ID Endpoint that says where the next page of IDs starts.
_Avoid_: isNext, offset, page token

### Export status

**Running**:
An Export whose tab is actively fetching and writing records.

**Paused**:
A Running Export waiting for the network to return; it continues on its own.

**Interrupted**:
An Export that stopped before finishing — its tab closed or crashed, or the server stopped responding — and that the user may resume from its Checkpoint.
_Avoid_: Stale, failed (for this case)

**Failed**:
An Export that cannot continue from its Checkpoint and must be started over.

**Completed**:
An Export whose Export File holds every record of the Company.

**History**:
The list of the most recent Exports (max 3) shown to the user.
