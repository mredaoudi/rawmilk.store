// Generates the static site into dist/ from the templates below, the locale
// files and the price data. No dependencies: run it with `npm run build`.
//
// Optional environment variables:
//   SITE_URL          public address, used for canonical and hreflang links
//                     (default https://rawmilk.store)
//   PLAUSIBLE_DOMAIN  adds the Plausible script for that domain
//   PLAUSIBLE_SRC     Plausible script address, if self-hosted
//   UMAMI_WEBSITE_ID  with UMAMI_SRC, adds the Umami script
//   UMAMI_SRC

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AUTHORITY_URLS, DATA_PORTAL_URL } from '../src/js/authorities.js';
import { CASH_FLOW_MONTHS } from '../src/js/calc.js';
import {
  COUNTRIES,
  DEFAULTS,
  HERD_TYPES,
  NUMERIC_KEYS,
  SCENARIO_FACTORS,
} from '../src/js/defaults.js';
import { toDisplay } from '../src/js/state.js';
import { MAX_AGE_MONTHS, MAX_CHANGE, MAX_PRICE, MIN_PRICE } from './lib/prices.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const LANGS = ['fr', 'nl', 'de', 'en'];
const KTLO_URL = 'https://ktlo.be';
const SCRIPTS = ['app.js', 'calc.js', 'chart.js', 'defaults.js', 'price.js', 'state.js'];

const FORMULAS = `dairyPricePerL     = pricePer100kg × 1.03 / 100
marginPerSoldLitre = sellPrice × (1 − paymentFeeShare)
                     − bottleCostPerL
                     − dairyPricePerL / (1 − wasteShare)
annualFixed        = hoursPerDay × daysOpen × hourlyValue
                     + electricityPerYear + maintenancePerYear
                     + labTestsPerYear + insurancePerYear
annualMargin       = marginPerSoldLitre × soldLitresPerDay × daysOpen − annualFixed
paybackMonths      = investment / (annualMargin / 12)
breakEvenLitresDay = annualFixed / (marginPerSoldLitre × daysOpen)
targetLitresDay    = (annualFixed + investment / paybackTargetYears)
                     / (marginPerSoldLitre × daysOpen)
cashFlow[m]        = −investment + m × annualMargin / 12,  m = 0..${CASH_FLOW_MONTHS}`;

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1c5cab"/><path d="M13 5h6v5l4 6v9a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2v-9l4-6z" fill="#fff"/><path d="M11.55 18.8V24M11.55 21c0-1.4.9-2.2 2.3-2.2M15.25 18.8V24M15.25 20.8c0-1.3.6-2 1.3-2s1.3.7 1.3 2V24M17.85 20.8c0-1.3.6-2 1.3-2s1.3.7 1.3 2V24" fill="none" stroke="#1c5cab" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
`;

// ── Helpers ─────────────────────────────────────────────────────────────────

const esc = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fill = (template, values = {}) =>
  template.replace(/\{(\w+)\}/g, (match, name) => (name in values ? values[name] : match));

// Looks up "a.b.c" in a locale and fails loudly if a string is missing.
function translator(strings) {
  return (key, values) => {
    const text = key.split('.').reduce((node, part) => node?.[part], strings);
    if (typeof text !== 'string') {
      throw new Error(`Missing string "${key}" in locale "${strings.meta?.lang}"`);
    }
    return fill(text, values);
  };
}

const jsonForScript = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

function formatters(locale) {
  const number = (digits) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits });
  return {
    number: (value, digits = 2) => number(digits).format(value),
    fixed: (value, digits) =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value),
    percent: (fraction) =>
      new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
        fraction,
      ),
    month: (month) => {
      const [year, monthNumber] = month.split('-').map(Number);
      return new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
    },
    date: (iso) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
        new Date(iso),
      ),
  };
}

function scenarioValues(format) {
  return {
    down: format.percent(1 - SCENARIO_FACTORS.pessimistic.litresFactor),
    waste: format.number(SCENARIO_FACTORS.pessimistic.wasteDelta * 100),
    up: format.percent(SCENARIO_FACTORS.optimistic.litresFactor - 1),
  };
}

function analytics(env) {
  if (env.PLAUSIBLE_DOMAIN) {
    const src = env.PLAUSIBLE_SRC || 'https://plausible.io/js/script.js';
    return `<script defer data-domain="${esc(env.PLAUSIBLE_DOMAIN)}" src="${esc(src)}"></script>`;
  }
  if (env.UMAMI_WEBSITE_ID && env.UMAMI_SRC) {
    return `<script defer data-website-id="${esc(env.UMAMI_WEBSITE_ID)}" src="${esc(env.UMAMI_SRC)}"></script>`;
  }
  return '';
}

// ── Shared page shell ───────────────────────────────────────────────────────

function page({ strings, locales, siteUrl, env, pagePath, title, body, head = '', bodyClass }) {
  const t = translator(strings);
  const { lang } = strings.meta;
  const isCalculator = pagePath === '';
  const url = (code) => `/${code}/${pagePath}`;

  const alternates = LANGS.map(
    (code) => `<link rel="alternate" hreflang="${code}" href="${siteUrl}${url(code)}">`,
  ).join('\n  ');
  const xDefault = isCalculator ? `${siteUrl}/` : `${siteUrl}${url('en')}`;

  const langLinks = LANGS.map((code) => {
    const current = code === lang ? ' aria-current="true"' : '';
    const keep = isCalculator ? ` data-keep-state="${url(code)}"` : '';
    return `<li><a href="${url(code)}" lang="${code}" hreflang="${code}"${keep}${current}>${code.toUpperCase()}<span class="sr-only"> ${esc(locales[code].meta.langName)}</span></a></li>`;
  }).join('');

  const navLink = (href, label, current) =>
    `<li><a href="${href}"${current ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`;

  const builtBy = fill(esc(t('site.builtBy')), {
    ktlo: `<a href="${KTLO_URL}" rel="noopener">KTLO</a>`,
  });

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(t('site.description'))}">
  <meta name="color-scheme" content="light dark">
  <link rel="canonical" href="${siteUrl}${url(lang)}">
  ${alternates}
  <link rel="alternate" hreflang="x-default" href="${xDefault}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(t('site.description'))}">
  <meta property="og:url" content="${siteUrl}${url(lang)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/style.css">
  ${head}${analytics(env)}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
  <a class="skip" href="#main">${esc(t('site.skip'))}</a>
  <header class="site-header">
    <div class="wrap">
      <a class="brand" href="/${lang}/"><img class="brand-logo" src="/favicon.svg" alt="" width="28" height="28">rawmilk.store</a>
      <nav aria-label="${esc(t('site.navLabel'))}">
        <ul>
          ${navLink(`/${lang}/`, t('site.navCalculator'), isCalculator)}
          ${navLink(`/${lang}/method/`, t('site.navMethod'), !isCalculator)}
        </ul>
      </nav>
      <nav class="langs" aria-label="${esc(t('site.languageLabel'))}">
        <ul>${langLinks}</ul>
      </nav>
    </div>
  </header>
  <main id="main" class="wrap">
${body}
  </main>
  <footer class="site-footer">
    <div class="wrap">
      <p>${esc(t('site.disclaimer'))}</p>
      <p>${builtBy}</p>
    </div>
  </footer>
</body>
</html>
`;
}

// ── Calculator page ─────────────────────────────────────────────────────────

function field(key, t) {
  const def = DEFAULTS[key];
  const value = toDisplay(key, def.value);
  const label = t(`inputs.${key}.label`);
  const range = `min="${def.min}" max="${def.max}" step="${def.step}" value="${value}"`;
  return `<div class="field">
            <label for="in-${key}">${esc(label)}</label>
            <div class="field-controls">
              <input type="range" id="range-${key}" ${range} aria-label="${esc(label)} (${esc(t('form.sliderSuffix'))})">
              <span class="number">
                <input type="number" id="in-${key}" inputmode="decimal" ${range} aria-describedby="unit-${key}">
                <span class="unit" id="unit-${key}">${esc(t(`inputs.${key}.unit`))}</span>
              </span>
            </div>
          </div>`;
}

function calculatorPage(context) {
  const { strings, prices, format } = context;
  const t = translator(strings);
  const { lang } = strings.meta;

  const mainFields = NUMERIC_KEYS.filter((key) => !DEFAULTS[key].advanced);
  const advancedFields = NUMERIC_KEYS.filter((key) => DEFAULTS[key].advanced);

  const countryOptions = COUNTRIES.map(
    (code) =>
      `<option value="${code}"${code === DEFAULTS.country.value ? ' selected' : ''}>${esc(t(`countries.${code}`))}</option>`,
  ).join('');

  const herdOptions = HERD_TYPES.map(
    (type) =>
      `<label><input class="sr-only" type="radio" name="herdType" value="${type}"${type === DEFAULTS.herdType.value ? ' checked' : ''}><span>${esc(t(`price.${type}`))}</span></label>`,
  ).join('');

  const scenarioRows = Object.keys(SCENARIO_FACTORS)
    .map(
      (name) => `<tr data-scenario="${name}">
                  <th scope="row">${esc(t(`scenarios.${name}`))}</th>
                  <td data-cell="litres"></td>
                  <td data-cell="margin"></td>
                  <td data-cell="payback"></td>
                </tr>`,
    )
    .join('\n                ');

  const chartHeading = t('chart.heading', { months: CASH_FLOW_MONTHS });
  const authorities = Object.fromEntries(COUNTRIES.map((code) => [code, AUTHORITY_URLS[code][lang]]));

  // Everything the page script needs. Method-only strings are left out.
  const { method, defaultSources, ...appStrings } = strings;
  const appData = { strings: appStrings, prices, authorities, sourceUrl: DATA_PORTAL_URL };

  const head = `${SCRIPTS.filter((file) => file !== 'app.js')
    .map((file) => `<link rel="modulepreload" href="/assets/${file}">`)
    .join('\n  ')}
  <script type="module" src="/assets/app.js"></script>
  `;

  const body = `    <div class="intro">
      <h1>${esc(t('home.h1'))}</h1>
      <p>${esc(t('home.intro'))}</p>
    </div>
    <noscript><p class="panel">${esc(t('site.noscript'))}</p></noscript>

    <section class="print-only panel" aria-hidden="true">
      <h2>${esc(t('print.heading'))}</h2>
      <p id="print-date"></p>
      <dl class="print-inputs" id="print-inputs"></dl>
    </section>

    <div class="layout">
      <form id="calc-form" class="panel stack" novalidate>
        <section class="stack" aria-labelledby="price-heading">
          <h2 id="price-heading">${esc(t('price.heading'))}</h2>
          <div class="price-controls">
            <div>
              <label for="country">${esc(t('price.country'))}</label>
              <select id="country" name="country">${countryOptions}</select>
            </div>
            <fieldset>
              <legend>${esc(t('price.herdType'))}</legend>
              <div class="segmented">${herdOptions}</div>
            </fieldset>
          </div>
          <div>
            <p class="price-value"><span id="price-value">–</span><span class="badge" id="price-stale" hidden>${esc(t('price.stale'))}</span></p>
            <p class="price-line" id="price-line"></p>
          </div>
          <div class="price-note" id="price-note"></div>
          <p class="authority" id="authority"></p>
        </section>

        <div class="fields stack">
          <h2>${esc(t('form.heading'))}</h2>
          <div>
          ${mainFields.map((key) => field(key, t)).join('\n          ')}
          </div>
          <details>
            <summary>${esc(t('form.advanced'))}</summary>
            <div>
          ${advancedFields.map((key) => field(key, t)).join('\n          ')}
            </div>
          </details>
          <button type="button" class="button" id="reset">${esc(t('form.reset'))}</button>
        </div>
      </form>

      <section class="results" aria-labelledby="results-heading">
        <h2 id="results-heading" class="sr-only">${esc(t('results.heading'))}</h2>

        <div class="headline" id="headline">
          <div class="panel">
            <p class="stat-label">${esc(t('results.annualMargin'))}</p>
            <strong class="stat-value" id="res-margin">–</strong>
            <p class="stat-note">${esc(t('results.annualMarginNote'))}</p>
          </div>
          <div class="panel">
            <p class="stat-label">${esc(t('results.payback'))}</p>
            <strong class="stat-value" id="res-payback">–</strong>
            <p class="stat-note" id="res-payback-years"></p>
          </div>
        </div>

        <div class="panel">
          <dl class="facts">
            <div><dt>${esc(t('results.breakEven'))}</dt><dd id="res-breakeven">–</dd></div>
            <div><dt id="res-target-label">${esc(t('results.target', { years: DEFAULTS.paybackTargetYears.value }))}</dt><dd id="res-target">–</dd></div>
            <div><dt>${esc(t('results.marginPerLitre'))}</dt><dd id="res-margin-litre">–</dd></div>
            <div><dt>${esc(t('results.annualFixed'))}</dt><dd id="res-fixed">–</dd></div>
          </dl>
        </div>

        <div class="panel">
          <h3>${esc(t('scenarios.heading'))}</h3>
          <p class="note">${esc(t('scenarios.note', scenarioValues(format)))}</p>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">${esc(t('scenarios.scenario'))}</th>
                  <th scope="col">${esc(t('scenarios.litres'))}</th>
                  <th scope="col">${esc(t('scenarios.margin'))}</th>
                  <th scope="col">${esc(t('scenarios.payback'))}</th>
                </tr>
              </thead>
              <tbody>
                ${scenarioRows}
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel">
          <h3>${esc(chartHeading)}</h3>
          <ul class="legend">
            <li><span class="key key-line"></span>${esc(t('chart.expected'))}</li>
            <li><span class="key key-band"></span>${esc(t('chart.range'))}</li>
          </ul>
          <div class="chart" id="chart-root" tabindex="0" role="group" aria-label="${esc(chartHeading)}. ${esc(t('chart.keyboard'))}"></div>
          <details class="no-print">
            <summary>${esc(t('chart.table'))}</summary>
            <div class="table-scroll">
              <table id="chart-table">
                <thead><tr><th scope="col">${esc(t('chart.tableMonth'))}</th></tr></thead>
                <tbody></tbody>
              </table>
            </div>
          </details>
        </div>

        <div class="actions no-print">
          <button type="button" class="button button-primary" id="copy-link">${esc(t('share.copy'))}</button>
          <button type="button" class="button" id="print">${esc(t('share.print'))}</button>
          <span class="share-status" id="share-status" role="status"></span>
        </div>
      </section>
    </div>

    <p class="sr-only" id="live" aria-live="polite"></p>
    <div class="sticky-summary" id="sticky-summary" aria-hidden="true">
      <div><span>${esc(t('results.annualMargin'))}</span><strong id="sticky-margin">–</strong></div>
      <div><span>${esc(t('results.payback'))}</span><strong id="sticky-payback">–</strong></div>
    </div>
    <script type="application/json" id="app-data">${jsonForScript(appData)}</script>`;

  return page({
    ...context,
    pagePath: '',
    title: `${t('site.title')} · rawmilk.store`,
    body,
    head,
    bodyClass: 'has-sticky',
  });
}

// ── Method page ─────────────────────────────────────────────────────────────

function methodPage(context) {
  const { strings, prices, format } = context;
  const t = translator(strings);

  const terms = Object.keys(strings.method.terms)
    .map((key) => `<dt>${esc(key)}</dt><dd>${esc(t(`method.terms.${key}`))}</dd>`)
    .join('\n        ');

  const defaultLabel = (key) =>
    key === 'country' || key === 'herdType' ? t(`price.${key}`) : t(`inputs.${key}.label`);
  const defaultValue = (key) => {
    const { value } = DEFAULTS[key];
    if (key === 'country') return t(`countries.${value}`);
    if (key === 'herdType') return t(`price.${value}`);
    return `${format.number(toDisplay(key, value))} ${t(`inputs.${key}.unit`)}`;
  };
  const defaultRows = Object.keys(DEFAULTS)
    .map(
      (key) => `<tr>
              <th scope="row">${esc(defaultLabel(key))}</th>
              <td class="num">${esc(defaultValue(key))}</td>
              <td>${esc(t(`defaultSources.${key}`))}</td>
              <td>${esc(t(DEFAULTS[key].verified ? 'method.verified' : 'method.unverified'))}</td>
            </tr>`,
    )
    .join('\n            ');

  const priceRows = COUNTRIES.flatMap((code) =>
    HERD_TYPES.map((type) => {
      const entry = prices.countries[code]?.[type];
      const cells = entry
        ? `<td class="num">${format.fixed(entry.per100kg, 2)}</td>
              <td class="num">${format.fixed(entry.perLitre, 4)}</td>
              <td>${esc(format.month(entry.month))}${entry.stale ? ` <span class="badge">${esc(t('price.stale'))}</span>` : ''}</td>`
        : `<td colspan="3">${esc(t('method.noData'))}</td>`;
      return `<tr>
              <th scope="row">${esc(t(`countries.${code}`))}</th>
              <td>${esc(t(`price.${type}`))}</td>
              ${cells}
            </tr>`;
    }),
  ).join('\n            ');

  const checks = t('method.dataChecks', {
    min: MIN_PRICE,
    max: MAX_PRICE,
    months: MAX_AGE_MONTHS,
    change: format.percent(MAX_CHANGE),
  });

  const body = `    <article class="prose">
      <div class="intro">
        <h1>${esc(t('method.title'))}</h1>
        <p>${esc(t('method.intro'))}</p>
      </div>

      <h2>${esc(t('method.formulasHeading'))}</h2>
      <p>${esc(t('method.formulasIntro'))}</p>
      <pre><code>${esc(FORMULAS)}</code></pre>
      <p>${esc(t('method.edgeCases'))}</p>

      <h2>${esc(t('method.termsHeading'))}</h2>
      <dl>
        ${terms}
      </dl>

      <h2>${esc(t('method.scenariosHeading'))}</h2>
      <p>${esc(t('method.scenariosText', scenarioValues(format)))}</p>

      <h2>${esc(t('method.defaultsHeading'))}</h2>
      <p>${esc(t('method.defaultsIntro'))}</p>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">${esc(t('method.colInput'))}</th>
              <th scope="col" class="num">${esc(t('method.colDefault'))}</th>
              <th scope="col">${esc(t('method.colSource'))}</th>
              <th scope="col">${esc(t('method.colStatus'))}</th>
            </tr>
          </thead>
          <tbody>
            ${defaultRows}
          </tbody>
        </table>
      </div>

      <h2>${esc(t('method.dataHeading'))}</h2>
      <p>${esc(t('method.dataText'))}</p>
      <p>${esc(checks)}</p>
      <p>${esc(t('method.dataFallback'))}</p>
      <p><strong>${esc(t('method.lastUpdate', { date: format.date(prices.fetchedAt) }))}</strong></p>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">${esc(t('method.colCountry'))}</th>
              <th scope="col">${esc(t('price.herdType'))}</th>
              <th scope="col" class="num">${esc(t('method.colPer100kg'))}</th>
              <th scope="col" class="num">${esc(t('method.colPerLitre'))}</th>
              <th scope="col">${esc(t('method.colMonth'))}</th>
            </tr>
          </thead>
          <tbody>
            ${priceRows}
          </tbody>
        </table>
      </div>
      <p>${esc(t('method.dataSource'))}: <a href="${esc(DATA_PORTAL_URL)}" rel="noopener">${esc(t('price.sourceName'))}</a></p>
      <p class="break">${esc(t('method.dataApi'))}: <a href="${esc(prices.sourceUrl)}" rel="noopener">${esc(prices.sourceUrl)}</a></p>

      <h2>${esc(t('method.disclaimerHeading'))}</h2>
      <p><strong>${esc(t('site.disclaimer'))}</strong> ${esc(t('method.disclaimerText'))}</p>
    </article>`;

  return page({
    ...context,
    pagePath: 'method/',
    title: `${t('method.title')} · rawmilk.store`,
    body,
  });
}

// ── Root page: language chooser ─────────────────────────────────────────────

function rootPage({ locales, siteUrl, env }) {
  const links = LANGS.map(
    (code) =>
      `<li><a class="button" href="/${code}/" lang="${code}" hreflang="${code}">${esc(locales[code].meta.langName)}</a></li>`,
  ).join('\n      ');
  const alternates = LANGS.map(
    (code) => `<link rel="alternate" hreflang="${code}" href="${siteUrl}/${code}/">`,
  ).join('\n  ');

  // Sends visitors to their browser language, keeping any shared scenario.
  const redirect = `(function () {
      var supported = ${JSON.stringify(LANGS)};
      var wanted = navigator.languages || [navigator.language || ''];
      for (var i = 0; i < wanted.length; i++) {
        var code = String(wanted[i]).slice(0, 2).toLowerCase();
        if (supported.indexOf(code) !== -1) {
          location.replace('/' + code + '/' + location.search);
          return;
        }
      }
    })();`;

  return `<!doctype html>
<html lang="mul">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>rawmilk.store</title>
  <meta name="color-scheme" content="light dark">
  <link rel="canonical" href="${siteUrl}/">
  ${alternates}
  <link rel="alternate" hreflang="x-default" href="${siteUrl}/">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/style.css">
  <script>
    ${redirect}
  </script>
  ${analytics(env)}
</head>
<body>
  <main class="chooser">
    <h1>rawmilk.store</h1>
    <ul>
      ${links}
    </ul>
  </main>
</body>
</html>
`;
}

// ── Build ───────────────────────────────────────────────────────────────────

const readJson = async (file) => JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));

export async function build({ outDir = path.join(ROOT, 'dist'), env = process.env } = {}) {
  const siteUrl = (env.SITE_URL || 'https://rawmilk.store').replace(/\/+$/, '');
  const prices = await readJson('src/data/prices.json');
  const locales = {};
  for (const lang of LANGS) locales[lang] = await readJson(`src/locales/${lang}.json`);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, 'assets'), { recursive: true });

  const written = [];
  const write = async (file, content) => {
    const target = path.join(outDir, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    written.push(file);
  };

  await write('index.html', rootPage({ locales, siteUrl, env }));
  for (const lang of LANGS) {
    const strings = locales[lang];
    const context = {
      strings,
      locales,
      prices,
      siteUrl,
      env,
      format: formatters(strings.meta.numberLocale),
    };
    await write(`${lang}/index.html`, calculatorPage(context));
    await write(`${lang}/method/index.html`, methodPage(context));
  }

  await write('favicon.svg', FAVICON);
  await cp(path.join(ROOT, 'src/css/style.css'), path.join(outDir, 'assets/style.css'));
  for (const file of SCRIPTS) {
    await cp(path.join(ROOT, 'src/js', file), path.join(outDir, 'assets', file));
  }

  return { outDir, pages: written.filter((file) => file.endsWith('.html')) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { outDir, pages } = await build();
  console.log(`Built ${pages.length} pages into ${path.relative(process.cwd(), outDir) || '.'}`);
}
