// Turns a raw response from the European Commission raw milk price API into
// the contents of src/data/prices.json. Pure functions: no network, no files.
//
// API: GET https://api.tech.ec.europa.eu/agrifood/api/rawMilk/prices
// Each row looks like:
//   { memberStateCode: "BE", year: 2026, month: 9, price: "€44.00",
//     unit: "100KG", product: "Raw milk", ... }

import { KG_PER_LITRE } from '../../src/js/calc.js';
import { COUNTRIES } from '../../src/js/defaults.js';

export const API_BASE = 'https://api.tech.ec.europa.eu/agrifood/api/rawMilk/prices';

// Herd type → product name used by the API.
export const PRODUCTS = { conventional: 'Raw milk', organic: 'Organic raw milk' };

export const EXPECTED_UNIT = '100KG';
export const MIN_PRICE = 20; // €/100 kg
export const MAX_PRICE = 90; // €/100 kg
export const MAX_AGE_MONTHS = 4;
export const MAX_CHANGE = 0.3;

// The current and previous year always cover the 4-month freshness window.
export function buildSourceUrl(now) {
  const year = now.getUTCFullYear();
  return `${API_BASE}?memberStateCodes=${COUNTRIES.join(',')}&years=${year - 1},${year}`;
}

// "€44.00" → 44, "€1,044.50" → 1044.5, anything unreadable → NaN.
export function parsePrice(text) {
  if (typeof text === 'number') return text;
  if (typeof text !== 'string') return NaN;
  const cleaned = text.replace(/[€\s,]/g, '');
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
}

export function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

// Whole calendar months between a "YYYY-MM" month and `now`.
export function ageInMonths(month, now) {
  const [year, monthNumber] = month.split('-').map(Number);
  return now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1) - (year * 12 + monthNumber);
}

export function perLitre(per100kg) {
  return Math.round(((per100kg * KG_PER_LITRE) / 100) * 10000) / 10000;
}

function latestRow(rows, country, product) {
  let latest = null;
  for (const row of rows) {
    if (row.memberStateCode !== country) continue;
    if (String(row.product).toLowerCase() !== product.toLowerCase()) continue;
    if (!Number.isInteger(row.year) || !Number.isInteger(row.month)) continue;
    if (!latest || row.year * 12 + row.month > latest.year * 12 + latest.month) latest = row;
  }
  return latest;
}

// Returns { entry, error, warning }. `entry` is what goes into prices.json.
function evaluate(rows, country, herdType, previous, now) {
  const label = `${country} ${herdType}`;
  const keepPrevious = (reason) =>
    previous
      ? { entry: { ...previous, stale: true }, error: `${label}: ${reason}; kept ${previous.month}` }
      : { entry: null, error: `${label}: ${reason}; no previous value to keep` };

  const row = latestRow(rows, country, PRODUCTS[herdType]);
  const month = row ? monthKey(row.year, row.month) : null;

  if (!row || ageInMonths(month, now) > MAX_AGE_MONTHS) {
    const reason = row
      ? `latest month ${month} is more than ${MAX_AGE_MONTHS} months old`
      : 'no data returned';
    // Never had a value: the source simply does not publish this series.
    if (!previous) return { entry: null, warning: `${label}: ${reason}; set to null` };
    return keepPrevious(reason);
  }

  if (ageInMonths(month, now) < 0) return keepPrevious(`month ${month} is in the future`);

  if (row.unit !== EXPECTED_UNIT) {
    return keepPrevious(`unexpected unit "${row.unit}" for ${month}`);
  }

  const per100kg = parsePrice(row.price);
  if (!(per100kg >= MIN_PRICE && per100kg <= MAX_PRICE)) {
    return keepPrevious(
      `price "${row.price}" for ${month} is outside ${MIN_PRICE}–${MAX_PRICE} €/100 kg`,
    );
  }

  if (previous) {
    const change = Math.abs(per100kg - previous.per100kg) / previous.per100kg;
    if (!(change < MAX_CHANGE)) {
      return keepPrevious(
        `price ${per100kg} for ${month} differs ${(change * 100).toFixed(0)} % from stored ${previous.per100kg}`,
      );
    }
  }

  return { entry: { per100kg, perLitre: perLitre(per100kg), month, stale: false } };
}

/**
 * @param {object[]} rows      Parsed API response.
 * @param {object|null} previous  Current contents of prices.json, if any.
 * @param {Date} now
 * @returns {{ data: object, errors: string[], warnings: string[] }}
 */
export function buildPrices({ rows, previous, now, sourceUrl }) {
  const errors = [];
  const warnings = [];
  const countries = {};

  if (!Array.isArray(rows)) throw new TypeError('The API response is not a list of prices');

  for (const country of COUNTRIES) {
    countries[country] = {};
    for (const herdType of Object.keys(PRODUCTS)) {
      const before = previous?.countries?.[country]?.[herdType] ?? null;
      const { entry, error, warning } = evaluate(rows, country, herdType, before, now);
      countries[country][herdType] = entry;
      if (error) errors.push(error);
      if (warning) warnings.push(warning);
    }
  }

  return { data: { fetchedAt: now.toISOString(), sourceUrl, countries }, errors, warnings };
}

// Used when the API cannot be reached at all: keep everything, flag it stale.
export function markAllStale(previous) {
  const countries = {};
  for (const [country, herds] of Object.entries(previous.countries)) {
    countries[country] = {};
    for (const [herdType, entry] of Object.entries(herds)) {
      countries[country][herdType] = entry ? { ...entry, stale: true } : null;
    }
  }
  return { ...previous, countries };
}
