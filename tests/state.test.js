import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS, NUMERIC_KEYS, defaultInputs } from '../src/js/defaults.js';
import { resolvePrice } from '../src/js/price.js';
import { clampDisplay, decodeState, encodeState, fromDisplay, toDisplay } from '../src/js/state.js';

test('the defaults encode to short params, with percentages as whole numbers', () => {
  assert.equal(
    encodeState(defaultInputs()),
    'c=BE&o=c&l=30&p=1.2&i=20000&h=0.75&d=365&f=2&b=0&w=10&v=20&e=400&m=500&t=300&s=200&y=5',
  );
});

test('every input has its own URL key', () => {
  const keys = Object.values(DEFAULTS).map((def) => def.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every((key) => typeof key === 'string' && key.length === 1));
});

test('an empty query gives the defaults', () => {
  assert.deepEqual(decodeState(''), defaultInputs());
  assert.deepEqual(decodeState('?'), defaultInputs());
});

test('a scenario survives encoding and decoding exactly', () => {
  const scenario = {
    country: 'DE',
    herdType: 'organic',
    soldLitresPerDay: 82,
    sellPrice: 1.55,
    investment: 34500,
    hoursPerDay: 1.25,
    daysOpen: 310,
    paymentFeeShare: 0.035,
    bottleCostPerL: 0.15,
    wasteShare: 0.07,
    hourlyValue: 27,
    electricityPerYear: 650,
    maintenancePerYear: 900,
    labTestsPerYear: 450,
    insurancePerYear: 250,
    paybackTargetYears: 7,
  };

  assert.deepEqual(decodeState(`?${encodeState(scenario)}`), scenario);
  assert.deepEqual(decodeState(encodeState(defaultInputs())), defaultInputs());
});

test('percentages convert without floating-point noise', () => {
  assert.equal(toDisplay('wasteShare', 0.07), 7);
  assert.equal(fromDisplay('wasteShare', 7), 0.07);
  assert.equal(toDisplay('paymentFeeShare', 0.035), 3.5);
  assert.equal(toDisplay('sellPrice', 1.2), 1.2);
});

test('a partial query keeps the defaults for everything else', () => {
  const inputs = decodeState('?l=55&c=nl');
  assert.equal(inputs.soldLitresPerDay, 55);
  assert.equal(inputs.country, 'NL');
  assert.equal(inputs.sellPrice, 1.2);
  assert.equal(inputs.herdType, 'conventional');
});

test('unreadable or unknown values fall back to the defaults', () => {
  const inputs = decodeState('?c=XX&o=z&l=abc&p=&i=NaN&zzz=1');
  assert.deepEqual(inputs, defaultInputs());
});

test('out-of-range values are clamped to the field range', () => {
  const inputs = decodeState('?l=99999&w=80&d=0&p=-3');
  assert.equal(inputs.soldLitresPerDay, DEFAULTS.soldLitresPerDay.max);
  assert.equal(inputs.wasteShare, 0.5);
  assert.equal(inputs.daysOpen, 1);
  assert.equal(inputs.sellPrice, DEFAULTS.sellPrice.min);
});

test('the waste range can never reach 100 %', () => {
  assert.ok(DEFAULTS.wasteShare.max < 95);
});

test('clampDisplay rejects values that are not numbers', () => {
  assert.equal(clampDisplay('soldLitresPerDay', NaN), null);
  assert.equal(clampDisplay('soldLitresPerDay', Infinity), null);
  assert.equal(clampDisplay('soldLitresPerDay', '12'), null);
  assert.equal(clampDisplay('soldLitresPerDay', 12), 12);
});

test('every default lies inside its own slider range', () => {
  for (const key of NUMERIC_KEYS) {
    const shown = toDisplay(key, DEFAULTS[key].value);
    assert.ok(shown >= DEFAULTS[key].min && shown <= DEFAULTS[key].max, key);
  }
});

const entry = (per100kg) => ({ per100kg, perLitre: 0, month: '2026-09', stale: false });
const PRICES = {
  countries: {
    BE: { conventional: entry(44), organic: entry(55) },
    NL: { conventional: entry(45), organic: null },
    LU: { conventional: null, organic: null },
  },
};

test('resolvePrice returns the price for the country and herd type', () => {
  assert.deepEqual(resolvePrice(PRICES, 'BE', 'conventional'), {
    entry: entry(44),
    country: 'BE',
    countryFallback: false,
    organicFallback: false,
  });
  assert.equal(resolvePrice(PRICES, 'BE', 'organic').entry.per100kg, 55);
});

test('resolvePrice falls back to conventional when organic is missing', () => {
  const price = resolvePrice(PRICES, 'NL', 'organic');
  assert.equal(price.entry.per100kg, 45);
  assert.equal(price.organicFallback, true);
  assert.equal(price.countryFallback, false);
});

test('resolvePrice borrows the configured neighbour when a country has no price', () => {
  const conventional = resolvePrice(PRICES, 'LU', 'conventional');
  assert.equal(conventional.country, 'BE');
  assert.equal(conventional.countryFallback, true);
  assert.equal(conventional.entry.per100kg, 44);

  const organic = resolvePrice(PRICES, 'LU', 'organic');
  assert.equal(organic.entry.per100kg, 55);
  assert.equal(organic.organicFallback, false);
});

test('resolvePrice returns null when nothing is available', () => {
  assert.equal(resolvePrice(PRICES, 'LU', 'conventional', {}), null);
  assert.equal(resolvePrice(PRICES, 'FR', 'conventional'), null);
  assert.equal(resolvePrice(null, 'BE', 'conventional'), null);
});
