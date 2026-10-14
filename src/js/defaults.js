// Every default the calculator starts from.
//
// To change a default: edit `value`. Once you have a real source for it, put
// the reference in `source` and set `verified: true`.
// `npm run check:defaults` lists everything still marked `verified: false`.
//
// The remaining keys drive the form:
//   key     short name used in shared links (never rename: old links would break)
//   min/max/step   slider range, in the unit shown to the user
//   percent        stored as a fraction (0.02) but shown and shared as a percentage (2)
//   advanced       shown under "More assumptions" instead of the main form

export const COUNTRIES = ['BE', 'NL', 'LU', 'DE', 'FR'];
export const HERD_TYPES = ['conventional', 'organic'];

// Countries with no usable dairy price of their own borrow a neighbour's.
// The page always says so when this happens.
export const PRICE_FALLBACK = { LU: 'BE' };

export const DEFAULTS = {
  country: {
    value: 'BE',
    unit: 'ISO code',
    source: 'Design choice: KTLO is based in Belgium',
    verified: true,
    key: 'c',
  },
  herdType: {
    value: 'conventional',
    unit: 'conventional | organic',
    source: 'Design choice: the most common case',
    verified: true,
    key: 'o',
  },
  soldLitresPerDay: {
    value: 30,
    unit: 'L/day',
    source: 'Placeholder',
    verified: false,
    key: 'l',
    min: 0,
    max: 300,
    step: 1,
  },
  sellPrice: {
    value: 1.2,
    unit: '€/L',
    source: 'Placeholder, pending a survey of Belgian vending machines',
    verified: false,
    key: 'p',
    min: 0.5,
    max: 3,
    step: 0.05,
  },
  investment: {
    value: 20000,
    unit: '€',
    source:
      'University of Hohenheim study on German Milchtankstellen: an investment under €20,000 is realistic (reference not yet checked)',
    verified: false,
    key: 'i',
    min: 0,
    max: 60000,
    step: 500,
  },
  hoursPerDay: {
    value: 0.75,
    unit: 'h/day',
    source: 'Placeholder',
    verified: false,
    key: 'h',
    min: 0,
    max: 4,
    step: 0.25,
  },
  daysOpen: {
    value: 365,
    unit: 'days/year',
    source: 'Placeholder',
    verified: false,
    key: 'd',
    min: 1,
    max: 365,
    step: 1,
    advanced: true,
  },
  paymentFeeShare: {
    value: 0.02,
    unit: 'fraction',
    source: 'Placeholder',
    verified: false,
    key: 'f',
    min: 0,
    max: 10,
    step: 0.5,
    percent: true,
    advanced: true,
  },
  bottleCostPerL: {
    value: 0,
    unit: '€/L',
    source: 'Placeholder: customers usually bring or buy their own bottles',
    verified: false,
    key: 'b',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
  },
  wasteShare: {
    value: 0.1,
    unit: 'fraction of milk loaded',
    source: 'Placeholder',
    verified: false,
    key: 'w',
    min: 0,
    max: 50,
    step: 1,
    percent: true,
    advanced: true,
  },
  hourlyValue: {
    value: 20,
    unit: '€/h',
    source: 'Placeholder',
    verified: false,
    key: 'v',
    min: 0,
    max: 60,
    step: 1,
    advanced: true,
  },
  electricityPerYear: {
    value: 400,
    unit: '€/year',
    source: 'Placeholder',
    verified: false,
    key: 'e',
    min: 0,
    max: 3000,
    step: 50,
    advanced: true,
  },
  maintenancePerYear: {
    value: 500,
    unit: '€/year',
    source: 'Placeholder: yearly hose replacement plus monthly calibration',
    verified: false,
    key: 'm',
    min: 0,
    max: 3000,
    step: 50,
    advanced: true,
  },
  labTestsPerYear: {
    value: 300,
    unit: '€/year',
    source: 'Placeholder',
    verified: false,
    key: 't',
    min: 0,
    max: 3000,
    step: 50,
    advanced: true,
  },
  insurancePerYear: {
    value: 200,
    unit: '€/year',
    source: 'Placeholder',
    verified: false,
    key: 's',
    min: 0,
    max: 3000,
    step: 50,
    advanced: true,
  },
  paybackTargetYears: {
    value: 5,
    unit: 'years',
    source: 'Design choice: matches the 60-month cash-flow chart',
    verified: true,
    key: 'y',
    min: 1,
    max: 15,
    step: 1,
    advanced: true,
  },
};

// The numeric inputs, in the order the form shows them.
export const NUMERIC_KEYS = Object.keys(DEFAULTS).filter(
  (key) => typeof DEFAULTS[key].value === 'number',
);

export const SCENARIO_FACTORS = {
  pessimistic: { litresFactor: 0.75, wasteDelta: 0.05 },
  expected: { litresFactor: 1, wasteDelta: 0 },
  optimistic: { litresFactor: 1.25, wasteDelta: 0 },
};

export function defaultInputs() {
  const inputs = {};
  for (const [key, def] of Object.entries(DEFAULTS)) inputs[key] = def.value;
  return inputs;
}
