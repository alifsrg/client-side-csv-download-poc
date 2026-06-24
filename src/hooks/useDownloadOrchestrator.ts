import { useState, useRef, useCallback } from 'react';
import { mockFetchIds, mockFetchDetails } from '../mocks/api';
import { generateCsvBlob } from '../lib/csv';
import { upsertEntry, ensureSlotAvailable } from '../lib/indexeddb';
import type { Company, CompletedPart, PropertyRecord, HistoryEntry } from '../types';
import { config } from '../lib/config';

export interface DownloadState {
  status: 'idle' | 'downloading' | 'failed' | 'completed';
  companyId: string;
  companyName: string;
  recordsProcessed: number;
  currentPart: number;
  completedParts: CompletedPart[];
}

const INITIAL_STATE: DownloadState = {
  status: 'idle',
  companyId: '',
  companyName: '',
  recordsProcessed: 0,
  currentPart: 1,
  completedParts: [],
};

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1_000 * 3 ** attempt));
    }
  }
  throw new Error('unreachable');
}

export function useDownloadOrchestrator(onHistoryChange: () => void) {
  const [state, setState] = useState<DownloadState>(INITIAL_STATE);
  const buffer = useRef<PropertyRecord[]>([]);
  const onDone = useRef(onHistoryChange);
  onDone.current = onHistoryChange;

  const runLoop = useCallback(async (
    company: Company,
    initialCursor: string | null,
    initialPart: number,
    initialCompleted: CompletedPart[],
    initialTotal: number,
    initialPending: PropertyRecord[],
    createdAt: number,
  ) => {
    const partThreshold = config.partThreshold;
    const checkpointInterval = config.checkpointInterval;

    buffer.current = [...initialPending];
    let cursor = initialCursor;
    let part = initialPart;
    let total = initialTotal;
    let completed = [...initialCompleted];
    let checkpointCount = 0;

    setState({
      status: 'downloading',
      companyId: company.id,
      companyName: company.name,
      recordsProcessed: total,
      currentPart: part,
      completedParts: completed,
    });

    try {
      while (true) {
        const { ids, isNext } = await withRetry(() => mockFetchIds(company.id, cursor));
        if (ids.length === 0) break;

        const { properties } = await withRetry(() => mockFetchDetails(ids));
        buffer.current.push(...properties);
        total += properties.length;
        checkpointCount += properties.length;

        setState(s => ({ ...s, recordsProcessed: total }));

        if (checkpointCount >= checkpointInterval) {
          checkpointCount = 0;
          await upsertEntry({
            companyId: company.id,
            companyName: company.name,
            status: 'in-progress',
            isNext,
            pendingBuffer: [...buffer.current],
            completedParts: completed,
            totalRecordsProcessed: total,
            createdAt,
            updatedAt: Date.now(),
          });
        }

        while (buffer.current.length >= partThreshold) {
          const records = buffer.current.splice(0, PART_THRESHOLD);
          const blob = generateCsvBlob(records);
          completed = [...completed, { partNumber: part, blob, recordCount: records.length }];
          part++;

          await upsertEntry({
            companyId: company.id,
            companyName: company.name,
            status: 'in-progress',
            isNext,
            pendingBuffer: [...buffer.current],
            completedParts: completed,
            totalRecordsProcessed: total,
            createdAt,
            updatedAt: Date.now(),
          });

          setState(s => ({ ...s, currentPart: part, completedParts: completed }));
        }

        cursor = isNext;
        if (!cursor) break;
      }

      if (buffer.current.length > 0) {
        const blob = generateCsvBlob(buffer.current);
        completed = [...completed, { partNumber: part, blob, recordCount: buffer.current.length }];
        buffer.current = [];
      }

      await upsertEntry({
        companyId: company.id,
        companyName: company.name,
        status: 'completed',
        isNext: null,
        pendingBuffer: [],
        completedParts: completed,
        totalRecordsProcessed: total,
        createdAt,
        updatedAt: Date.now(),
      });

      setState(s => ({ ...s, status: 'completed', completedParts: completed }));
    } catch {
      await upsertEntry({
        companyId: company.id,
        companyName: company.name,
        status: 'failed',
        isNext: cursor,
        pendingBuffer: [...buffer.current],
        completedParts: completed,
        totalRecordsProcessed: total,
        createdAt,
        updatedAt: Date.now(),
      });

      setState(s => ({ ...s, status: 'failed', completedParts: completed }));
    } finally {
      onDone.current();
    }
  }, []);

  const startDownload = useCallback(async (company: Company) => {
    await ensureSlotAvailable(company.id);
    const createdAt = Date.now();
    await upsertEntry({
      companyId: company.id,
      companyName: company.name,
      status: 'in-progress',
      isNext: null,
      pendingBuffer: [],
      completedParts: [],
      totalRecordsProcessed: 0,
      createdAt,
      updatedAt: createdAt,
    });
    onDone.current();
    void runLoop(company, null, 1, [], 0, [], createdAt);
  }, [runLoop]);

  const resumeDownload = useCallback(async (entry: HistoryEntry) => {
    await upsertEntry({ ...entry, status: 'in-progress', updatedAt: Date.now() });
    onDone.current();
    void runLoop(
      { id: entry.companyId, name: entry.companyName },
      entry.isNext,
      entry.completedParts.length + 1,
      entry.completedParts,
      entry.totalRecordsProcessed,
      entry.pendingBuffer,
      entry.createdAt,
    );
  }, [runLoop]);

  const reset = useCallback(() => {
    buffer.current = [];
    setState(INITIAL_STATE);
  }, []);

  return { state, startDownload, resumeDownload, reset };
}
