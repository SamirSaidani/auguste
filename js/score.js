// Draws a rhythm with VexFlow: one line of notes on a five-line staff, as in rhythm methods.
(function (root) {
  'use strict';

  const DURATION = { w: 'w', h: 'h', q: 'q', e: '8', s: '16' };
  const ROW_HEIGHT = 96;

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000';
  }

  // colors: optional array, one CSS color per event (rests included), in timeline order.
  function render(el, tl, colors) {
    const VF = Vex.Flow;
    el.innerHTML = '';
    const width = Math.max(280, el.clientWidth);
    const perRow = width >= 720 ? 4 : width >= 480 ? 3 : 2;
    const rows = Math.ceil(tl.measures.length / perRow);
    const renderer = new VF.Renderer(el, VF.Renderer.Backends.SVG);
    renderer.resize(width, rows * ROW_HEIGHT + 10);
    const ctx = renderer.getContext();
    const ink = cssVar('--ink');
    ctx.setFillStyle(ink);
    ctx.setStrokeStyle(ink);
    const svg = el.querySelector('svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Rhythm score');

    const sigExtra = 34;
    const boxes = [];
    let ev = 0;
    tl.measures.forEach((groups, mi) => {
      const row = Math.floor(mi / perRow);
      const col = mi % perRow;
      // Only the very first measure carries the time signature, as in the method book.
      const lead = row === 0 ? sigExtra : 0;
      const w = (width - 2 - lead) / perRow;
      const x = 1 + col * w + (col === 0 ? 0 : lead);
      const first = mi === 0;
      const stave = new VF.Stave(x, row * ROW_HEIGHT, w + (first ? lead : 0));
      if (first) stave.addTimeSignature(tl.time.label);
      stave.setContext(ctx).draw();

      const notes = [];
      const beams = [];
      groups.forEach((group) => {
        const groupNotes = group.map((n) => {
          const note = new VF.StaveNote({
            keys: ['b/4'],
            duration: DURATION[n.letter] + (n.rest ? 'r' : ''),
            auto_stem: true,
          });
          if (n.dotted) VF.Dot.buildAndAttach([note], { all: true });
          const c = colors && colors[ev];
          if (c) note.setStyle({ fillStyle: c, strokeStyle: c });
          ev += 1;
          return note;
        });
        notes.push(...groupNotes);
        const beamable = groupNotes.filter((_, i) => !group[i].rest && 'es'.includes(group[i].letter));
        if (beamable.length > 1 && beamable.length === groupNotes.length) beams.push(new VF.Beam(groupNotes));
      });
      VF.Formatter.FormatAndDraw(ctx, stave, notes);
      beams.forEach((b) => b.setContext(ctx).draw());
      boxes.push({ x: stave.getX() + (first ? lead : 0), y: stave.getYForLine(0) - 14, w: w, h: stave.getYForLine(4) - stave.getYForLine(0) + 28 });
    });

    // Measure cursor, moved during a run.
    const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    cursor.setAttribute('class', 'measure-cursor');
    cursor.setAttribute('rx', '6');
    cursor.setAttribute('visibility', 'hidden');
    svg.insertBefore(cursor, svg.firstChild);

    return {
      showMeasure(i) {
        const b = boxes[i];
        if (!b) { cursor.setAttribute('visibility', 'hidden'); return; }
        cursor.setAttribute('x', b.x); cursor.setAttribute('y', b.y);
        cursor.setAttribute('width', b.w); cursor.setAttribute('height', b.h);
        cursor.setAttribute('visibility', 'visible');
      },
    };
  }

  root.RTScore = { render };
})(self);
