import type { CompletedPart } from '../types';
import { triggerDownload } from '../lib/csv';

interface Props {
  status: 'downloading' | 'failed' | 'completed';
  companyName: string;
  recordsProcessed: number;
  currentPart: number;
  completedParts: CompletedPart[];
  onResume: () => void;
  onClose: () => void;
}

export function DownloadOverlay({ status, companyName, recordsProcessed, currentPart, completedParts, onResume, onClose }: Props) {
  function handleDownloadPart(part: CompletedPart) {
    triggerDownload(part.blob, `${companyName.replace(/\s+/g, '_')}_part_${part.partNumber}.csv`);
  }

  return (
    <div className="overlay">
      <div className="overlay-card">
        {status === 'downloading' && (
          <>
            <div className="overlay-icon spinner" />
            <h2 className="overlay-title">Downloading…</h2>
            <p className="overlay-company">{companyName}</p>
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${Math.min((recordsProcessed % 100) + 1, 100)}%` }} />
            </div>
            <p className="overlay-stat">
              <strong>{recordsProcessed.toLocaleString()}</strong> records processed
              &nbsp;·&nbsp;
              Part <strong>{currentPart}</strong> in progress
            </p>
            <p className="overlay-notice">Keep this tab open. The download will resume if interrupted.</p>
          </>
        )}

        {status === 'failed' && (
          <>
            <div className="overlay-icon icon-error">✕</div>
            <h2 className="overlay-title">Download failed</h2>
            <p className="overlay-company">{companyName}</p>
            <p className="overlay-stat">
              {recordsProcessed.toLocaleString()} records saved before failure
            </p>
            {completedParts.length > 0 && (
              <div className="part-list">
                <p className="part-list-label">Available parts:</p>
                {completedParts.map(p => (
                  <button key={p.partNumber} className="btn btn-secondary" onClick={() => handleDownloadPart(p)}>
                    Download Part {p.partNumber} ({p.recordCount.toLocaleString()} records)
                  </button>
                ))}
              </div>
            )}
            <div className="overlay-actions">
              <button className="btn btn-primary" onClick={onResume}>Resume download</button>
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {status === 'completed' && (
          <>
            <div className="overlay-icon icon-success">✓</div>
            <h2 className="overlay-title">Download complete</h2>
            <p className="overlay-company">{companyName}</p>
            <p className="overlay-stat">
              {recordsProcessed.toLocaleString()} records &nbsp;·&nbsp; {completedParts.length} part{completedParts.length !== 1 ? 's' : ''}
            </p>
            <div className="part-list">
              {completedParts.map(p => (
                <button key={p.partNumber} className="btn btn-secondary" onClick={() => handleDownloadPart(p)}>
                  Download Part {p.partNumber} ({p.recordCount.toLocaleString()} records)
                </button>
              ))}
            </div>
            <div className="overlay-actions">
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
