import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CASH_FLOW_MONTHS,
  NO_PAYBACK,
  NOT_PROFITABLE,
  applyScenario,
  calculate,
  calculateScenarios,
  dairyPricePerLitre,
} from '../src/js/calc.js';
import { SCENARIO_FACTORS, defaultInputs } from '../src/js/defaults.js';

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

// Round numbers so every expected value below can be checked by hand.
const SIMPLE = {
  soldLitresPerDay: 50,
  daysOpen: 300,
  sellPrice: 1.5,
  investment: 12000,
  paymentFeeShare: 0.1,
  bottleCostPerL: 0.05,
  wasteShare: 0.2,
  hoursPerDay: 1,
  hourlyValue: 10,
  electricityPerYear: 100,
  maintenancePerYear: 200,
  labTestsPerYear: 300,
  insurancePerYear: 400,
  paybackTargetYears: 4,
};
// 40 €/100 kg → 0.412 €/L; lost milk makes it 0.412 / 0.8 = 0.515 €/sold litre.
const SIMPLE_PRICE = 40;

test('dairyPricePerLitre converts €/100 kg to €/L at 1.03 kg/L', () => {
  close(dairyPricePerLitre(40), 0.412);
  close(dairyPricePerLitre(100), 1.03);
  assert.equal(dairyPricePerLitre(0), 0);
});

test('calculate follows the documented formulas', () => {
  const r = calculate(SIMPLE, SIMPLE_PRICE);

  close(r.dairyPricePerL, 0.412);
  // 1.5 × 0.9 − 0.05 − 0.515
  close(r.marginPerSoldLitre, 0.785);
  // 1 × 300 × 10 + 100 + 200 + 300 + 400
  close(r.annualFixed, 4000);
  // 0.785 × 50 × 300 − 4000
  close(r.annualMargin, 7775);
  // 12000 / (7775 / 12)
  close(r.paybackMonths, 144000 / 7775);
  // 4000 / (0.785 × 300)
  close(r.breakEvenLitresDay, 4000 / 235.5);
  // (4000 + 12000 / 4) / (0.785 × 300)
  close(r.targetLitresDay, 7000 / 235.5);
});

test('cash flow runs from month 0 to month 60', () => {
  const r = calculate(SIMPLE, SIMPLE_PRICE);

  assert.equal(r.cashFlow.length, CASH_FLOW_MONTHS + 1);
  close(r.cashFlow[0], -12000);
  close(r.cashFlow[12], -12000 + 7775);
  close(r.cashFlow[60], -12000 + 5 * 7775);
});

test('cash flow crosses zero at the payback month', () => {
  const r = calculate(SIMPLE, SIMPLE_PRICE);
  const before = Math.floor(r.paybackMonths);

  assert.ok(r.cashFlow[before] < 0);
  assert.ok(r.cashFlow[before + 1] > 0);
});

test('selling exactly the break-even volume gives a zero annual margin', () => {
  const base = calculate(SIMPLE, SIMPLE_PRICE);
  const atBreakEven = calculate(
    { ...SIMPLE, soldLitresPerDay: base.breakEvenLitresDay },
    SIMPLE_PRICE,
  );

  close(atBreakEven.annualMargin, 0, 1e-6);
});

test('selling exactly the target volume pays back in the target number of years', () => {
  const base = calculate(SIMPLE, SIMPLE_PRICE);
  const atTarget = calculate({ ...SIMPLE, soldLitresPerDay: base.targetLitresDay }, SIMPLE_PRICE);

  close(atTarget.paybackMonths, SIMPLE.paybackTargetYears * 12, 1e-6);
});

test('the shipped defaults give the expected result at 44 €/100 kg', () => {
  const r = calculate(defaultInputs(), 44);

  close(r.dairyPricePerL, 0.4532);
  close(r.marginPerSoldLitre, 1.176 - 0.4532 / 0.9);
  close(r.annualFixed, 6875);
  close(r.annualMargin, (1.176 - 0.4532 / 0.9) * 30 * 365 - 6875);
  assert.ok(r.annualMargin > 0);
});

test('a non-positive annual margin does not pay back', () => {
  const loss = calculate({ ...SIMPLE, soldLitresPerDay: 5 }, SIMPLE_PRICE);
  assert.ok(loss.annualMargin < 0);
  assert.equal(loss.paybackMonths, NO_PAYBACK);
  // The margin per litre is still positive, so the litre targets still exist.
  assert.equal(typeof loss.breakEvenLitresDay, 'number');
  assert.equal(typeof loss.targetLitresDay, 'number');

  const base = calculate(SIMPLE, SIMPLE_PRICE);
  const zero = calculate({ ...SIMPLE, soldLitresPerDay: base.breakEvenLitresDay }, SIMPLE_PRICE);
  // Break-even volume lands within rounding of zero; force the exact case too.
  assert.ok(Math.abs(zero.annualMargin) < 1e-6);
  const exactZero = calculate(
    {
      ...SIMPLE,
      soldLitresPerDay: 0,
      hoursPerDay: 0,
      electricityPerYear: 0,
      maintenancePerYear: 0,
      labTestsPerYear: 0,
      insurancePerYear: 0,
    },
    SIMPLE_PRICE,
  );
  assert.equal(exactZero.annualMargin, 0);
  assert.equal(exactZero.paybackMonths, NO_PAYBACK);
});

test('a losing cash flow keeps falling', () => {
  const loss = calculate({ ...SIMPLE, soldLitresPerDay: 5 }, SIMPLE_PRICE);
  assert.ok(loss.cashFlow[60] < loss.cashFlow[0]);
});

test('a non-positive margin per litre is not profitable at this price', () => {
  const r = calculate({ ...SIMPLE, sellPrice: 0.5 }, SIMPLE_PRICE);

  assert.ok(r.marginPerSoldLitre < 0);
  assert.equal(r.breakEvenLitresDay, NOT_PROFITABLE);
  assert.equal(r.targetLitresDay, NOT_PROFITABLE);
  assert.equal(r.paybackMonths, NO_PAYBACK);
});

test('a margin per litre of exactly zero is not profitable at this price', () => {
  const r = calculate(
    { ...SIMPLE, sellPrice: 1, paymentFeeShare: 0, bottleCostPerL: 0, wasteShare: 0 },
    100 / 1.03,
  );

  close(r.marginPerSoldLitre, 0, 1e-12);
  assert.equal(r.breakEvenLitresDay, NOT_PROFITABLE);
  assert.equal(r.targetLitresDay, NOT_PROFITABLE);
});

test('zero days open never divides by zero', () => {
  const r = calculate({ ...SIMPLE, daysOpen: 0 }, SIMPLE_PRICE);

  assert.equal(r.breakEvenLitresDay, NOT_PROFITABLE);
  assert.equal(r.targetLitresDay, NOT_PROFITABLE);
  assert.equal(r.paybackMonths, NO_PAYBACK);
});

test('a zero investment pays back immediately', () => {
  const r = calculate({ ...SIMPLE, investment: 0 }, SIMPLE_PRICE);

  assert.equal(r.paybackMonths, 0);
  assert.equal(r.cashFlow[0], 0);
});

test('more waste lowers the margin per sold litre', () => {
  const low = calculate({ ...SIMPLE, wasteShare: 0.05 }, SIMPLE_PRICE);
  const high = calculate({ ...SIMPLE, wasteShare: 0.3 }, SIMPLE_PRICE);

  assert.ok(high.marginPerSoldLitre < low.marginPerSoldLitre);
});

test('a waste share of 100 % or more is rejected', () => {
  assert.throws(() => calculate({ ...SIMPLE, wasteShare: 1 }, SIMPLE_PRICE), RangeError);
  assert.throws(() => calculate({ ...SIMPLE, wasteShare: -0.1 }, SIMPLE_PRICE), RangeError);
  assert.throws(() => calculate({ ...SIMPLE, wasteShare: NaN }, SIMPLE_PRICE), RangeError);
});

test('calculate does not modify its inputs', () => {
  const inputs = { ...SIMPLE };
  calculate(inputs, SIMPLE_PRICE);
  assert.deepEqual(inputs, SIMPLE);
});

test('default scenario factors match the brief', () => {
  assert.deepEqual(SCENARIO_FACTORS.pessimistic, { litresFactor: 0.75, wasteDelta: 0.05 });
  assert.deepEqual(SCENARIO_FACTORS.expected, { litresFactor: 1, wasteDelta: 0 });
  assert.deepEqual(SCENARIO_FACTORS.optimistic, { litresFactor: 1.25, wasteDelta: 0 });
});

test('applyScenario scales litres and adds waste percentage points', () => {
  const pessimistic = applyScenario(SIMPLE, SCENARIO_FACTORS.pessimistic);

  close(pessimistic.soldLitresPerDay, 37.5);
  close(pessimistic.wasteShare, 0.25);
  assert.equal(pessimistic.sellPrice, SIMPLE.sellPrice);
  assert.equal(SIMPLE.soldLitresPerDay, 50);
});

test('applyScenario keeps waste below 100 %', () => {
  const s = applyScenario({ ...SIMPLE, wasteShare: 0.98 }, { litresFactor: 1, wasteDelta: 0.05 });
  assert.equal(s.wasteShare, 0.99);
});

test('the three scenarios are ordered and the expected one equals the plain result', () => {
  const s = calculateScenarios(SIMPLE, SIMPLE_PRICE, SCENARIO_FACTORS);

  assert.deepEqual(Object.keys(s), ['pessimistic', 'expected', 'optimistic']);
  assert.deepEqual(s.expected, calculate(SIMPLE, SIMPLE_PRICE));
  assert.ok(s.pessimistic.annualMargin < s.expected.annualMargin);
  assert.ok(s.expected.annualMargin < s.optimistic.annualMargin);

  // Pessimistic: 37.5 L/day, 25 % waste → margin 1.3 − 0.412 / 0.75 per litre.
  const pessimisticMargin = 1.3 - 0.412 / 0.75;
  close(s.pessimistic.marginPerSoldLitre, pessimisticMargin);
  close(s.pessimistic.annualMargin, pessimisticMargin * 37.5 * 300 - 4000);
  // Optimistic: 62.5 L/day, waste unchanged.
  close(s.optimistic.annualMargin, 0.785 * 62.5 * 300 - 4000);
});

test('scenario factors are configurable', () => {
  const s = calculateScenarios(SIMPLE, SIMPLE_PRICE, {
    half: { litresFactor: 0.5, wasteDelta: 0 },
    double: { litresFactor: 2, wasteDelta: 0.1 },
  });

  assert.deepEqual(Object.keys(s), ['half', 'double']);
  close(s.half.annualMargin, 0.785 * 25 * 300 - 4000);
  close(s.double.annualMargin, (1.3 - 0.412 / 0.7) * 100 * 300 - 4000);
});
