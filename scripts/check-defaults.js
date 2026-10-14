// Lists every default still marked `verified: false` in src/js/defaults.js.
// Run it with `npm run check:defaults`.

import { DEFAULTS } from '../src/js/defaults.js';

const entries = Object.entries(DEFAULTS);
const unverified = entries.filter(([, def]) => !def.verified);

if (unverified.length === 0) {
  console.log(`All ${entries.length} defaults are verified.`);
} else {
  console.log(`${unverified.length} of ${entries.length} defaults are not verified yet:\n`);
  const width = Math.max(...unverified.map(([key]) => key.length));
  for (const [key, def] of unverified) {
    console.log(`  ${key.padEnd(width)}  ${String(def.value).padStart(6)} ${def.unit}`);
    console.log(`  ${' '.repeat(width)}  ${def.source}`);
  }
}
