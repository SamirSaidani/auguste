// Run with: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../js/rhythm.js');
const S = require('../js/scoring.js');
const E = require('../js/exercises.js');

function notesOf(lesson, lines) {
  const tl = R.timeline(lesson, lines);
  return { tl, notes: tl.events.filter((e) => !e.rest) };
}

test('built-in exercises parse and every measure has the right length', () => {
  const lessons = R.parseLessons(E.SOURCE);
  assert.ok(lessons.length >= 10);
  const ids = new Set(lessons.map((l) => l.id));
  E.STEPS.forEach((s) => s.items.forEach((it) => assert.ok(ids.has(it.id), it.id)));
});

test('wrong measure length is rejected', () => {
  assert.throws(() => R.parseLessons('# x X\n4/4\nq q q'), /expected 4/);
  assert.throws(() => R.parseLessons('# x X\n4/4\nq q q z'), /Unknown symbol/);
});

test('figures land on the right sixteenths', () => {
  const [l] = R.parseLessons('# x X\n4/4\nssss ess sse q');
  const pos = R.timeline(l, [0]).events.map((e) => e.pos);
  assert.deepStrictEqual(pos, [0, 0.25, 0.5, 0.75, 1, 1.5, 1.75, 2, 2.25, 2.5, 3]);
});

test('perfect claps score 100% and pass', () => {
  const [l] = R.parseLessons('# x X\n4/4\nssss ess sse q | q q h');
  const { tl, notes } = notesOf(l, [0]);
  const bpm = 60;
  const claps = notes.map((n) => n.pos * 60 / bpm);
  const r = S.score(notes, claps, { bpm, beatsPerMeasure: 4, measureCount: tl.measures.length });
  assert.strictEqual(r.percent, 100);
  assert.strictEqual(r.counts.missed, 0);
  assert.ok(r.passed);
  assert.ok(Math.abs(r.tempo - 60) < 0.01);
});

test('a steady 30 ms lag is compensated, a 150 ms error is off', () => {
  const [l] = R.parseLessons('# x X\n4/4\nq q q q');
  const { tl, notes } = notesOf(l, [0]);
  const claps = notes.map((n) => n.pos + 0.03);
  claps[2] = 2 + 0.03 + 0.15;
  const r = S.score(notes, claps, { bpm: 60, beatsPerMeasure: 4, measureCount: tl.measures.length });
  assert.deepStrictEqual(r.results.map((x) => x.grade), ['good', 'good', 'off', 'good']);
  assert.ok(Math.abs(r.offset - 0.03) < 1e-9);
});

test('missing and extra claps are counted', () => {
  const [l] = R.parseLessons('# x X\n4/4\nq q q q');
  const { tl, notes } = notesOf(l, [0]);
  const r = S.score(notes, [0, 1, 3, 3.6], { bpm: 60, beatsPerMeasure: 4, measureCount: tl.measures.length });
  assert.strictEqual(r.counts.missed, 1);
  assert.strictEqual(r.counts.extra, 1);
  assert.ok(!r.passed);
});

test('free mode follows a slowing tempo and reports the drift', () => {
  const [l] = R.parseLessons('# x X\n4/4\nq q q q | q q q q | q q q q | q q q q');
  const { tl, notes } = notesOf(l, [0]);
  // Starts at 60 bpm and slows down by 1% per beat.
  let t = 0;
  const claps = notes.map((n, i) => { const c = t; t += 1 * Math.pow(1.01, i); return c; });
  const grid = S.score(notes, claps, { bpm: 60, beatsPerMeasure: 4, measureCount: 4 });
  const free = S.score(notes, claps, { bpm: 60, free: true, beatsPerMeasure: 4, measureCount: 4 });
  assert.ok(free.percent > grid.percent);
  assert.ok(free.drift < -0.05);
  assert.ok(free.tempo < 60);
});

test('after the metronome stops, a steady pulse at a slightly different tempo is not marked wrong', () => {
  const [l] = R.parseLessons('# x X\n4/4\nq q q q | q q q q | q q q q | q q q q');
  const { notes } = notesOf(l, [0]);
  const bpm = 87, beat = 60 / bpm;
  for (const held of [85, 89]) {
    const claps = notes.map((n) => (n.pos < 8 ? n.pos * beat : 8 * beat + (n.pos - 8) * 60 / held));
    const r = S.score(notes, claps, { bpm, freeFrom: 8, beatsPerMeasure: 4, measureCount: 4 });
    assert.strictEqual(r.percent, 100, 'held ' + held);
    assert.ok(Math.abs(r.tempoAlone - held) < 0.2);
    assert.ok(r.passed, 'within 5 %');
  }
  // Abruptly 10 % slower on your own: the pulse stays regular, so few notes are wrong, but the tempo was not kept.
  const claps = notes.map((n) => (n.pos < 8 ? n.pos * beat : 8 * beat + (n.pos - 8) * 60 / (bpm * 0.9)));
  const r = S.score(notes, claps, { bpm, freeFrom: 8, beatsPerMeasure: 4, measureCount: 4 });
  assert.ok(r.percent >= 90, 'percent ' + r.percent);
  assert.ok(!r.passed);
});

test('private Agostini transcription parses when present', (t) => {
  const file = process.env.RT_LESSONS;
  if (!file || !fs.existsSync(file)) return t.skip('RT_LESSONS not set');
  const lessons = R.parseLessons(fs.readFileSync(path.resolve(file), 'utf8'));
  assert.ok(lessons.length > 0);
});
