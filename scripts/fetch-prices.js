// Fetches the latest dairy prices from the European Commission and writes
// src/data/prices.json. Run it with `npm run fetch:prices`.
//
// Exits with code 1 if any country fails validation or the API is unreachable.
// In that case the previous values are kept and flagged `stale: true`.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { buildPrices, buildSourceUrl, markAllStale } from './lib/prices.js';

const PRICES_FILE = fileURLToPath(new URL('../src/data/prices.json', import.meta.url));
const TIMEOUT_MS = 30000;
const ATTEMPTS = 3;

async function readPrevious() {
  try {
    return JSON.parse(await readFile(PRICES_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function fetchRows(url) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt}/${ATTEMPTS} failed: ${error.message}`);
    }
  }
  throw lastError;
}

const save = (data) => writeFile(PRICES_FILE, `${JSON.stringify(data, null, 2)}\n`);

const now = new Date();
const sourceUrl = buildSourceUrl(now);
const previous = await readPrevious();

let rows;
try {
  rows = await fetchRows(sourceUrl);
} catch (error) {
  console.error(`Could not fetch ${sourceUrl}: ${error.message}`);
  if (previous) {
    await save(markAllStale(previous));
    console.error('Kept the previous prices and marked them stale.');
  }
  process.exit(1);
}

const { data, errors, warnings } = buildPrices({ rows, previous, now, sourceUrl });
await save(data);

for (const [country, herds] of Object.entries(data.countries)) {
  for (const [herdType, entry] of Object.entries(herds)) {
    const text = entry
      ? `${entry.per100kg.toFixed(2)} €/100 kg (${entry.month})${entry.stale ? ' STALE' : ''}`
      : 'no data';
    console.log(`${country} ${herdType.padEnd(12)} ${text}`);
  }
}
for (const warning of warnings) console.warn(`Note: ${warning}`);
for (const error of errors) console.error(`Failed: ${error}`);

if (errors.length > 0) process.exit(1);
