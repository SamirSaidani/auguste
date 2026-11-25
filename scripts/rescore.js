#!/usr/bin/env node
// Grade stored runs again with the current grading rules.
// Usage: node scripts/rescore.js <folder or run.json>...
// Reads run files written by the repository sync (runs/**/*.json) and prints, for each run
// that carries raw data, the stored score next to the score under the current rules.
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../js/scoring.js');

const LETTER = { good: 'G', approx: 'a', off: 'x', missed: '.' };

function files(target) {
  const st = fs.statSync(target);
  if (st.isFile()) return [target];
  return fs.readdirSync(target).flatMap((name) => files(path.join(target, name))).filter((f) => f.endsWith('.json'));
}

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error('Usage: node scripts/rescore.js <folder or run.json>...');
  process.exit(2);
}
let count = 0;
targets.flatMap(files).sort().forEach((file) => {
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!run.raw) return;
  const r = S.rescore(run);
  const bars = r.measures.map((m) => m.grades.map((g) => LETTER[g]).join('') + (m.extra ? '+' + m.extra : '')).join(' ');
  const alone = r.tempoAlone ? ' | alone ' + r.tempoAlone.toFixed(1) : '';
  console.log(run.date + ' ' + run.id + ' ' + run.bpm + ' bpm ' + run.metro + ' | stored ' + run.percent + '% -> now ' +
    r.percent + '% ' + (r.passed ? 'PASS' : 'FAIL') + alone + ' | ' + bars);
  count += 1;
});
console.error(count + ' run(s) with raw data');
