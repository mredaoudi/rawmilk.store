import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LANGS, build } from '../scripts/build.js';
import { AUTHORITY_URLS } from '../src/js/authorities.js';
import { COUNTRIES, DEFAULTS, NUMERIC_KEYS, PRICE_FALLBACK } from '../src/js/defaults.js';

const readLocale = async (lang) =>
  JSON.parse(await readFile(new URL(`../src/locales/${lang}.json`, import.meta.url), 'utf8'));

// "a.b.c" for every string in a locale.
function keysOf(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'object' ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort().join();
const lookup = (node, key) => key.split('.').reduce((value, part) => value[part], node);

test('every locale has exactly the same strings', async () => {
  const reference = await readLocale('en');
  const expected = keysOf(reference).sort();

  for (const lang of LANGS) {
    const locale = await readLocale(lang);
    assert.deepEqual(keysOf(locale).sort(), expected, lang);
    assert.equal(locale.meta.lang, lang);

    for (const key of expected) {
      const text = lookup(locale, key);
      assert.ok(typeof text === 'string' && text.trim() !== '', `${lang}: ${key} is empty`);
      assert.equal(placeholders(text), placeholders(lookup(reference, key)), `${lang}: ${key}`);
    }
  }
});

test('every locale covers every input, default, country and authority', async () => {
  for (const lang of LANGS) {
    const locale = await readLocale(lang);
    assert.deepEqual(Object.keys(locale.inputs).sort(), [...NUMERIC_KEYS].sort(), lang);
    assert.deepEqual(Object.keys(locale.defaultSources).sort(), Object.keys(DEFAULTS).sort(), lang);
    assert.deepEqual(Object.keys(locale.countries).sort(), [...COUNTRIES].sort(), lang);
    assert.deepEqual(Object.keys(locale.authorities).sort(), [...COUNTRIES].sort(), lang);
  }
});

test('every country has an authority link in every language', () => {
  for (const country of COUNTRIES) {
    for (const lang of LANGS) {
      assert.match(AUTHORITY_URLS[country][lang], /^https:\/\//, `${country} ${lang}`);
    }
  }
});

test('price fallbacks point at real countries', () => {
  for (const [from, to] of Object.entries(PRICE_FALLBACK)) {
    assert.ok(COUNTRIES.includes(from) && COUNTRIES.includes(to) && from !== to);
  }
});

test('the build writes the root page plus two pages per language', async (t) => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'rawmilk-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));

  const { pages } = await build({ outDir, env: { SITE_URL: 'https://example.test/' } });
  assert.deepEqual(
    pages.sort(),
    ['index.html', ...LANGS.flatMap((l) => [`${l}/index.html`, `${l}/method/index.html`])].sort(),
  );

  const root = await readFile(path.join(outDir, 'index.html'), 'utf8');
  assert.match(root, /navigator\.languages/);
  for (const lang of LANGS) assert.ok(root.includes(`href="/${lang}/"`));

  for (const lang of LANGS) {
    const locale = await readLocale(lang);
    for (const page of ['', 'method/']) {
      const html = await readFile(path.join(outDir, lang, page, 'index.html'), 'utf8');
      const where = `/${lang}/${page}`;

      assert.ok(html.includes(`<html lang="${lang}">`), where);
      assert.ok(html.includes(`<link rel="canonical" href="https://example.test/${lang}/${page}">`), where);
      for (const other of LANGS) {
        assert.ok(
          html.includes(`hreflang="${other}" href="https://example.test/${other}/${page}"`),
          `${where} hreflang ${other}`,
        );
      }
      assert.ok(html.includes('hreflang="x-default"'), where);
      assert.ok(html.includes('href="https://ktlo.be"'), where);
      assert.ok(!/undefined|\[object Object\]|NaN/.test(html), `${where} has a broken value`);
      // No template placeholder left behind outside the embedded page data.
      const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
      assert.ok(!/\{\w+\}/.test(visible), `${where} has an unfilled placeholder`);
      assert.ok(!/plausible|umami/i.test(html), `${where} has analytics without being asked`);
    }

    const calculator = await readFile(path.join(outDir, lang, 'index.html'), 'utf8');
    for (const key of NUMERIC_KEYS) {
      assert.ok(calculator.includes(`id="in-${key}"`) && calculator.includes(`id="range-${key}"`));
    }
    const data = JSON.parse(calculator.match(/id="app-data">([\s\S]*?)<\/script>/)[1]);
    assert.equal(data.strings.meta.lang, lang);
    assert.ok(data.prices.countries.BE.conventional.per100kg > 0);
    assert.equal(data.strings.method, undefined);

    const method = await readFile(path.join(outDir, lang, 'method', 'index.html'), 'utf8');
    assert.ok(method.includes('marginPerSoldLitre'));
    assert.ok(method.includes(locale.method.unverified));
    assert.ok(method.includes(locale.site.disclaimer.replace(/'/g, '&#39;')) || method.includes(locale.site.disclaimer));
  }
});

test('analytics is added only when its environment variable is set', async (t) => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'rawmilk-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));

  await build({ outDir, env: { PLAUSIBLE_DOMAIN: 'rawmilk.store' } });
  const html = await readFile(path.join(outDir, 'en', 'index.html'), 'utf8');
  assert.ok(html.includes('data-domain="rawmilk.store" src="https://plausible.io/js/script.js"'));
});
