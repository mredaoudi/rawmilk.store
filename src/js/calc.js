// Profitability model for selling raw milk directly instead of delivering it
// to the dairy. Pure functions only: no DOM, no I/O, no dependencies.

export const KG_PER_LITRE = 1.03;
export const CASH_FLOW_MONTHS = 60;

// Returned in place of a number when a result does not exist.
export const NO_PAYBACK = 'does not pay back';
export const NOT_PROFITABLE = 'not profitable at this price';

export function dairyPricePerLitre(pricePer100kg) {
  return (pricePer100kg * KG_PER_LITRE) / 100;
}

/**
 * @param {object} inputs  Plain numbers, keyed as in src/js/defaults.js.
 * @param {number} pricePer100kg  Dairy price in €/100 kg.
 */
export function calculate(inputs, pricePer100kg) {
  const {
    soldLitresPerDay,
    daysOpen,
    sellPrice,
    investment,
    paymentFeeShare,
    bottleCostPerL,
    wasteShare,
    hoursPerDay,
    hourlyValue,
    electricityPerYear,
    maintenancePerYear,
    labTestsPerYear,
    insurancePerYear,
    paybackTargetYears,
  } = inputs;

  if (!(wasteShare >= 0 && wasteShare < 1)) {
    throw new RangeError('wasteShare must be at least 0 and below 1');
  }

  const dairyPricePerL = dairyPricePerLitre(pricePer100kg);

  const marginPerSoldLitre =
    sellPrice * (1 - paymentFeeShare) - bottleCostPerL - dairyPricePerL / (1 - wasteShare);

  const annualFixed =
    hoursPerDay * daysOpen * hourlyValue +
    electricityPerYear +
    maintenancePerYear +
    labTestsPerYear +
    insurancePerYear;

  const annualMargin = marginPerSoldLitre * soldLitresPerDay * daysOpen - annualFixed;

  const paybackMonths = annualMargin > 0 ? investment / (annualMargin / 12) : NO_PAYBACK;

  const marginPerLitreDay = marginPerSoldLitre * daysOpen;
  const profitablePerLitre = marginPerSoldLitre > 0 && marginPerLitreDay > 0;

  const breakEvenLitresDay = profitablePerLitre ? annualFixed / marginPerLitreDay : NOT_PROFITABLE;

  const targetLitresDay =
    profitablePerLitre && paybackTargetYears > 0
      ? (annualFixed + investment / paybackTargetYears) / marginPerLitreDay
      : NOT_PROFITABLE;

  const cashFlow = [];
  for (let m = 0; m <= CASH_FLOW_MONTHS; m++) {
    cashFlow.push(-investment + (m * annualMargin) / 12);
  }

  return {
    dairyPricePerL,
    marginPerSoldLitre,
    annualFixed,
    annualMargin,
    paybackMonths,
    breakEvenLitresDay,
    targetLitresDay,
    cashFlow,
  };
}

// Waste can never reach 100 %: the model divides by (1 − wasteShare).
const MAX_WASTE_SHARE = 0.99;

export function applyScenario(inputs, factor) {
  return {
    ...inputs,
    soldLitresPerDay: inputs.soldLitresPerDay * factor.litresFactor,
    wasteShare: Math.min(inputs.wasteShare + factor.wasteDelta, MAX_WASTE_SHARE),
  };
}

/**
 * @param {object} factors  One entry per scenario, each { litresFactor, wasteDelta }.
 * @returns {object} The same keys as `factors`, each holding a calculate() result.
 */
export function calculateScenarios(inputs, pricePer100kg, factors) {
  const out = {};
  for (const [name, factor] of Object.entries(factors)) {
    out[name] = calculate(applyScenario(inputs, factor), pricePer100kg);
  }
  return out;
}
