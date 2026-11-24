// Rhythm text format parser.
//
// A lesson block:
//   # <id> <title>
//   4/4
//   h ssss q | sse q sse ssss | ess q ssss sse
//   ssss ess ee q | ...
//
// Each measure is split by "|". Inside a measure, tokens are separated by
// spaces; a token is a beam group made of note symbols:
//   w = whole, h = half, q = quarter, e = eighth, s = sixteenth
//   a trailing "." makes a note dotted, a leading "r" makes it a rest.
// Each source line becomes one "line" of the lesson (used to practise
// one line at a time).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RTRhythm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BEATS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };
  const SYMBOL = /r?[whqes]\.?/g;

  function parseToken(token) {
    const symbols = token.match(SYMBOL) || [];
    if (symbols.join('') !== token) throw new Error('Unknown symbol in "' + token + '"');
    return symbols.map((sym) => {
      const rest = sym[0] === 'r';
      const letter = rest ? sym[1] : sym[0];
      const dotted = sym.endsWith('.');
      const beats = BEATS[letter] * (dotted ? 1.5 : 1);
      return { letter, rest, dotted, beats };
    });
  }

  function parseMeasure(text, beatsPerMeasure) {
    const groups = text.trim().split(/\s+/).filter(Boolean).map(parseToken);
    const total = groups.flat().reduce((sum, n) => sum + n.beats, 0);
    if (Math.abs(total - beatsPerMeasure) > 1e-9) {
      throw new Error('Measure "' + text.trim() + '" lasts ' + total + ' beats, expected ' + beatsPerMeasure);
    }
    return groups;
  }

  // Parses a time signature like "3/4" and returns quarter-note beats per measure.
  function parseTime(text) {
    const m = /^(\d+)\/(\d+)$/.exec(text.trim());
    if (!m) return null;
    const num = Number(m[1]);
    const den = Number(m[2]);
    return { num, den, beats: num * 4 / den, label: num + '/' + den };
  }

  // Parses one lesson body (lines after the "#" header).
  function parseLesson(id, title, lines) {
    let time = parseTime('4/4');
    const out = [];
    lines.forEach((raw, i) => {
      const line = raw.replace(/\/\/.*$/, '').trim();
      if (!line) return;
      const t = parseTime(line);
      if (t) { time = t; return; }
      try {
        out.push(line.split('|').filter((m) => m.trim()).map((m) => parseMeasure(m, time.beats)));
      } catch (err) {
        throw new Error(id + ', line ' + (i + 1) + ': ' + err.message);
      }
    });
    if (!out.length) throw new Error(id + ': no measures');
    return { id, title, time, lines: out };
  }

  // Parses a text holding one or more "# id title" blocks.
  function parseLessons(text) {
    const lessons = [];
    let current = null;
    text.split(/\r?\n/).forEach((line) => {
      const header = /^#\s*(\S+)\s*(.*)$/.exec(line.trim());
      if (header) {
        current = { id: header[1], title: header[2] || header[1], body: [] };
        lessons.push(current);
      } else if (current) {
        current.body.push(line);
      }
    });
    return lessons.map((l) => parseLesson(l.id, l.title, l.body));
  }

  // Flattens the selected lines into a timed list of events (positions in beats).
  function timeline(lesson, lineIndexes) {
    const measures = [];
    lineIndexes.forEach((li) => lesson.lines[li].forEach((m) => measures.push(m)));
    const events = [];
    let pos = 0;
    measures.forEach((groups, mi) => {
      groups.forEach((group, gi) => {
        group.forEach((note, ni) => {
          events.push({ pos, beats: note.beats, rest: note.rest, measure: mi, group: gi, index: ni });
          pos += note.beats;
        });
      });
    });
    return { measures, events, totalBeats: pos, beatsPerMeasure: lesson.time.beats, time: lesson.time };
  }

  return { parseToken, parseMeasure, parseTime, parseLesson, parseLessons, timeline };
});
