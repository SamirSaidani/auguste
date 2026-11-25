// Scoring: matches detected claps against the expected notes.
// Pure functions, no DOM and no audio, so they run under Node for tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RTScoring = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Tolerances are fractions of a sixteenth note, with absolute floors so
  // that fast tempos stay humanly achievable. All values are in seconds.
  const DEFAULTS = {
    goodFrac: 0.30, // within 30% of a sixteenth: good
    okFrac: 0.50,   // within 50%: approximate
    minGood: 0.050,
    minOk: 0.080,
    offsetCap: 0.040, // a steady personal lead/lag up to 40 ms is not penalised
    fitWindow: 4,     // recent claps used to follow the learner's own tempo
  };

  function median(values) {
    if (!values.length) return 0;
    const s = values.slice().sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // Least-squares fit time = a + b * beat.
  function fit(pairs) {
    const n = pairs.length;
    if (n < 2) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    pairs.forEach(([x, y]) => { sx += x; sy += y; sxx += x * x; sxy += x * y; });
    const den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-12) return null;
    const b = (n * sxy - sx * sy) / den;
    return { a: (sy - b * sx) / n, b };
  }

  // notes: [{pos (beats), measure}] for sounding notes only, in order.
  // claps: clap times in seconds, relative to beat 0, latency already removed.
  // opts: {bpm, free (bool), freeFrom (beat where the metronome stops), beatsPerMeasure, measureCount}
  // Without a metronome nobody keeps the exact grid: from freeFrom on, claps are graded against
  // the learner's own tempo (fitted on the last claps), and tempo keeping is measured separately.
  function score(notes, claps, opts, tol) {
    const t = Object.assign({}, DEFAULTS, tol || {});
    const beat = 60 / opts.bpm;
    const sixteenth = beat / 4;
    const good = Math.max(t.minGood, t.goodFrac * sixteenth);
    const ok = Math.max(t.minOk, t.okFrac * sixteenth);
    const sorted = claps.slice().sort((a, b) => a - b);
    const used = new Array(sorted.length).fill(false);
    const matched = [];
    const results = notes.map(() => ({ grade: 'missed', error: null, clap: null }));
    const freeFrom = opts.free ? 0 : (opts.freeFrom === undefined ? Infinity : opts.freeFrom);

    notes.forEach((note, i) => {
      // Expected time: fixed grid with a metronome, followed tempo in free mode.
      let expected = note.pos * beat;
      if (note.pos >= freeFrom && matched.length) {
        // On your own: expected one step after your last clap, at the tempo of your recent claps.
        const f = fit(matched.slice(-t.fitWindow));
        const [lastPos, lastTime] = matched[matched.length - 1];
        if (f && f.b > 0) expected = lastTime + (note.pos - lastPos) * f.b;
      }
      const prevGap = i > 0 ? note.pos - notes[i - 1].pos : 1;
      const nextGap = i < notes.length - 1 ? notes[i + 1].pos - note.pos : 1;
      const window = Math.max(ok, 0.5 * Math.min(prevGap, nextGap) * beat);
      let best = -1;
      let bestErr = Infinity;
      sorted.forEach((c, j) => {
        if (used[j]) return;
        const err = c - expected;
        if (Math.abs(err) <= window && Math.abs(err) < Math.abs(bestErr)) { best = j; bestErr = err; }
      });
      if (best >= 0) {
        used[best] = true;
        results[i] = { grade: null, error: bestErr, clap: sorted[best] };
        matched.push([note.pos, sorted[best]]);
      }
    });

    // A steady lead or lag (calibration error or personal habit) is reported, and compensated up to offsetCap.
    const errors = results.filter((r) => r.error !== null).map((r) => r.error);
    const offset = median(errors);
    const comp = Math.max(-t.offsetCap, Math.min(t.offsetCap, offset));
    results.forEach((r) => {
      if (r.error === null) return;
      const e = Math.abs(r.error - comp);
      r.grade = e <= good ? 'good' : e <= ok ? 'approx' : 'off';
    });

    const extras = sorted.filter((_, j) => !used[j]);
    const count = (g) => results.filter((r) => r.grade === g).length;
    const counts = { good: count('good'), approx: count('approx'), off: count('off'), missed: count('missed'), extra: extras.length };

    // Tempo actually held, overall and first half against second half.
    const whole = fit(matched);
    const half = matched.length >> 1;
    const first = fit(matched.slice(0, half));
    const second = fit(matched.slice(half));
    const bpmOf = (f) => (f && f.b > 0 ? 60 / f.b : null);
    const tempo = bpmOf(whole);
    const drift = bpmOf(first) && bpmOf(second) ? (bpmOf(second) - bpmOf(first)) / bpmOf(first) : null;

    // Per measure: grades in order, extra claps counted against the measure they fall in.
    const measures = [];
    for (let m = 0; m < opts.measureCount; m++) measures.push({ grades: [], extra: 0 });
    notes.forEach((n, i) => measures[n.measure].grades.push(results[i].grade));
    extras.forEach((c) => {
      const m = Math.floor(c / beat / opts.beatsPerMeasure);
      if (m >= 0 && m < measures.length) measures[m].extra += 1;
    });
    const lost = measures.filter((m) => m.grades.length && m.grades.filter((g) => g === 'missed' || g === 'off').length * 2 >= m.grades.length).length;

    const total = notes.length;
    const percent = total ? Math.round(100 * (counts.good + 0.5 * counts.approx) / total) : 0;
    // Tempo held without the metronome (silent part only), when there is one.
    const alone = bpmOf(fit(matched.filter(([pos]) => pos >= freeFrom)));
    const tempoDev = (alone || tempo) ? ((alone || tempo) - opts.bpm) / opts.bpm : null;
    const passed = percent >= 90 && lost === 0 && counts.extra <= Math.ceil(total * 0.05) &&
      (freeFrom === Infinity || (tempoDev !== null && Math.abs(tempoDev) <= 0.05));

    return { results, counts, extras, offset, tempo, tempoAlone: alone, tempoDev, drift, measures, lost, percent, passed, windows: { good, ok } };
  }

  return { DEFAULTS, score, median, fit };
});
