// Shareable state: every input encoded in short URL query params.
// Pure functions only, so they run the same in the browser and in the tests.

import { COUNTRIES, DEFAULTS, HERD_TYPES, NUMERIC_KEYS, defaultInputs } from './defaults.js';

const HERD_CODES = { conventional: 'c', organic: 'o' };

// Avoids artefacts such as 0.07 × 100 = 7.000000000000001.
const tidy = (number) => Math.round(number * 1e6) / 1e6;

// The value as the form shows it: percentages for fields stored as fractions.
export function toDisplay(key, value) {
  return DEFAULTS[key].percent ? tidy(value * 100) : value;
}

export function fromDisplay(key, shown) {
  return DEFAULTS[key].percent ? tidy(shown / 100) : shown;
}

// Keeps a displayed value inside the field's range. Returns null if unreadable.
export function clampDisplay(key, shown) {
  const { min, max } = DEFAULTS[key];
  if (typeof shown !== 'number' || !Number.isFinite(shown)) return null;
  return Math.min(Math.max(shown, min), max);
}

export function encodeState(inputs) {
  const params = new URLSearchParams();
  params.set(DEFAULTS.country.key, inputs.country);
  params.set(DEFAULTS.herdType.key, HERD_CODES[inputs.herdType]);
  for (const key of NUMERIC_KEYS) {
    params.set(DEFAULTS[key].key, String(toDisplay(key, inputs[key])));
  }
  return params.toString();
}

// Unknown, missing or unreadable params fall back to the defaults.
export function decodeState(search) {
  const params = new URLSearchParams(search);
  const inputs = defaultInputs();

  const country = (params.get(DEFAULTS.country.key) || '').toUpperCase();
  if (COUNTRIES.includes(country)) inputs.country = country;

  const herdCode = params.get(DEFAULTS.herdType.key);
  const herdType = HERD_TYPES.find((type) => HERD_CODES[type] === herdCode);
  if (herdType) inputs.herdType = herdType;

  for (const key of NUMERIC_KEYS) {
    const raw = params.get(DEFAULTS[key].key);
    if (raw === null || raw.trim() === '') continue;
    const shown = clampDisplay(key, Number(raw));
    if (shown !== null) inputs[key] = fromDisplay(key, shown);
  }
  return inputs;
}
