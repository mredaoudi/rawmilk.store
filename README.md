# rawmilk.store

**What is my milk worth if I sell it myself?**

rawmilk.store is a free, single-page calculator for dairy farmers who are thinking about selling raw milk directly (through an on-farm vending machine or farm shop) instead of delivering all of it to the dairy.

## What it does

The farmer moves a few sliders (litres sold per day, price per litre, machine cost, time spent cleaning and refilling) and instantly sees:

- what the dairy pays for that milk this month
- the extra margin per year from selling direct
- how many months until the machine pays for itself
- how many litres a day are needed to break even

Any scenario can be shared as a link or printed for an accountant or bank.

## Why it's different

- **Made for farmers who sell, not consumers who buy.**
- **Neutral.** No vendor links; every assumption is visible, sourced and editable.
- **Always current.** The dairy price updates automatically every month from the European Commission's official raw milk price data.
- **Multilingual.** French, Dutch, German and English.

## What it isn't

Not a farm directory, not a shop, and not financial or legal advice. For permits, it links to each country's food safety authority.

## How it is built

Plain HTML, CSS and JavaScript. There is no framework, no backend, no database and nothing to install: the only tool needed is [Node.js](https://nodejs.org) 20 or newer, which runs the scripts below.

```
src/
  js/calc.js          the profitability formulas (pure functions)
  js/defaults.js      starting values, slider ranges, scenario factors
  js/app.js           calculator page behaviour
  js/chart.js         cash-flow chart, drawn as inline SVG
  js/state.js         shareable link encoding
  js/price.js         which dairy price to use, including fallbacks
  js/authorities.js   food safety authority links
  css/style.css       all styles, light and dark
  locales/            every piece of text, one file per language (fr, nl, de, en)
  data/prices.json    dairy prices, written by the fetch script
scripts/
  build.js            generates the site into dist/
  fetch-prices.js     updates src/data/prices.json
  check-defaults.js   lists starting values not yet verified
  serve.js            local preview server
tests/                unit tests and a saved real API response
dist/                 the generated site: this is what you upload
```

## Setup

```
npm run build      # generate the site into dist/
npm run preview    # build, then serve it at http://localhost:4321/
npm test           # run the tests
```

`npm install` is not needed: the project has no dependencies.

The pages load JavaScript modules, so open them through `npm run preview` or a web host. Double-clicking an HTML file in `dist/` will show the page without a working calculator.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Generates the 9 pages (language chooser, plus calculator and method page in 4 languages) into `dist/`. |
| `npm run preview` | Builds, then serves `dist/` locally. Set `PORT` to change the port. |
| `npm test` | Runs the tests for the formulas, the price checks, the shared links, the translations and the build. |
| `npm run fetch:prices` | Fetches the latest dairy prices and rewrites `src/data/prices.json`. |
| `npm run update` | `fetch:prices` followed by `build`. This is the monthly job. |
| `npm run check:defaults` | Lists every starting value still marked `verified: false`. |

Build options, set as environment variables:

| Variable | Effect |
|---|---|
| `SITE_URL` | Public address used in canonical and `hreflang` links. Default `https://rawmilk.store`. |
| `PLAUSIBLE_DOMAIN` | Adds the Plausible analytics script for that domain. `PLAUSIBLE_SRC` overrides the script address. |
| `UMAMI_WEBSITE_ID` and `UMAMI_SRC` | Adds the Umami analytics script. Both are required. |

Without those variables the site loads no analytics. It sets no cookies either way.

## Deploying

Upload the contents of `dist/` to any static host. On Cloudflare Pages, the build command is `npm run build` and the output directory is `dist`.

## How the data job works

`npm run fetch:prices` calls the European Commission's Agri-food Data Portal:

```
GET https://api.tech.ec.europa.eu/agrifood/api/rawMilk/prices
    ?memberStateCodes=BE,NL,LU,DE,FR&years=<last year>,<this year>
```

For each country it takes the latest month of "Raw milk" (conventional) and "Organic raw milk", converts € per 100 kg to € per litre at 1.03 kg per litre, and writes `src/data/prices.json`.

Each value is checked before it is accepted:

- it is between 20 and 90 € per 100 kg
- its month is no more than 4 months old
- it differs by less than 30 % from the value already stored

If a check fails, the stored value is kept and marked `"stale": true`, the script prints the reason, and it exits with code 1. The site then shows an "Outdated" badge next to that price. If the API cannot be reached at all, every stored value is marked stale.

A series the Commission does not publish is stored as `null` and reported as a note, not a failure. Two fallbacks then apply on the site, each with a visible note:

- no organic price: the conventional price of that country is used
- no price at all: the price of the country named in `PRICE_FALLBACK` in `src/js/defaults.js` is used. This is the case for Luxembourg, whose last published price dates from November 2018, so it uses the Belgian price.

**Scheduling is not set up in this repository.** To keep the site current, run `npm run update` once a month (the brief suggests the 12th) and redeploy `dist/`. The exit code tells a scheduler whether to raise an alert.

If a price really does move by 30 % or more, the script will keep rejecting it. Check the figure at the source, correct `per100kg`, `perLitre` and `month` by hand in `src/data/prices.json`, set `stale` to `false`, then rebuild.

## How to update defaults

Starting values live in `src/js/defaults.js`. Each one looks like this:

```js
sellPrice: {
  value: 1.2,
  unit: '€/L',
  source: 'Placeholder, pending a survey of Belgian vending machines',
  verified: false,
  ...
}
```

1. Change `value`.
2. Put the reference in `source` and set `verified: true` once it is confirmed.
3. Update the matching text under `defaultSources` in each of the four files in `src/locales/`: that is what the method page shows.
4. Run `npm test`, then `npm run build`.

`npm run check:defaults` shows what is left to verify. The same file holds the slider ranges (`min`, `max`, `step`) and the scenario factors (`SCENARIO_FACTORS`).

Do not rename the one-letter `key` of an input: shared links already in circulation use it.

Assumptions made where the brief was silent are logged in [DECISIONS.md](DECISIONS.md).

---

Built and maintained by [KTLO](https://ktlo.be).