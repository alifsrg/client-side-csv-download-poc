import { useState } from 'react';
import { config, DEFAULT_CONFIG, updateConfig } from '../lib/config';
import type { AppConfig } from '../lib/config';

interface FieldDef {
  key: keyof AppConfig;
  label: string;
  unit: string;
  min: number;
  tooltip: string;
}

const FIELDS: FieldDef[] = [
  {
    key: 'mockIdDelayMs',
    label: 'ID Endpoint Delay',
    unit: 'ms',
    min: 0,
    tooltip: 'Simulated network latency for the ID endpoint. Applied once per page of 50 IDs fetched.',
  },
  {
    key: 'mockDetailDelayMs',
    label: 'Detail Endpoint Delay',
    unit: 'ms',
    min: 0,
    tooltip: 'Simulated network latency for the Detail endpoint. Applied once per batch of 50 IDs resolved.',
  },
  {
    key: 'mockTotalRecords',
    label: 'Total Records',
    unit: 'records / company',
    min: 1,
    tooltip: 'Total number of property records the mock generates per company. The ID endpoint paginates through all of them.',
  },
  {
    key: 'mockIdBatchSize',
    label: 'ID Batch Size',
    unit: 'IDs / request',
    min: 1,
    tooltip: 'How many IDs are returned per call to the ID endpoint. The Detail endpoint always resolves the same batch in one call.',
  },
  {
    key: 'partThreshold',
    label: 'Part Threshold',
    unit: 'records / CSV part',
    min: 1,
    tooltip: 'Once the in-memory buffer reaches this size, it is flushed into a new CSV part file. Lower = more (smaller) parts.',
  },
  {
    key: 'checkpointInterval',
    label: 'Checkpoint Interval',
    unit: 'records / save',
    min: 1,
    tooltip: 'Progress (cursor + pending buffer) is saved to IndexedDB every N records. Lower = more frequent saves, less data lost on a crash.',
  },
];

type RawValues = Record<keyof AppConfig, string>;

function toRaw(c: AppConfig): RawValues {
  return {
    mockIdDelayMs:      String(c.mockIdDelayMs),
    mockDetailDelayMs:  String(c.mockDetailDelayMs),
    mockTotalRecords:   String(c.mockTotalRecords),
    mockIdBatchSize:    String(c.mockIdBatchSize),
    partThreshold:      String(c.partThreshold),
    checkpointInterval: String(c.checkpointInterval),
  };
}

interface SettingsPanelProps {
  disabled: boolean;
}

export function SettingsPanel({ disabled }: SettingsPanelProps) {
  const [editing, setEditing] = useState(false);
  const [rawValues, setRawValues] = useState<RawValues>(() => toRaw(config));

  const draftDiffersFromDefaults = FIELDS.some(({ key, min }) => {
    const n = parseInt(rawValues[key], 10);
    return !isNaN(n) && n >= min && n !== DEFAULT_CONFIG[key];
  });

  function handleEdit() {
    setRawValues(toRaw(config));
    setEditing(true);
  }

  function handleSave() {
    FIELDS.forEach(({ key, min }) => {
      const n = parseInt(rawValues[key], 10);
      if (!isNaN(n) && n >= min) {
        updateConfig({ [key]: n });
      }
    });
    setEditing(false);
  }

  function handleCancel() {
    setRawValues(toRaw(config));
    setEditing(false);
  }

  function handleResetDraft() {
    setRawValues(toRaw(DEFAULT_CONFIG));
  }

  return (
    <section className="card">
      <div className="section-header">
        <h2 className="section-title" style={{ marginBottom: 0 }}>Experiment Settings</h2>
        <div className="section-header-actions">
          {editing ? (
            <>
              {draftDiffersFromDefaults && (
                <button className="btn btn-ghost btn-sm" onClick={handleResetDraft}>
                  Reset to defaults
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={handleCancel}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSave}>
                Save
              </button>
            </>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={handleEdit} disabled={disabled}>
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="settings-grid">
        {FIELDS.map(({ key, label, unit, min, tooltip }) => (
          <div key={key} className="field">
            <div className="field-label">
              {label}
              <span className="tooltip-anchor">
                <span className="tooltip-icon">i</span>
                <span className="tooltip-bubble">{tooltip}</span>
              </span>
            </div>
            {editing ? (
              <div className="input-with-unit">
                <input
                  type="number"
                  className="input"
                  value={rawValues[key]}
                  min={min}
                  step={1}
                  onChange={e => setRawValues(prev => ({ ...prev, [key]: e.target.value }))}
                />
                <span className="input-unit">{unit}</span>
              </div>
            ) : (
              <div className="setting-value">
                <span className="setting-value-num">{config[key].toLocaleString()}</span>
                <span className="input-unit">{unit}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
