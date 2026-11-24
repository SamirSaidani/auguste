// Page wiring: settings, exercise choice, runs, results, history, imported lessons.
(function () {
  'use strict';
  const { t, title } = RTi18n;
  const $ = (id) => document.getElementById(id);
  const engine = new RTAudio.Engine();
  const VERSION = 1;
  // Data written by earlier versions carries the former name.
  const APP_IDS = ['auguste', 'rhythm-trainer'];

  // ---------- storage (per phone, optional) ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem('rt.' + key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem('rt.' + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }

  const settings = Object.assign({
    tempo: 60, metro: 'all', guide: false, sensitivity: 5, volume: 0.6, goodTol: 30, okTol: 50, exercise: 'step:0:0', lines: [],
  }, load('settings', {}));
  let calibration = load('calibration', null);
  let userLessons = load('lessons', []); // [{text}]
  let history = load('history', []);

  // ---------- exercises ----------
  const builtIn = {};
  RTRhythm.parseLessons(RTExercises.SOURCE).forEach((l) => { builtIn[l.id] = l; });
  let imported = {};

  function parseUserLessons() {
    imported = {};
    userLessons.forEach((u) => {
      try { RTRhythm.parseLessons(u.text).forEach((l) => { imported[l.id] = l; }); } catch (e) { /* skipped: invalid */ }
    });
  }

  // Returns {lesson, metro, free} for an option value.
  function resolve(value) {
    const parts = value.split(':');
    if (parts[0] === 'step') {
      const item = RTExercises.STEPS[+parts[1]] && RTExercises.STEPS[+parts[1]].items[+parts[2]];
      if (item && builtIn[item.id]) return { lesson: builtIn[item.id], metro: item.metro, free: item.variant === 'free', item };
    }
    if (parts[0] === 'user' && imported[parts.slice(1).join(':')]) {
      return { lesson: imported[parts.slice(1).join(':')], metro: null };
    }
    const first = RTExercises.STEPS[0].items[0];
    return { lesson: builtIn[first.id], metro: first.metro, item: first };
  }

  function fillExercises() {
    const sel = $('exercise');
    sel.innerHTML = '';
    RTExercises.STEPS.forEach((step, si) => {
      const g = document.createElement('optgroup');
      g.label = t('step' + step.key);
      step.items.forEach((item, ii) => {
        const o = document.createElement('option');
        o.value = 'step:' + si + ':' + ii;
        const l = builtIn[item.id];
        o.textContent = title(item.id, l.title) + (item.variant === 'free' ? ' · ' + t('noMetro') : '');
        g.appendChild(o);
      });
      sel.appendChild(g);
    });
    const ids = Object.keys(imported);
    if (ids.length) {
      const g = document.createElement('optgroup');
      g.label = t('steplessons');
      ids.forEach((id) => {
        const o = document.createElement('option');
        o.value = 'user:' + id;
        o.textContent = imported[id].title;
        g.appendChild(o);
      });
      sel.appendChild(g);
    }
    if (![...sel.options].some((o) => o.value === settings.exercise)) settings.exercise = sel.options[0].value;
    sel.value = settings.exercise;
  }

  function current() { return resolve(settings.exercise); }

  function selectedLines() {
    const n = current().lesson.lines.length;
    const valid = settings.lines.filter((i) => i < n);
    return valid.length ? valid : [...Array(n).keys()];
  }

  function fillLines() {
    const box = $('lines');
    box.innerHTML = '';
    const n = current().lesson.lines.length;
    const make = (label, pressed, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(pressed));
      b.addEventListener('click', onClick);
      box.appendChild(b);
    };
    const all = settings.lines.filter((i) => i < n).length === 0;
    make(t('allLines'), all, () => { settings.lines = []; persist(); fillLines(); drawScore(); });
    if (n > 1) {
      for (let i = 0; i < n; i++) {
        make(t('line', { n: i + 1 }), !all && settings.lines.includes(i), () => {
          const set = new Set(settings.lines.filter((x) => x < n));
          if (set.has(i)) set.delete(i); else set.add(i);
          settings.lines = [...set].sort((a, b) => a - b);
          persist(); fillLines(); drawScore();
        });
      }
    }
  }

  // ---------- score ----------
  let view = null;
  let lastColors = null;
  function drawScore(colors) {
    lastColors = colors || null;
    const tl = RTRhythm.timeline(current().lesson, selectedLines());
    view = RTScore.render($('score'), tl, lastColors);
    const dots = $('beat-dots');
    dots.innerHTML = '';
    for (let i = 0; i < tl.beatsPerMeasure; i++) dots.appendChild(document.createElement('i'));
  }

  function legend() {
    const box = $('legend');
    box.innerHTML = '';
    [['good', '--good'], ['approx', '--approx'], ['off', '--off'], ['missed', '--missed']].forEach(([k, c]) => {
      const s = document.createElement('span');
      s.style.setProperty('--c', 'var(' + c + ')');
      s.textContent = t(k);
      box.appendChild(s);
    });
  }

  // ---------- calibration ----------
  function showCalibration() {
    const ok = !!calibration;
    $('calib').classList.toggle('ok', ok);
    $('calib-status').textContent = ok
      ? t('calibOk', { ms: Math.round(calibration.latency * 1000), spread: Math.round(calibration.spread * 1000) })
      : t('calibNone');
  }

  async function ensureEngine() {
    try {
      await engine.start();
    } catch (e) {
      $('calib-status').textContent = t('micDenied');
      throw e;
    }
    engine.settings.sensitivity = settings.sensitivity;
    if (calibration && !engine.calibrated) {
      engine.settings.latency = calibration.latency;
      engine.settings.threshold = calibration.threshold;
      engine.floor = calibration.floor;
      engine.calibrated = true;
    }
  }

  $('calib-btn').addEventListener('click', async () => {
    const btn = $('calib-btn');
    btn.disabled = true;
    try {
      await ensureEngine();
      const steps = { noise: 'calibNoise', latency: 'calibLatency', leak: 'calibLeak' };
      const r = await engine.calibrate((s) => { $('calib-status').textContent = t(steps[s]); });
      calibration = Object.assign(r, { date: new Date().toISOString() });
      engine.calibrated = true;
      save('calibration', calibration);
      showCalibration();
    } catch (e) {
      if (e && e.message === 'calibration-latency') $('calib-status').textContent = t('calibFailed');
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- run ----------
  let running = false;

  async function go() {
    if (running) { engine.stop(); return; }
    try { await ensureEngine(); } catch (e) { return; }
    if (!calibration) { $('live-text').textContent = t('needCalib'); $('calib').scrollIntoView({ behavior: 'smooth' }); return; }
    const cur = current();
    const lines = selectedLines();
    const tl = RTRhythm.timeline(cur.lesson, lines);
    drawScore();
    running = true;
    $('go').textContent = t('stop');
    $('go').classList.add('running');
    $('result').hidden = true;
    let claps = 0;
    $('clap-count').textContent = t('claps', { n: 0 });
    const dots = [...$('beat-dots').children];
    const plan = {
      bpm: settings.tempo,
      beatsPerMeasure: tl.beatsPerMeasure,
      countInBeats: Math.max(tl.beatsPerMeasure, 3),
      totalBeats: tl.totalBeats,
      metro: settings.metro,
      fadeBars: 2,
      guide: settings.guide,
      events: tl.events,
      volume: settings.volume,
    };
    let lastMeasure = -2;
    const res = await engine.run(plan, (ev) => {
      if (ev.clap !== undefined) { claps += 1; $('clap-count').textContent = t('claps', { n: claps }); return; }
      const b = ev.beat;
      const inBar = Math.floor(((b % tl.beatsPerMeasure) + tl.beatsPerMeasure) % tl.beatsPerMeasure);
      dots.forEach((d, i) => d.classList.toggle('on', i === inBar));
      $('live-text').textContent = b < 0 ? t('countIn') + ' ' + Math.ceil(-b) : t('clapNow');
      const m = b < 0 ? -1 : Math.floor(b / tl.beatsPerMeasure);
      if (m !== lastMeasure) { lastMeasure = m; view.showMeasure(m); }
    });
    running = false;
    $('go').textContent = t('start');
    $('go').classList.remove('running');
    dots.forEach((d) => d.classList.remove('on'));
    $('live-text').textContent = '';
    view.showMeasure(-1);
    if (res.stopped) return;
    finish(cur, lines, tl, res.claps);
  }

  function finish(cur, lines, tl, claps) {
    const notes = tl.events.filter((e) => !e.rest);
    const free = settings.metro === 'countin';
    const r = RTScoring.score(notes, claps, {
      bpm: settings.tempo, free, beatsPerMeasure: tl.beatsPerMeasure, measureCount: tl.measures.length,
    }, { goodFrac: settings.goodTol / 100, okFrac: settings.okTol / 100 });

    // Colors per event (rests stay ink).
    const css = getComputedStyle(document.documentElement);
    const col = { good: '--good', approx: '--approx', off: '--off', missed: '--missed' };
    let k = 0;
    const colors = tl.events.map((e) => (e.rest ? null : css.getPropertyValue(col[r.results[k++].grade]).trim()));
    drawScore(colors);

    const entry = {
      v: VERSION,
      date: new Date().toISOString(),
      id: cur.lesson.id,
      title: cur.lesson.title,
      lines: lines.length === cur.lesson.lines.length ? 'all' : lines.map((i) => i + 1).join(','),
      bpm: settings.tempo,
      metro: settings.metro,
      guide: settings.guide,
      percent: r.percent,
      passed: r.passed,
      counts: r.counts,
      offsetMs: Math.round(r.offset * 1000),
      tempo: r.tempo ? Math.round(r.tempo * 10) / 10 : null,
      driftPct: r.drift !== null ? Math.round(r.drift * 1000) / 10 : null,
      lost: r.lost,
      bars: r.measures.map((m) => m.grades.map((g) => ({ good: 'G', approx: 'a', off: 'x', missed: '.' }[g])).join('') + (m.extra ? '+' + m.extra : '')).join(' '),
      sens: settings.sensitivity,
    };
    history.unshift(entry);
    save('history', history);
    syncPending();
    showResult(entry);
    renderHistory();
  }

  function report(e) {
    const d = new Date(e.date);
    const pad = (n) => String(n).padStart(2, '0');
    const when = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    const c = e.counts;
    return [
      'RT' + e.v + ' | ' + when + ' | ' + e.id + ' | lines ' + e.lines + ' | ' + e.bpm + ' bpm | metro ' + e.metro + ' | guide ' + (e.guide ? 'on' : 'off'),
      'score ' + e.percent + '% ' + (e.passed ? 'PASS' : 'FAIL') + ' | good ' + c.good + ' | approx ' + c.approx + ' | off ' + c.off +
        ' | missed ' + c.missed + ' | extra ' + c.extra + ' | offset ' + e.offsetMs + 'ms | tempo ' + (e.tempo ?? '-') +
        ' | drift ' + (e.driftPct ?? '-') + '% | lost ' + e.lost + ' | sens ' + e.sens,
      'bars ' + e.bars,
    ].join('\n');
  }

  function showResult(e) {
    $('result').hidden = false;
    $('percent').textContent = e.percent;
    const v = $('verdict');
    v.textContent = e.passed ? t('passed') : t('notYet');
    v.className = 'verdict ' + (e.passed ? 'pass' : 'fail');
    const counts = $('counts');
    counts.innerHTML = '';
    [['good', '--good'], ['approx', '--approx'], ['off', '--off'], ['missed', '--missed'], ['extra', '--muted']].forEach(([k, c]) => {
      const li = document.createElement('li');
      li.style.setProperty('--c', 'var(' + c + ')');
      const b = document.createElement('b');
      b.textContent = e.counts[k];
      li.append(b, ' ' + t(k));
      counts.appendChild(li);
    });
    const facts = $('facts');
    facts.innerHTML = '';
    const add = (s) => { const li = document.createElement('li'); li.textContent = s; facts.appendChild(li); };
    if (Math.abs(e.offsetMs) < 15) add(t('offsetNone'));
    else add(t(e.offsetMs < 0 ? 'offsetEarly' : 'offsetLate', { ms: Math.abs(e.offsetMs) }));
    if (e.tempo) {
      const dev = Math.round((e.tempo - e.bpm) / e.bpm * 1000) / 10;
      add(t('tempoHeld', { bpm: e.tempo, dev: (dev > 0 ? '+' : '') + dev + ' %' }));
    }
    if (e.driftPct !== null && Math.abs(e.driftPct) >= 2) add(t('drift', { dir: t(e.driftPct > 0 ? 'faster' : 'slower'), pct: Math.abs(e.driftPct) + ' %' }));
    if (e.lost) add(t('lostBars', { n: e.lost }));
    $('report').value = report(e);
    $('copy-status').textContent = '';
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function copyText(text, statusEl, fallbackEl) {
    try {
      await navigator.clipboard.writeText(text);
      statusEl.textContent = t('copied');
    } catch (err) {
      statusEl.textContent = t('copyFailed');
      if (fallbackEl) { fallbackEl.value = text; fallbackEl.focus(); fallbackEl.select(); }
    }
  }

  $('copy-btn').addEventListener('click', () => copyText($('report').value, $('copy-status'), $('report')));
  $('copy-today').addEventListener('click', () => {
    const today = new Date().toDateString();
    const text = history.filter((e) => new Date(e.date).toDateString() === today).reverse().map(report).join('\n\n');
    $('result').hidden = false;
    copyText(text, $('copy-status'), $('report'));
  });

  // ---------- sync to a Git repository (optional, agent-readable) ----------
  // One JSON file per run: runs/YYYY/MM/DD/<timestamp>-<exercise>.json
  // Gitea/Forgejo: POST {api}/repos/{repo}/contents/{path}; GitHub: PUT, same body.
  let sync = load('sync', null);

  function b64utf8(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function runPath(e) {
    const d = e.date.slice(0, 10).split('-');
    return 'runs/' + d[0] + '/' + d[1] + '/' + d[2] + '/' + e.date.replace(/[:.]/g, '-') + '-' + e.id + '.json';
  }

  function apiBase(cfg) {
    return cfg.kind === 'github' ? 'https://api.github.com' : cfg.api.replace(/\/+$/, '');
  }

  async function apiFetch(cfg, method, path, body) {
    const headers = { Authorization: (cfg.kind === 'github' ? 'Bearer ' : 'token ') + cfg.token, Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(apiBase(cfg) + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  }

  function apiCall(cfg, method, path, body) {
    return apiFetch(cfg, method, '/repos/' + cfg.repo + path, body);
  }

  // https://github.com/owner/name -> GitHub; https://host/owner/name -> Gitea or Forgejo on that host.
  function parseRepoUrl(text) {
    let u;
    try { u = new URL(text.trim()); } catch (e) { return null; }
    const parts = u.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
    if (u.protocol !== 'https:' || parts.length !== 2) return null;
    const repo = parts.join('/');
    if (u.hostname === 'github.com') return { kind: 'github', api: 'https://api.github.com', repo, url: u.origin + '/' + repo };
    return { kind: 'gitea', api: u.origin + '/api/v1', repo, url: u.origin + '/' + repo };
  }

  function repoUrl(cfg) {
    return cfg.url || (cfg.kind === 'github' ? 'https://github.com/' : cfg.api.replace(/\/api\/v1\/?$/, '') + '/') + cfg.repo;
  }

  async function pushRun(cfg, e) {
    const doc = Object.assign({ format: 1, app: 'auguste' }, e, { report: report(e) });
    delete doc.synced;
    const res = await apiCall(cfg, cfg.kind === 'github' ? 'PUT' : 'POST', '/contents/' + runPath(e), {
      message: 'Run ' + e.id + ' ' + e.date,
      content: b64utf8(JSON.stringify(doc, null, 1) + '\n'),
    });
    // 409/422: the file already exists, so the run was sent before.
    if (res.ok || res.status === 409 || res.status === 422) return true;
    throw new Error('HTTP ' + res.status);
  }

  let syncing = false;
  async function syncPending() {
    if (!sync || syncing) return 0;
    syncing = true;
    let sent = 0;
    try {
      for (const e of history.slice().reverse()) {
        if (e.synced) continue;
        await pushRun(sync, e);
        e.synced = true;
        sent += 1;
        save('history', history);
      }
      showSync();
    } catch (err) {
      showSync(err.message);
    } finally {
      syncing = false;
    }
    return sent;
  }

  function showSync(error) {
    const el = $('sync-status');
    if (!sync) { el.textContent = t('syncDisabled'); return; }
    if (error) { el.textContent = t('syncFail', { why: error }); return; }
    el.textContent = t('syncOk', { repo: sync.repo, pending: history.filter((e) => !e.synced).length });
  }

  function fillSyncForm() {
    $('sync-url').value = sync ? repoUrl(sync) : '';
    $('sync-token').value = (sync && sync.token) || '';
  }

  async function testAndSave(cfg) {
    let created = false;
    try {
      let res = await apiCall(cfg, 'GET', '');
      if (res.status === 404) {
        // Create the repository, private, when it belongs to the key's owner.
        const me = await apiFetch(cfg, 'GET', '/user');
        const login = me.ok ? (await me.json()).login : null;
        if (!login || login.toLowerCase() !== cfg.repo.split('/')[0].toLowerCase()) throw new Error('HTTP 404');
        res = await apiFetch(cfg, 'POST', '/user/repos', {
          name: cfg.repo.split('/')[1], private: true, auto_init: true, description: 'Auguste rhythm runs, written by the app.',
        });
        if (res.status !== 201) throw new Error('HTTP ' + res.status);
        created = true;
      } else if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }
    } catch (err) {
      showSync(err.message || 'network');
      return false;
    }
    sync = cfg;
    save('sync', sync);
    showSync();
    if (created) $('sync-status').textContent = t('syncCreated', { repo: cfg.repo }) + ' ' + $('sync-status').textContent;
    return true;
  }

  $('sync-save').addEventListener('click', async () => {
    const target = parseRepoUrl($('sync-url').value);
    if (!target) { $('sync-status').textContent = t('syncBadUrl'); return; }
    const cfg = Object.assign(target, { token: $('sync-token').value.trim() });
    if (await testAndSave(cfg)) syncPending();
  });
  $('sync-now').addEventListener('click', async () => {
    const n = await syncPending();
    if (sync && n) $('sync-status').textContent = t('syncSent', { n, repo: sync.repo });
  });
  $('sync-off').addEventListener('click', () => {
    sync = null;
    try { localStorage.removeItem('rt.sync'); } catch (e) { /* storage unavailable */ }
    fillSyncForm();
    showSync();
  });

  // Setup link: <app>#sync=<base64url JSON>. Stored, then removed from the address bar.
  async function readSetupLink() {
    const m = /#sync=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return;
    window.history.replaceState(null, '', location.pathname + location.search);
    try {
      const pad = m[1] + '==='.slice((m[1].length + 3) % 4);
      const bin = atob(pad.replace(/-/g, '+').replace(/_/g, '/'));
      const cfg = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
      if (!cfg.kind || !cfg.repo || !cfg.token) throw new Error('format');
      $('sync-panel').open = true;
      if (await testAndSave(cfg)) {
        $('sync-status').textContent = t('syncFromLink') + ' ' + $('sync-status').textContent;
        fillSyncForm();
        syncPending();
      }
    } catch (err) {
      showSync('link');
    }
  }

  // ---------- export / import (works for anyone using the app) ----------
  function stamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function reportsText() {
    return history.slice().reverse().map(report).join('\n\n') + '\n';
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('export-txt').addEventListener('click', () => {
    if (!history.length) { $('export-status').textContent = t('nothingToExport'); return; }
    download('auguste-reports-' + stamp() + '.txt', reportsText(), 'text/plain');
    $('export-status').textContent = t('exported', { n: history.length });
  });

  $('export-json').addEventListener('click', () => {
    if (!history.length) { $('export-status').textContent = t('nothingToExport'); return; }
    const data = { app: 'auguste', format: 1, exported: new Date().toISOString(), history, lessons: userLessons };
    download('auguste-backup-' + stamp() + '.json', JSON.stringify(data, null, 1), 'application/json');
    $('export-status').textContent = t('exported', { n: history.length });
  });

  // Android share sheet (Drive, Nextcloud, e-mail, messaging…) when the browser can share files.
  const canShareFiles = !!(navigator.canShare && window.File &&
    navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] }));
  $('share-txt').hidden = !canShareFiles;
  $('share-txt').addEventListener('click', async () => {
    if (!history.length) { $('export-status').textContent = t('nothingToExport'); return; }
    const file = new File([reportsText()], 'auguste-reports-' + stamp() + '.txt', { type: 'text/plain' });
    try { await navigator.share({ files: [file], title: 'Auguste' }); } catch (e) { /* cancelled */ }
  });

  $('import-json').addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!APP_IDS.includes(data.app) || !Array.isArray(data.history)) throw new Error('format');
      const key = (e) => e.date + '|' + e.id;
      const known = new Set(history.map(key));
      const fresh = data.history.filter((e) => e && e.date && e.id && !known.has(key(e)));
      history = history.concat(fresh).sort((a, b) => (a.date < b.date ? 1 : -1));
      save('history', history);
      if (Array.isArray(data.lessons)) {
        const texts = new Set(userLessons.map((u) => u.text));
        data.lessons.forEach((u) => { if (u && typeof u.text === 'string' && !texts.has(u.text)) userLessons.push({ text: u.text }); });
        save('lessons', userLessons);
        parseUserLessons(); fillExercises(); renderLessons();
      }
      renderHistory();
      $('export-status').textContent = t('imported', { n: fresh.length, d: data.history.length - fresh.length });
    } catch (e) {
      $('export-status').textContent = t('importFailed');
    }
  });

  function renderHistory() {
    const ol = $('history');
    ol.innerHTML = '';
    if (!history.length) {
      const li = document.createElement('li');
      li.className = 'meta';
      li.textContent = t('historyEmpty');
      ol.appendChild(li);
      return;
    }
    history.slice(0, 15).forEach((e) => {
      const li = document.createElement('li');
      const pc = document.createElement('span');
      pc.className = 'pc';
      pc.style.color = e.passed ? 'var(--good)' : 'var(--ink)';
      pc.textContent = e.percent + '%';
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = title(e.id, e.title) + (e.lines !== 'all' ? ' · ' + e.lines : '');
      const meta = document.createElement('span');
      meta.className = 'meta';
      const d = new Date(e.date);
      meta.textContent = e.bpm + ' · ' + d.toLocaleDateString(RTi18n.lang, { day: '2-digit', month: '2-digit' });
      li.append(pc, what, meta);
      ol.appendChild(li);
    });
  }

  // ---------- imported lessons ----------
  function renderLessons() {
    const ul = $('lesson-list');
    ul.innerHTML = '';
    userLessons.forEach((u, i) => {
      let names = [];
      try { names = RTRhythm.parseLessons(u.text).map((l) => l.title); } catch (e) { names = ['?']; }
      const li = document.createElement('li');
      const s = document.createElement('span');
      s.textContent = names.join(', ');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ghost';
      b.textContent = t('remove');
      b.addEventListener('click', () => {
        userLessons.splice(i, 1);
        save('lessons', userLessons);
        parseUserLessons(); fillExercises(); renderLessons(); fillLines(); drawScore();
      });
      li.append(s, b);
      ul.appendChild(li);
    });
  }

  $('lesson-add').addEventListener('click', () => {
    const text = $('lesson-input').value;
    try {
      const parsed = RTRhythm.parseLessons(text);
      if (!parsed.length) throw new Error('# id title ?');
      userLessons.push({ text });
      save('lessons', userLessons);
      parseUserLessons();
      fillExercises();
      renderLessons();
      $('lesson-input').value = '';
      $('lesson-status').textContent = t('lessonsAdded', { n: parsed.length });
    } catch (e) {
      $('lesson-status').textContent = e.message;
    }
  });

  // ---------- controls ----------
  function persist() { save('settings', settings); }

  function setTempo(v) {
    settings.tempo = Math.max(40, Math.min(160, Math.round(v)));
    $('tempo').value = settings.tempo;
    $('tempo-value').textContent = settings.tempo;
    persist();
  }
  $('tempo').addEventListener('input', (e) => setTempo(+e.target.value));
  $('tempo-down').addEventListener('click', () => setTempo(settings.tempo - 5));
  $('tempo-up').addEventListener('click', () => setTempo(settings.tempo + 5));
  $('metro').addEventListener('change', (e) => { settings.metro = e.target.value; persist(); });
  $('guide').addEventListener('change', (e) => { settings.guide = e.target.checked; persist(); });
  $('exercise').addEventListener('change', (e) => {
    settings.exercise = e.target.value;
    settings.lines = [];
    const cur = current();
    if (cur.metro) { settings.metro = cur.metro; $('metro').value = cur.metro; }
    persist(); fillLines(); drawScore();
    $('result').hidden = true;
  });
  $('sensitivity').addEventListener('input', (e) => { settings.sensitivity = +e.target.value; engine.settings.sensitivity = settings.sensitivity; persist(); });
  $('volume').addEventListener('input', (e) => { settings.volume = +e.target.value; persist(); });
  $('good-tol').addEventListener('change', (e) => { settings.goodTol = Math.max(10, Math.min(60, +e.target.value || 30)); persist(); });
  $('ok-tol').addEventListener('change', (e) => { settings.okTol = Math.max(settings.goodTol, Math.min(80, +e.target.value || 50)); persist(); });
  $('go').addEventListener('click', go);

  $('test-claps').addEventListener('click', async () => {
    try { await ensureEngine(); } catch (e) { return; }
    if (!calibration) { $('test-status').textContent = t('needCalib'); return; }
    const btn = $('test-claps');
    btn.disabled = true;
    let n = 0;
    $('test-status').textContent = t('claps', { n: 0 });
    const off = engine.on((ev) => { if (ev.type === 'onset') { n += 1; $('test-status').textContent = t('claps', { n }); } });
    setTimeout(() => { off(); btn.disabled = false; $('test-status').textContent = t('testResult', { n }); }, 5000);
  });

  document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => {
    RTi18n.setLang(b.dataset.lang);
    applyTexts();
  }));

  function applyTexts() {
    document.documentElement.lang = RTi18n.lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === RTi18n.lang)));
    fillExercises();
    fillLines();
    legend();
    showCalibration();
    renderHistory();
    renderLessons();
    showSync();
    if (!running) $('go').textContent = t('start');
  }

  // ---------- boot ----------
  // Ask the browser not to evict saved runs when the phone runs low on space.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* app still works online */ });
  }
  parseUserLessons();
  applyTexts();
  setTempo(settings.tempo);
  $('metro').value = settings.metro;
  $('guide').checked = settings.guide;
  $('sensitivity').value = settings.sensitivity;
  $('volume').value = settings.volume;
  $('good-tol').value = settings.goodTol;
  $('ok-tol').value = settings.okTol;
  drawScore();
  fillSyncForm();
  readSetupLink().then(() => syncPending());
  window.addEventListener('hashchange', () => readSetupLink());
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => drawScore(lastColors), 150); });
})();
