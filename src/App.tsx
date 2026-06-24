import { useState, useEffect, useCallback } from 'react';
import { useDownloadOrchestrator } from './hooks/useDownloadOrchestrator';
import { DownloadOverlay } from './components/DownloadOverlay';
import { HistoryPanel } from './components/HistoryPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { getAllEntries, markStaleInProgressAsFailed, deleteEntry } from './lib/indexeddb';
import type { Company, HistoryEntry } from './types';
import './index.css';

const COMPANIES: Company[] = [
  { id: 'acme', name: 'Acme Corp' },
  { id: 'globex', name: 'Globex Corporation' },
  { id: 'initech', name: 'Initech' },
  { id: 'umbrella', name: 'Umbrella Corp' },
  { id: 'dunder', name: 'Dunder Mifflin' },
];

export default function App() {
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);

  const refreshHistory = useCallback(async () => {
    const entries = await getAllEntries();
    setHistoryEntries(entries);
  }, []);

  const { state, startDownload, resumeDownload, reset } = useDownloadOrchestrator(refreshHistory);

  useEffect(() => {
    markStaleInProgressAsFailed().then(refreshHistory);
  }, [refreshHistory]);

  const isDownloading = state.status === 'downloading';
  const showOverlay = state.status !== 'idle';

  function handleDownload() {
    const company = COMPANIES.find(c => c.id === selectedCompanyId);
    if (!company) return;
    void startDownload(company);
  }

  function handleResume(entry: HistoryEntry) {
    void resumeDownload(entry);
  }

  function handleDelete(entry: HistoryEntry) {
    void deleteEntry(entry.companyId).then(refreshHistory);
  }

  function handleResumeFromOverlay() {
    const entry = historyEntries.find(e => e.companyId === state.companyId);
    if (entry) void resumeDownload(entry);
  }

  function handleClose() {
    reset();
    void refreshHistory();
  }

  return (
    <>
      {showOverlay && (
        <DownloadOverlay
          status={state.status === 'downloading' ? 'downloading' : state.status === 'failed' ? 'failed' : 'completed'}
          companyName={state.companyName}
          recordsProcessed={state.recordsProcessed}
          currentPart={state.currentPart}
          completedParts={state.completedParts}
          onResume={handleResumeFromOverlay}
          onClose={handleClose}
        />
      )}

      <div className="app">
        <header className="app-header">
          <h1 className="app-title">Property CSV Export</h1>
          <p className="app-subtitle">Download property data by company as split CSV files</p>
        </header>

        <section className="card">
          <h2 className="section-title">New Download</h2>
          <div className="controls">
            <div className="field">
              <label htmlFor="company-select" className="field-label">Company</label>
              <select
                id="company-select"
                className="select"
                value={selectedCompanyId}
                onChange={e => setSelectedCompanyId(e.target.value)}
                disabled={isDownloading}
              >
                <option value="">— Select a company —</option>
                {COMPANIES.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <button
              className="btn btn-primary"
              onClick={handleDownload}
              disabled={!selectedCompanyId || isDownloading}
            >
              Download
            </button>
          </div>

        </section>

        <SettingsPanel disabled={isDownloading} />

        <HistoryPanel
          entries={historyEntries}
          activeCompanyId={isDownloading ? state.companyId : ''}
          onResume={handleResume}
          onDelete={handleDelete}
        />
      </div>
    </>
  );
}
