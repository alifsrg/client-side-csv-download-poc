export interface AppConfig {
  mockIdDelayMs: number;
  mockDetailDelayMs: number;
  mockTotalRecords: number;
  mockIdBatchSize: number;
  partThreshold: number;
  checkpointInterval: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  mockIdDelayMs: Number(import.meta.env.VITE_MOCK_ID_DELAY_MS) || 200,
  mockDetailDelayMs: Number(import.meta.env.VITE_MOCK_DETAIL_DELAY_MS) || 300,
  mockTotalRecords: Number(import.meta.env.VITE_MOCK_TOTAL_RECORDS) || 300,
  mockIdBatchSize: Number(import.meta.env.VITE_MOCK_ID_BATCH_SIZE) || 50,
  partThreshold: Number(import.meta.env.VITE_PART_THRESHOLD) || 100,
  checkpointInterval: Number(import.meta.env.VITE_CHECKPOINT_INTERVAL) || 10,
};

export const config: AppConfig = { ...DEFAULT_CONFIG };

export function updateConfig(partial: Partial<AppConfig>): void {
  Object.assign(config, partial);
}
