// Picks the dairy price to use for a country and herd type, applying the two
// documented fallbacks. Pure function, shared by the page and the tests.

import { PRICE_FALLBACK } from './defaults.js';

/**
 * @param {object} prices  Contents of src/data/prices.json.
 * @returns {null | {
 *   entry: { per100kg: number, perLitre: number, month: string, stale: boolean },
 *   country: string,           country whose price is used
 *   countryFallback: boolean,  true if that is not the selected country
 *   organicFallback: boolean,  true if organic was asked but conventional is used
 * }}
 */
export function resolvePrice(prices, country, herdType, fallback = PRICE_FALLBACK) {
  const countries = prices?.countries || {};

  let used = country;
  let countryFallback = false;
  if (!countries[used]?.conventional && fallback[country]) {
    used = fallback[country];
    countryFallback = true;
  }

  const herds = countries[used];
  if (!herds?.conventional) return null;

  const organicFallback = herdType === 'organic' && !herds.organic;
  const entry = herdType === 'organic' && herds.organic ? herds.organic : herds.conventional;

  return { entry, country: used, countryFallback, organicFallback };
}
