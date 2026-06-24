import type { HistoryEntry, CompletedPart } from '../types';
import { triggerDownload } from '../lib/csv';

interface Props {
  entries: HistoryEntry[];
  activeCompanyId: string;
  onResume: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => void;
}

const STATUS_LABEL: Record<HistoryEntry['status'], string> = {
  'in-progress': 'In Progress',
  completed: 'Completed',
  failed: 'Failed',
};

function HistoryItem({
  entry,
  isActive,
  onResume,
  onDelete,
}: {
  entry: HistoryEntry;
  isActive: boolean;
  onResume: (e: HistoryEntry) => void;
  onDelete: (e: HistoryEntry) => void;
}) {
  function handleDownloadPart(part: CompletedPart) {
    triggerDownload(part.blob, `${entry.companyName.replace(/\s+/g, '_')}_part_${part.partNumber}.csv`);
  }

  return (
    <div className={`history-item ${entry.status}`}>
      <div className="history-item-header">
        <span className="history-company">{entry.companyName}</span>
        <div className="history-item-header-right">
          <span className={`status-badge status-${entry.status}`}>
            {isActive ? 'Downloading…' : STATUS_LABEL[entry.status]}
          </span>
          <button
            className="btn btn-ghost btn-icon"
            title="Delete"
            disabled={isActive}
            onClick={() => onDelete(entry)}
          >
            ×
          </button>
        </div>
      </div>

      <p className="history-meta">
        {entry.totalRecordsProcessed.toLocaleString()} records
        {entry.completedParts.length > 0 && ` · ${entry.completedParts.length} part${entry.completedParts.length !== 1 ? 's' : ''} ready`}
      </p>

      {entry.completedParts.length > 0 && (
        <div className="history-parts">
          {entry.completedParts.map(p => (
            <button
              key={p.partNumber}
              className="btn btn-xs"
              onClick={() => handleDownloadPart(p)}
            >
              Part {p.partNumber}
            </button>
          ))}
        </div>
      )}

      {entry.status === 'failed' && !isActive && (
        <button className="btn btn-primary btn-sm" onClick={() => onResume(entry)}>
          Resume
        </button>
      )}
    </div>
  );
}

export function HistoryPanel({ entries, activeCompanyId, onResume, onDelete }: Props) {
  if (entries.length === 0) {
    return (
      <section className="card">
        <h2 className="section-title">Download History</h2>
        <p className="empty-state">No downloads yet. Select a company and click Download.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 className="section-title">Download History <span className="history-count">{entries.length} / 3</span></h2>
      <div className="history-list">
        {entries.map(entry => (
          <HistoryItem
            key={entry.companyId}
            entry={entry}
            isActive={entry.companyId === activeCompanyId}
            onResume={onResume}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  );
}
