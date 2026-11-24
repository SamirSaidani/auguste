// Built-in exercises, written for this app. Same text format as imported lessons.
// "steps" groups them in the order a learner should work through them.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RTExercises = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SOURCE = `
# diag-1 Pulse, metronome fades out
4/4
q q q q | q q q q | q q q q | q q q q

# diag-2 The three sixteenth figures
4/4
ssss ssss ssss ssss | ess ess ess ess | sse sse sse sse | q ess sse ssss

# diag-3 Reading line
4/4
q ssss ess q | sse q ee ssss | ess sse q ee | ssss ess sse q

# pulse-1 Quarter notes
4/4
q q q q | q q q q | q q q q | q q q q

# pulse-2 Quarters and eighths
4/4
q ee q ee | ee ee q q | q q ee ee | ee q ee q

# fig-1 Four sixteenths
4/4
q q ssss q | q ssss q ssss | ssss q ssss q | ssss ssss ssss q

# fig-2 Eighth + two sixteenths
4/4
q q ess q | q ess q ess | ess q ess q | ess ess ess q

# fig-3 Two sixteenths + eighth
4/4
q q sse q | q sse q sse | sse q sse q | sse sse sse q

# mix-1 Figures side by side
4/4
ssss ess ssss ess | ssss sse ssss sse | ess sse ess sse | sse ess sse q

# mix-2 With eighths
4/4
ee ssss ee ess | ee sse ee ssss | ess ee sse ee | ssss ee ess q

# line-1 Reading, 4/4
4/4
h ssss q | ess q sse ee | ssss sse q ess
q ess ssss q | sse ee ess q | ssss ssss sse q

# line-2 Reading, 3/4
3/4
ee ssss q | ess sse ee | h ssss
ssss ee ess | sse q ssss | q ssss rq
`;

  // Steps of the learning path. "metro" sets the default metronome mode.
  const STEPS = [
    { key: 'diagnostic', items: [
      { id: 'diag-1', metro: 'fade' },
      { id: 'diag-2', metro: 'all' },
      { id: 'diag-3', metro: 'all' },
      { id: 'diag-3', metro: 'countin', variant: 'free' },
    ] },
    { key: 'pulse', items: [{ id: 'pulse-1', metro: 'fade' }, { id: 'pulse-2', metro: 'all' }] },
    { key: 'figures', items: [{ id: 'fig-1', metro: 'all' }, { id: 'fig-2', metro: 'all' }, { id: 'fig-3', metro: 'all' }] },
    { key: 'mixes', items: [{ id: 'mix-1', metro: 'all' }, { id: 'mix-2', metro: 'all' }] },
    { key: 'reading', items: [{ id: 'line-1', metro: 'all' }, { id: 'line-2', metro: 'all' }] },
  ];

  return { SOURCE, STEPS };
});
