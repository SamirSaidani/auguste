// Audio engine: metronome and guide sounds, microphone capture, clap detection, calibration.
//
// Every time value lives on the AudioContext clock. Sounds are scheduled ahead
// with oscillator.start(t); microphone frames are timestamped inside an
// AudioWorklet from currentFrame, so playback and detection share one timeline.
//
// Without headphones the microphone hears the phone's own sounds. Two things
// keep them apart from claps:
//   1. metronome and guide sounds are pure tones below 1.5 kHz, while a clap is
//      broadband noise; detection only looks at energy between 5 and 12 kHz;
//   2. calibration measures how much of those tones still leaks into that band
//      and sets the detection threshold above it.
// Calibration also plays short noise bursts while the room is silent and
// measures the speaker-to-microphone round trip, which is then removed from
// every clap.
(function (root) {
  'use strict';

  const FRAME = 512; // samples analysed per frame
  const HOP = 256;   // samples between frames (about 5 ms at 48 kHz)
  const BAND = [5000, 12000];

  const WORKLET = `
class FrameTap extends AudioWorkletProcessor {
  constructor() { super(); this.ring = new Float32Array(${FRAME}); this.w = 0; this.sinceHop = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.ring[this.w] = ch[i];
      this.w = (this.w + 1) % ${FRAME};
      if (++this.sinceHop === ${HOP}) {
        this.sinceHop = 0;
        const frame = new Float32Array(${FRAME});
        for (let k = 0; k < ${FRAME}; k++) frame[k] = this.ring[(this.w + k) % ${FRAME}];
        // Time of the last sample in the frame.
        this.port.postMessage({ t: (currentFrame + i + 1) / sampleRate, frame }, [frame.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('frame-tap', FrameTap);
`;

  class Engine {
    constructor() {
      this.ctx = null;
      this.stream = null;
      this.listeners = new Set();
      this.floor = 0; // set from the first frame
      this.prevEnergy = 0;
      this.lastOnset = -1;
      this.settings = { threshold: 0, ratio: 6, refractory: 0.07, sensitivity: 5, latency: 0 };
      this.out = null;
    }

    // Must be called from a tap or click (browsers require a user gesture for audio).
    async start() {
      if (this.ctx) { await this.ctx.resume(); return; }
      // iOS Safari: keep sound on the loudspeaker while the microphone is open.
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* not supported */ }
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      await this.ctx.resume();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.8;
      this.out.connect(this.ctx.destination);
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      const src = this.ctx.createMediaStreamSource(this.stream);
      const tap = new AudioWorkletNode(this.ctx, 'frame-tap');
      tap.port.onmessage = (ev) => this.onFrame(ev.data.t, ev.data.frame);
      src.connect(tap);
      // The worklet must be pulled by the graph; route it to a silent gain.
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      tap.connect(mute).connect(this.ctx.destination);
      Meyda.sampleRate = this.ctx.sampleRate;
      Meyda.bufferSize = FRAME;
      const binHz = this.ctx.sampleRate / FRAME;
      this.bins = [Math.ceil(BAND[0] / binHz), Math.min(FRAME / 2 - 1, Math.floor(BAND[1] / binHz))];
    }

    // High-band energy of one frame, from Meyda's amplitude spectrum.
    bandEnergy(frame) {
      const spec = Meyda.extract('amplitudeSpectrum', frame);
      let e = 0;
      for (let k = this.bins[0]; k <= this.bins[1]; k++) e += spec[k] * spec[k];
      return e;
    }

    threshold() {
      // Sensitivity 1..10 scales the threshold on a log scale (5 = calibrated value).
      const scale = Math.pow(2, (5 - this.settings.sensitivity) / 2);
      return Math.max(this.settings.threshold, this.floor * this.settings.ratio) * scale;
    }

    onFrame(t, frame) {
      const e = this.bandEnergy(frame);
      if (!this.floor) this.floor = Math.max(e, 1e-9);
      this.listeners.forEach((fn) => fn({ type: 'frame', t, e }));
      const rising = e > this.prevEnergy * 1.5;
      if (e > this.threshold() && rising && t - this.lastOnset > this.settings.refractory) {
        this.lastOnset = t;
        // Onset placed in the middle of the newest hop.
        const onset = t - HOP / 2 / this.ctx.sampleRate;
        this.listeners.forEach((fn) => fn({ type: 'onset', t: onset, e }));
      }
      // Noise-floor tracker: follows quiet frames down or up, and creeps up slowly
      // when the room gets louder, so the threshold never stays stuck below the noise.
      if (e < this.floor * this.settings.ratio) this.floor = this.floor * 0.98 + e * 0.02;
      else this.floor *= 1.01;
      this.prevEnergy = e;
    }

    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

    tone(t, freq, dur, level) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      o.connect(g).connect(this.out);
      o.start(t);
      o.stop(t + dur + 0.02);
    }

    click(t, accent, level) { this.tone(t, accent ? 1320 : 880, 0.05, level); }
    guide(t, level) { this.tone(t, 587, 0.07, level); }

    noiseBurst(t) {
      const len = Math.floor(this.ctx.sampleRate * 0.012);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = this.ctx.createBufferSource();
      s.buffer = buf;
      s.connect(this.out);
      s.start(t);
    }

    // Collects frames and onsets between two times.
    record(until) {
      return new Promise((resolve) => {
        const frames = [];
        const onsets = [];
        const off = this.on((ev) => {
          if (ev.type === 'frame') frames.push(ev);
          else onsets.push(ev.t);
          if (ev.t >= until) { off(); resolve({ frames, onsets }); }
        });
      });
    }

    // Calibration, about 5 seconds, in silence. Returns {latency, threshold, floor, spread, detected}.
    async calibrate(onProgress) {
      const ctx = this.ctx;
      const saved = Object.assign({}, this.settings);
      // 1. Room noise.
      onProgress('noise');
      let t0 = ctx.currentTime;
      const quiet = await this.record(t0 + 1.0);
      const energies = quiet.frames.map((f) => f.e).sort((a, b) => a - b);
      this.floor = energies[Math.floor(energies.length / 2)] || 1e-6;
      const noiseMax = energies[energies.length - 1] || 1e-6;

      // 2. Round trip: noise bursts, detected with a threshold just above the room noise.
      onProgress('latency');
      this.settings.threshold = noiseMax * 2;
      this.settings.sensitivity = 5;
      t0 = ctx.currentTime + 0.3;
      const bursts = [];
      for (let i = 0; i < 8; i++) { bursts.push(t0 + i * 0.45); this.noiseBurst(t0 + i * 0.45); }
      const rec = await this.record(t0 + 8 * 0.45 + 0.3);
      const delays = [];
      bursts.forEach((b) => {
        const hit = rec.onsets.find((o) => o > b && o < b + 0.3);
        if (hit !== undefined) delays.push(hit - b);
      });
      if (delays.length < 6) {
        this.settings = saved;
        throw new Error('calibration-latency');
      }
      const latency = RTScoring.median(delays);
      const spread = RTScoring.median(delays.map((d) => Math.abs(d - latency)));

      // 3. Leakage of the app's own tones into the detection band.
      onProgress('leak');
      t0 = ctx.currentTime + 0.2;
      for (let i = 0; i < 8; i++) {
        this.click(t0 + i * 0.25, i % 4 === 0, 1);
        this.guide(t0 + i * 0.25 + 0.125, 0.8);
      }
      const leakRec = await this.record(t0 + 8 * 0.25 + 0.3);
      const leakMax = Math.max(...leakRec.frames.map((f) => f.e), noiseMax);
      this.settings.threshold = Math.max(leakMax * 3, noiseMax * 3);
      this.settings.latency = latency;
      this.settings.sensitivity = saved.sensitivity;
      return { latency, spread, threshold: this.settings.threshold, floor: this.floor, detected: delays.length };
    }

    // Plays one run. Returns a promise of clap times relative to beat 0 (latency removed).
    // plan: {bpm, beatsPerMeasure, countInBeats, totalBeats, metro, fadeBars, guide, events}
    run(plan, onTick) {
      const ctx = this.ctx;
      const beat = 60 / plan.bpm;
      const start = ctx.currentTime + 0.4 + plan.countInBeats * beat; // time of beat 0
      const end = start + plan.totalBeats * beat;
      const level = plan.volume;
      // Count-in, then metronome according to mode.
      for (let b = -plan.countInBeats; b < plan.totalBeats; b++) {
        const inBar = ((b % plan.beatsPerMeasure) + plan.beatsPerMeasure) % plan.beatsPerMeasure;
        const bar = Math.floor(b / plan.beatsPerMeasure);
        let play = b < 0;
        if (!play) {
          if (plan.metro === 'all') play = true;
          else if (plan.metro === 'first') play = inBar === 0;
          else if (plan.metro === 'fade') play = bar < plan.fadeBars;
        }
        if (play) this.click(start + b * beat, inBar === 0, level);
      }
      if (plan.guide) plan.events.forEach((ev) => { if (!ev.rest) this.guide(start + ev.pos * beat, level * 0.7); });

      const claps = [];
      const lat = this.settings.latency;
      const off = this.on((ev) => {
        if (ev.type !== 'onset') return;
        const rel = ev.t - lat - start;
        if (rel > -beat / 2 && rel < plan.totalBeats * beat) { claps.push(rel); onTick && onTick({ clap: rel }); }
      });
      this.stopFlag = false;
      return new Promise((resolve) => {
        const tick = () => {
          const now = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
          onTick && onTick({ beat: (now - start) / beat });
          // The run ends with its last beat; only the speaker-to-mic delay (and one analysis frame) is added.
          if (this.stopFlag || ctx.currentTime > end + lat + 0.03) {
            off();
            resolve({ claps, stopped: this.stopFlag });
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }

    stop() {
      this.stopFlag = true;
      // Silence anything already scheduled.
      if (this.out) {
        this.out.disconnect();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.8;
        this.out.connect(this.ctx.destination);
      }
    }
  }

  root.RTAudio = { Engine };
})(self);
