import type { PropertyRecord } from '../types';

const HEADERS = [
  'property_hash_id', 'property_name', 'property_star_rating_number', 'property_address',
  'country_name', 'region_name', 'city_name', 'property_latitude', 'property_longitude',
  'property_chain_name', 'hotelbeds_id', 'agoda_id', 'expedia_rapid_id', 'rakuten_id',
];

function escapeField(value: string): string {
  if (/[,"\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function recordToRow(r: PropertyRecord): string {
  return [
    escapeField(r.property_hash_id),
    escapeField(r.property_name),
    String(r.property_star_rating_number),
    escapeField(r.property_address),
    escapeField(r.country_name),
    escapeField(r.region_name),
    escapeField(r.city_name),
    String(r.property_latitude),
    String(r.property_longitude),
    escapeField(r.property_chain_name),
    r.hotelbeds_id !== null ? String(r.hotelbeds_id) : '',
    r.agoda_id !== null ? String(r.agoda_id) : '',
    r.expedia_rapid_id !== null ? String(r.expedia_rapid_id) : '',
    r.rakuten_id !== null ? String(r.rakuten_id) : '',
  ].join(',');
}

export function generateCsvBlob(records: PropertyRecord[]): Blob {
  const header = HEADERS.join(',') + '\r\n';
  const rows = records.map(recordToRow).join('\r\n') + '\r\n';
  return new Blob([header + rows], { type: 'text/csv' });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
