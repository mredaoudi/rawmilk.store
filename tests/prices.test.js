import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ageInMonths,
  buildPrices,
  buildSourceUrl,
  markAllStale,
  parsePrice,
  perLitre,
} from '../scripts/lib/prices.js';

// A real response, saved on 2026-10-13 from:
// /api/rawMilk/prices?memberStateCodes=BE,NL,LU,DE,FR&years=2025,2026
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/raw-milk-prices.json', import.meta.url), 'utf8'),
);
const NOW = new Date('2026-10-13T06:00:00Z');
const SOURCE = 'https://example.test/prices';

const build = (overrides = {}) =>
  buildPrices({ rows: FIXTURE, previous: null, now: NOW, sourceUrl: SOURCE, ...overrides });

const row = (overrides = {}) => ({
  memberStateCode: 'BE',
  memberStateName: 'Belgium',
  month: 9,
  price: '€44.00',
  unit: '100KG',
  year: 2026,
  product: 'Raw milk',
  ...overrides,
});

const stored = (per100kg, month = '2026-08') => ({
  countries: {
    BE: { conventional: { per100kg, perLitre: perLitre(per100kg), month, stale: false } },
  },
});

test('parsePrice reads the API price format', () => {
  assert.equal(parsePrice('€44.00'), 44);
  assert.equal(parsePrice('€133.19'), 133.19);
  assert.equal(parsePrice('€1,044.50'), 1044.5);
  assert.equal(parsePrice(' € 41.15 '), 41.15);
  assert.equal(parsePrice(52.3), 52.3);
  assert.ok(Number.isNaN(parsePrice('')));
  assert.ok(Number.isNaN(parsePrice('n/a')));
  assert.ok(Number.isNaN(parsePrice(null)));
  assert.ok(Number.isNaN(parsePrice(undefined)));
});

test('ageInMonths counts calendar months, across year ends too', () => {
  assert.equal(ageInMonths('2026-10', NOW), 0);
  assert.equal(ageInMonths('2026-06', NOW), 4);
  assert.equal(ageInMonths('2025-12', NOW), 10);
  assert.equal(ageInMonths('2025-11', new Date('2026-02-12T06:00:00Z')), 3);
  assert.equal(ageInMonths('2026-11', NOW), -1);
});

test('perLitre converts at 1.03 kg/L and rounds to 4 decimals', () => {
  assert.equal(perLitre(44), 0.4532);
  assert.equal(perLitre(41.15), 0.4238);
});

test('buildSourceUrl asks for the five countries over two years', () => {
  assert.equal(
    buildSourceUrl(NOW),
    'https://api.tech.ec.europa.eu/agrifood/api/rawMilk/prices?memberStateCodes=BE,NL,LU,DE,FR&years=2025,2026',
  );
});

test('the real response gives the latest month for each country and herd type', () => {
  const { data, errors } = build();

  assert.deepEqual(errors, []);
  assert.equal(data.fetchedAt, '2026-10-13T06:00:00.000Z');
  assert.equal(data.sourceUrl, SOURCE);
  assert.deepEqual(Object.keys(data.countries), ['BE', 'NL', 'LU', 'DE', 'FR']);

  assert.deepEqual(data.countries.BE.conventional, {
    per100kg: 44,
    perLitre: 0.4532,
    month: '2026-09',
    stale: false,
  });
  assert.deepEqual(data.countries.DE.conventional, {
    per100kg: 41.15,
    perLitre: 0.4238,
    month: '2026-09',
    stale: false,
  });
  assert.deepEqual(data.countries.NL.organic, {
    per100kg: 67,
    perLitre: 0.6901,
    month: '2026-08',
    stale: false,
  });
  assert.equal(data.countries.FR.organic.per100kg, 53.4);
});

test('a country the source does not publish becomes null with a warning, not a failure', () => {
  // The Commission has published no Luxembourg raw milk price since 2018.
  const { data, errors, warnings } = build();

  assert.equal(data.countries.LU.conventional, null);
  assert.equal(data.countries.LU.organic, null);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /^LU conventional: no data returned/);
});

test('missing organic data is null while conventional is kept', () => {
  const { data, errors } = build({ rows: [row()] });

  assert.equal(data.countries.BE.conventional.per100kg, 44);
  assert.equal(data.countries.BE.organic, null);
  assert.deepEqual(errors, []);
});

test('running twice on the same data changes nothing and reports no failure', () => {
  const first = build();
  const second = build({ previous: first.data });

  assert.deepEqual(second.data, first.data);
  assert.deepEqual(second.errors, []);
});

test('a price outside 20–90 €/100 kg keeps the previous value and marks it stale', () => {
  for (const price of ['€19.99', '€90.01', '€0.00', '', 'n/a']) {
    const { data, errors } = build({ rows: [row({ price })], previous: stored(43) });

    assert.deepEqual(data.countries.BE.conventional, {
      per100kg: 43,
      perLitre: perLitre(43),
      month: '2026-08',
      stale: true,
    });
    assert.equal(errors.length, 1, `price "${price}"`);
    assert.match(errors[0], /^BE conventional: price/);
  }
});

test('the limits 20 and 90 €/100 kg are accepted', () => {
  assert.equal(build({ rows: [row({ price: '€20.00' })] }).data.countries.BE.conventional.per100kg, 20);
  assert.equal(build({ rows: [row({ price: '€90.00' })] }).data.countries.BE.conventional.per100kg, 90);
});

test('an invalid first value is a failure with nothing to keep', () => {
  const { data, errors } = build({ rows: [row({ price: '€150.00' })] });

  assert.equal(data.countries.BE.conventional, null);
  assert.equal(errors.length, 1);
});

test('a month more than 4 months old keeps the previous value and marks it stale', () => {
  const { data, errors } = build({ rows: [row({ month: 5 })], previous: stored(43, '2026-05') });

  assert.equal(data.countries.BE.conventional.stale, true);
  assert.equal(data.countries.BE.conventional.month, '2026-05');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /more than 4 months old/);
});

test('a month exactly 4 months old is accepted', () => {
  const { data, errors } = build({ rows: [row({ month: 6 })] });

  assert.equal(data.countries.BE.conventional.month, '2026-06');
  assert.equal(data.countries.BE.conventional.stale, false);
  assert.deepEqual(errors, []);
});

test('data that disappears keeps the previous value and marks it stale', () => {
  const { data, errors } = build({ rows: [], previous: stored(43) });

  assert.equal(data.countries.BE.conventional.per100kg, 43);
  assert.equal(data.countries.BE.conventional.stale, true);
  assert.match(errors[0], /no data returned/);
});

test('a change of 30 % or more keeps the previous value and marks it stale', () => {
  // 44 against a stored 33.8 is a 30.2 % rise; against a stored 63 a 30.2 % fall.
  for (const before of [33.8, 63]) {
    const { data, errors } = build({ rows: [row()], previous: stored(before) });

    assert.equal(data.countries.BE.conventional.per100kg, before);
    assert.equal(data.countries.BE.conventional.stale, true);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /differs 30 %/);
  }
});

test('a change just under 30 % is accepted and clears a stale flag', () => {
  const previous = stored(34);
  previous.countries.BE.conventional.stale = true;
  const { data, errors } = build({ rows: [row()], previous });

  assert.deepEqual(data.countries.BE.conventional, {
    per100kg: 44,
    perLitre: 0.4532,
    month: '2026-09',
    stale: false,
  });
  assert.deepEqual(errors, []);
});

test('an unexpected unit is rejected', () => {
  const { data, errors } = build({ rows: [row({ unit: 'TONNE' })], previous: stored(43) });

  assert.equal(data.countries.BE.conventional.stale, true);
  assert.match(errors[0], /unexpected unit/);
});

test('a month in the future is rejected', () => {
  const { errors } = build({ rows: [row({ month: 12 })], previous: stored(43) });
  assert.match(errors[0], /in the future/);
});

test('one bad country does not affect the others', () => {
  const rows = FIXTURE.map((r) =>
    r.memberStateCode === 'DE' && r.product === 'Raw milk' && r.year === 2026 && r.month === 9
      ? { ...r, price: '€5.00' }
      : r,
  );
  const first = build();
  const { data, errors } = build({ rows, previous: first.data });

  assert.equal(errors.length, 1);
  assert.equal(data.countries.DE.conventional.stale, true);
  assert.equal(data.countries.DE.conventional.per100kg, 41.15);
  assert.equal(data.countries.BE.conventional.stale, false);
  assert.equal(data.countries.DE.organic.stale, false);
});

test('product names match whatever their letter case', () => {
  const { data } = build({ rows: [row({ product: 'Raw Milk' })] });
  assert.equal(data.countries.BE.conventional.per100kg, 44);
});

test('a response that is not a list is rejected', () => {
  assert.throws(() => build({ rows: { error: 'Bad Request' } }), TypeError);
});

test('markAllStale flags every stored value and keeps nulls', () => {
  const first = build().data;
  const stale = markAllStale(first);

  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.equal(stale.countries.BE.conventional.stale, true);
  assert.equal(stale.countries.BE.conventional.per100kg, 44);
  assert.equal(stale.countries.NL.organic.stale, true);
  assert.equal(stale.countries.LU.conventional, null);
  assert.equal(first.countries.BE.conventional.stale, false);
});
