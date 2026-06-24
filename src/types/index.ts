export interface PropertyRecord {
  property_hash_id: string;
  property_name: string;
  property_star_rating_number: number;
  property_address: string;
  country_name: string;
  region_name: string;
  city_name: string;
  property_latitude: number;
  property_longitude: number;
  property_chain_name: string;
  hotelbeds_id: number | null;
  agoda_id: number | null;
  expedia_rapid_id: number | null;
  rakuten_id: number | null;
}

export interface CompletedPart {
  partNumber: number;
  blob: Blob;
  recordCount: number;
}

export interface HistoryEntry {
  companyId: string;
  companyName: string;
  status: 'in-progress' | 'completed' | 'failed';
  isNext: string | null;
  pendingBuffer: PropertyRecord[];
  completedParts: CompletedPart[];
  totalRecordsProcessed: number;
  createdAt: number;
  updatedAt: number;
}

export interface Company {
  id: string;
  name: string;
}
