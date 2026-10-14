// Calculator page behaviour: reads the form, runs the model, shows the results.

import { CASH_FLOW_MONTHS, calculateScenarios } from './calc.js';
import { createChart } from './chart.js';
import { DEFAULTS, NUMERIC_KEYS, SCENARIO_FACTORS, defaultInputs } from './defaults.js';
import { resolvePrice } from './price.js';
import { clampDisplay, decodeState, encodeState, fromDisplay, toDisplay } from './state.js';

const { strings, prices, authorities, sourceUrl } = JSON.parse(
  document.getElementById('app-data').textContent,
);
const locale = strings.meta.numberLocale;
const $ = (id) => document.getElementById(id);

// ── Formatting ──────────────────────────────────────────────────────────────

const fill = (template, values) =>
  template.replace(/\{(\w+)\}/g, (match, name) => (name in values ? values[name] : match));

const number = (digits) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const currency = (digits) =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const format = {
  euros: (value) => currency(0).format(Math.round(value) || 0),
  cents: (value) => currency(2).format(value),
  perLitre: (value) => currency(3).format(value),
  compact: (value) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value),
  plain: (value, digits = 2) => number(digits).format(value),
  month: (month) => {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
      new Date(year, monthNumber - 1, 1),
    );
  },
  today: () => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date()),
};

// A payback of 18.2 months is reached during month 19.
const wholeMonths = (months) => Math.ceil(months - 1e-9);

function paybackText(months) {
  if (typeof months !== 'number') return strings.results.noPayback;
  return fill(strings.results.months, { n: format.plain(wholeMonths(months), 0) });
}

function paybackYearsText(months) {
  if (typeof months !== 'number' || wholeMonths(months) < 24) return '';
  return fill(strings.results.years, { n: format.plain(months / 12, 1) });
}

const litresText = (litres) =>
  typeof litres === 'number'
    ? fill(strings.results.litresDay, { n: format.plain(litres, 1) })
    : strings.results.notProfitable;

function inputText(key, value) {
  return `${format.plain(toDisplay(key, value), 2)} ${strings.inputs[key].unit}`;
}

// Fills an element from a template, putting a DOM node in place of {slot}.
function fillWithNode(element, template, slot, node) {
  const [before, after = ''] = template.split(`{${slot}}`);
  element.replaceChildren(before, node, after);
}

function link(href, label) {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.textContent = label;
  anchor.rel = 'noopener';
  return anchor;
}

// ── State and form ──────────────────────────────────────────────────────────

let state = decodeState(location.search);
let hasChanged = location.search.length > 1;

const form = $('calc-form');
const countrySelect = $('country');
const herdRadios = [...form.querySelectorAll('input[name="herdType"]')];

function syncForm() {
  countrySelect.value = state.country;
  for (const radio of herdRadios) radio.checked = radio.value === state.herdType;
  for (const key of NUMERIC_KEYS) {
    const shown = toDisplay(key, state[key]);
    $(`in-${key}`).value = shown;
    $(`range-${key}`).value = shown;
  }
}

function setNumeric(key, shown) {
  const clamped = clampDisplay(key, shown);
  if (clamped === null) return false;
  state[key] = fromDisplay(key, clamped);
  return true;
}

function changed() {
  hasChanged = true;
  render();
}

for (const key of NUMERIC_KEYS) {
  const numberInput = $(`in-${key}`);
  const rangeInput = $(`range-${key}`);

  rangeInput.addEventListener('input', () => {
    if (!setNumeric(key, rangeInput.valueAsNumber)) return;
    numberInput.value = toDisplay(key, state[key]);
    changed();
  });
  // While typing, the field is left alone; it is tidied up once the user leaves it.
  numberInput.addEventListener('input', () => {
    if (!setNumeric(key, numberInput.valueAsNumber)) return;
    rangeInput.value = toDisplay(key, state[key]);
    changed();
  });
  numberInput.addEventListener('change', () => {
    numberInput.value = toDisplay(key, state[key]);
  });
}

countrySelect.addEventListener('change', () => {
  state.country = countrySelect.value;
  changed();
});
for (const radio of herdRadios) {
  radio.addEventListener('change', () => {
    if (radio.checked) state.herdType = radio.value;
    changed();
  });
}
form.addEventListener('submit', (event) => event.preventDefault());

$('reset').addEventListener('click', () => {
  state = defaultInputs();
  hasChanged = false;
  syncForm();
  render();
});

// ── Sharing and printing ────────────────────────────────────────────────────

const shareUrl = () => `${location.origin}${location.pathname}?${encodeState(state)}`;

function syncUrl() {
  const search = hasChanged ? `?${encodeState(state)}` : '';
  history.replaceState(null, '', `${location.pathname}${search}`);
  // Switching language keeps the scenario.
  for (const anchor of document.querySelectorAll('[data-keep-state]')) {
    anchor.href = `${anchor.dataset.keepState}${search}`;
  }
}

let copyTimer;
$('copy-link').addEventListener('click', async () => {
  const status = $('share-status');
  try {
    await navigator.clipboard.writeText(shareUrl());
    status.textContent = strings.share.copied;
  } catch {
    hasChanged = true;
    syncUrl();
    status.textContent = strings.share.failed;
  }
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    status.textContent = '';
  }, 4000);
});

$('print').addEventListener('click', () => window.print());

// ── Rendering ───────────────────────────────────────────────────────────────

const chart = createChart($('chart-root'), $('chart-table'), {
  money: format.euros,
  compact: format.compact,
  month: (n) => fill(strings.chart.month, { n }),
  label: (start, end) =>
    fill(strings.chart.label, {
      months: CASH_FLOW_MONTHS,
      start: format.euros(start),
      end: format.euros(end),
    }),
  xAxis: strings.chart.xAxis,
  paidBack: strings.chart.paidBack,
  expected: strings.scenarios.expected,
  pessimistic: strings.scenarios.pessimistic,
  optimistic: strings.scenarios.optimistic,
  range: strings.chart.range,
});

function renderPrice(price) {
  const note = $('price-note');
  note.replaceChildren();
  const addNote = (text) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    note.append(paragraph);
  };

  fillWithNode(
    $('authority'),
    strings.price.authority,
    'link',
    link(authorities[state.country], strings.authorities[state.country]),
  );

  $('price-stale').hidden = !price?.entry.stale;

  if (!price) {
    $('price-line').textContent = '';
    $('price-value').textContent = '–';
    addNote(strings.price.unavailable);
    return;
  }

  const { entry } = price;
  fillWithNode(
    $('price-line'),
    fill(strings.price.line, {
      country: strings.countries[price.country],
      month: format.month(entry.month),
    }),
    'source',
    link(sourceUrl, strings.price.sourceName),
  );
  $('price-value').textContent = fill(strings.price.value, {
    per100kg: format.cents(entry.per100kg),
    perLitre: format.perLitre(entry.perLitre),
  });

  if (entry.stale) addNote(strings.price.staleNote);
  if (price.countryFallback) {
    addNote(fill(strings.price.countryFallback, { other: strings.countries[price.country] }));
  }
  if (price.organicFallback) addNote(strings.price.organicFallback);
}

function renderPrintSummary() {
  $('print-date').textContent = fill(strings.print.date, { date: format.today() });
  const list = $('print-inputs');
  list.replaceChildren();
  const add = (label, value) => {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
    row.append(term, detail);
    list.append(row);
  };
  add(strings.price.country, strings.countries[state.country]);
  add(strings.price.herdType, strings.price[state.herdType]);
  for (const key of NUMERIC_KEYS) add(strings.inputs[key].label, inputText(key, state[key]));
}

let liveTimer;
function announce(text) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    $('live').textContent = text;
  }, 800);
}

const RESULT_IDS = ['res-margin', 'res-payback', 'res-breakeven', 'res-target', 'res-margin-litre', 'res-fixed', 'sticky-margin', 'sticky-payback'];

function render() {
  syncUrl();
  const price = resolvePrice(prices, state.country, state.herdType);
  renderPrice(price);
  renderPrintSummary();

  $('res-target-label').textContent = fill(strings.results.target, {
    years: format.plain(state.paybackTargetYears, 0),
  });

  if (!price) {
    for (const id of RESULT_IDS) $(id).textContent = '–';
    $('res-payback-years').textContent = '';
    return;
  }

  const scenarios = calculateScenarios(state, price.entry.per100kg, SCENARIO_FACTORS);
  const result = scenarios.expected;

  const margin = format.euros(result.annualMargin);
  const payback = paybackText(result.paybackMonths);
  $('res-margin').textContent = margin;
  $('res-payback').textContent = payback;
  $('res-payback-years').textContent = paybackYearsText(result.paybackMonths);
  $('sticky-margin').textContent = margin;
  $('sticky-payback').textContent = payback;
  $('res-breakeven').textContent = litresText(result.breakEvenLitresDay);
  $('res-target').textContent = litresText(result.targetLitresDay);
  $('res-margin-litre').textContent = format.cents(result.marginPerSoldLitre);
  $('res-fixed').textContent = format.euros(result.annualFixed);

  for (const [name, factor] of Object.entries(SCENARIO_FACTORS)) {
    const row = document.querySelector(`[data-scenario="${name}"]`);
    if (!row) continue;
    row.querySelector('[data-cell="litres"]').textContent = litresText(
      state.soldLitresPerDay * factor.litresFactor,
    );
    row.querySelector('[data-cell="margin"]').textContent = format.euros(
      scenarios[name].annualMargin,
    );
    row.querySelector('[data-cell="payback"]').textContent = paybackText(
      scenarios[name].paybackMonths,
    );
  }

  chart.update({
    expected: result.cashFlow,
    low: scenarios.pessimistic.cashFlow,
    high: scenarios.optimistic.cashFlow,
    paybackMonths: result.paybackMonths,
  });

  announce(fill(strings.results.live, { margin, payback }));
}

// The summary bar appears only while the headline results are off screen.
const stickyBar = $('sticky-summary');
new IntersectionObserver(([entry]) => {
  stickyBar.classList.toggle('is-visible', !entry.isIntersecting);
}).observe($('headline'));

syncForm();
render();
