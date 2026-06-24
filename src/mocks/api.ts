import type { PropertyRecord } from '../types';
import { config } from '../lib/config';

type CountryDef = {
  name: string;
  regions: string[];
  cities: string[];
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
};

const COUNTRIES: CountryDef[] = [
  {
    name: 'Singapore', regions: ['Singapore'], cities: ['Singapore'],
    latMin: 1.25, latMax: 1.45, lngMin: 103.65, lngMax: 103.99,
  },
  {
    name: 'Thailand', regions: ['Phuket', 'Bangkok', 'Chiang Mai', 'Samui'],
    cities: ['Phuket Island', 'Bangkok', 'Chiang Mai', 'Koh Samui'],
    latMin: 7.80, latMax: 18.80, lngMin: 98.20, lngMax: 100.60,
  },
  {
    name: 'Indonesia', regions: ['West Java', 'Central Java', 'Bali', 'DKI Jakarta'],
    cities: ['Jakarta', 'Bandung', 'Yogyakarta', 'Denpasar', 'Bogor'],
    latMin: -8.80, latMax: -6.10, lngMin: 106.50, lngMax: 115.20,
  },
  {
    name: 'Malaysia', regions: ['Kuala Lumpur', 'Selangor', 'Penang', 'Johor'],
    cities: ['Kuala Lumpur', 'Petaling Jaya', 'George Town', 'Johor Bahru'],
    latMin: 1.50, latMax: 6.50, lngMin: 100.30, lngMax: 103.90,
  },
  {
    name: 'Vietnam', regions: ['Ho Chi Minh City', 'Hanoi', 'Da Nang', 'Khanh Hoa'],
    cities: ['Ho Chi Minh City', 'Hanoi', 'Da Nang', 'Nha Trang'],
    latMin: 10.70, latMax: 21.00, lngMin: 105.80, lngMax: 108.20,
  },
];

const PROPERTY_PREFIXES = ['Grand', 'Royal', 'The Luxe', 'Park', 'Ocean View', 'Garden', 'Sky', 'Metro', 'Heritage', 'Harbour'];
const PROPERTY_TYPES = ['Hotel', 'Resort', 'Suites', 'Inn', 'Residences', 'Apartments', 'Villa', 'Lodge'];
const CHAINS = ['Independent', 'Marriott', 'Hilton', 'Hyatt', 'Accor', 'ZUZU Hospitality', 'Wyndham', 'IHG', 'Best Western', 'Swiss-Belhotel'];
const STREETS = ['Main Street', 'Beach Road', 'Jalan Sudirman', 'Orchard Avenue', 'River Valley Road', 'Marina Boulevard', 'Silom Road', 'Nguyen Hue Boulevard', 'Jl. Raya'];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makePropertyId(companyId: string, index: number): string {
  const seed = index + companyId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 997;
  const h8 = (n: number) => ((n * 2654435761) >>> 0).toString(16).padStart(8, '0');
  const h4 = (n: number) => (((n * 40503) >>> 0) >>> 16).toString(16).padStart(4, '0');
  const h3 = (n: number) => (((n * 1664525 + 1013904223) >>> 0) >>> 20).toString(16).padStart(3, '0');
  const variant = (8 | (seed & 3)).toString(16);
  return `${h8(seed)}-${h4(seed)}-4${h3(seed * 31)}-${variant}${h3(seed * 37)}-${h8(seed * 43)}${h4(seed * 47)}`;
}

function hashString(s: string): number {
  return s.split('').reduce((hash, c) => ((hash << 5) + hash + c.charCodeAt(0)) >>> 0, 5381);
}

export interface IdEndpointResponse {
  ids: string[];
  isNext: string | null;
}

export interface DetailEndpointResponse {
  properties: PropertyRecord[];
}

export async function mockFetchIds(companyId: string, cursor: string | null): Promise<IdEndpointResponse> {
  await sleep(config.mockIdDelayMs);

  const offset = cursor !== null ? parseInt(cursor, 10) : 0;
  const batchSize = Math.min(config.mockIdBatchSize, config.mockTotalRecords - offset);

  if (batchSize <= 0) return { ids: [], isNext: null };

  const ids = Array.from({ length: batchSize }, (_, i) => makePropertyId(companyId, offset + i));
  const nextOffset = offset + batchSize;

  return { ids, isNext: nextOffset < config.mockTotalRecords ? String(nextOffset) : null };
}

export async function mockFetchDetails(ids: string[]): Promise<DetailEndpointResponse> {
  await sleep(config.mockDetailDelayMs);

  const properties: PropertyRecord[] = ids.map(id => {
    const num = hashString(id);

    const country = COUNTRIES[num % COUNTRIES.length];
    const regionIdx = (num >>> 4) % country.regions.length;
    const cityIdx = (num >>> 8) % country.cities.length;

    const latFraction = ((num * 7919) % 10000) / 10000;
    const lngFraction = ((num * 6271) % 10000) / 10000;
    const lat = country.latMin + latFraction * (country.latMax - country.latMin);
    const lng = country.lngMin + lngFraction * (country.lngMax - country.lngMin);

    const streetIdx = (num >>> 2) % STREETS.length;
    const addressNum = 100 + (num % 900);
    const city = country.cities[cityIdx];
    const address = num % 3 !== 0
      ? `${addressNum} ${STREETS[streetIdx]}, ${city}`
      : `${addressNum} ${STREETS[streetIdx]}`;

    return {
      property_hash_id: id,
      property_name: `${PROPERTY_PREFIXES[(num >>> 6) % PROPERTY_PREFIXES.length]} ${PROPERTY_TYPES[(num >>> 10) % PROPERTY_TYPES.length]}`,
      property_star_rating_number: (num % 5) + 1,
      property_address: address,
      country_name: country.name,
      region_name: country.regions[regionIdx],
      city_name: city,
      property_latitude: parseFloat(lat.toFixed(7)),
      property_longitude: parseFloat(lng.toFixed(7)),
      property_chain_name: CHAINS[(num >>> 3) % CHAINS.length],
      hotelbeds_id: num % 4 === 0 ? 100000 + (num % 900000) : null,
      agoda_id: num % 7 === 6 ? null : 5000000 + (num % 55000000),
      expedia_rapid_id: num % 5 === 4 ? null : 50000000 + (num % 70000000),
      rakuten_id: num % 10 === 3 ? 1000000 + (num % 99000000) : null,
    };
  });

  return { properties };
}
