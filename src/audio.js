import { clamp, lowerBound, pitchHz } from './utils.js';

/**
 * Web Audio owns the playback clock. Both the Three.js renderer and the
 * recorder read from the same clock; setTimeout never determines note timing.
 * This is a lightweight synthesizer, not a General MIDI soundfont emulator.
 */
export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.recordDestination = null;
    this.song = null;
    this.playing = false;
    this.offset = 0;
    this.startedAt = 0;
    this.nextIndex = 0;
    this.timer = null;
    this.voices = new Set();
    this.volume = .75;
  }

  async init() {
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('Web Audio is unavailable in this browser.');
      this.context = new Context({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = this.volume * .68;
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 20;
      compressor.ratio.value = 3;
      compressor.attack.value = .005;
      compressor.release.value = .23;
      this.master.connect(compressor);
      compressor.connect(this.context.destination);
      this.recordDestination = this.context.createMediaStreamDestination();
      compressor.connect(this.recordDestination);
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  load(song) {
    this.pause();
    this.song = song;
    this.offset = 0;
    this.nextIndex = 0;
  }

  getTime() {
    if (!this.song) return 0;
    return clamp(this.playing ? this.context.currentTime - this.startedAt : this.offset, 0, this.song.duration);
  }

  setVolume(value) {
    this.volume = clamp(value, 0, 1);
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume * .68, this.context.currentTime, .025);
  }

  async play() {
    if (this.playing || !this.song) return;
    await this.init();
    if (this.offset >= this.song.duration - .05) this.offset = 0;
    this.startedAt = this.context.currentTime - this.offset;
    this.playing = true;
    this.nextIndex = lowerBound(this.song.notes, this.offset);
    this.scheduleSustained();
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  scheduleSustained() {
    // When seeking into a held chord, recreate its remaining sustain.
    const now = this.offset;
    for (const note of this.song.notes) {
      if (note.time >= now) break;
      const remains = note.time + note.duration - now;
      if (remains > .08) this.trigger(note, this.context.currentTime + .015, remains, .7);
    }
  }

  schedule() {
    if (!this.playing || !this.song) return;
    const playhead = this.getTime();
    const notes = this.song.notes;
    const deadline = playhead + .2;
    while (this.nextIndex < notes.length && notes[this.nextIndex].time <= deadline) {
      const note = notes[this.nextIndex++];
      const remaining = note.time + note.duration - playhead;
      if (remaining <= 0) continue;
      const when = Math.max(this.context.currentTime + .004, this.startedAt + note.time);
      this.trigger(note, when, Math.min(note.duration, remaining));
    }
    if (playhead >= this.song.duration - .015) this.pause(true);
  }

  trigger(note, when, duration, velocityScale = 1) {
    const ctx = this.context;
    if (!ctx || duration <= .02) return;
    const role = note.track % 5;
    const freq = pitchHz(note.midi);
    const env = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(role === 0 ? Math.min(1500, freq * 5) : role === 2 ? 3000 : 7500, when);
    filter.Q.value = .55;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) pan.pan.value = (note.track % 7 - 3) * .11;
    const peak = clamp(note.velocity * velocityScale, .08, 1) * (role === 2 ? .032 : .059);
    const attack = role === 2 ? .17 : role === 3 ? .025 : .007;
    const decay = role === 2 ? .7 : role === 0 ? .4 : .2;
    const sustain = role === 2 ? .62 : role === 0 ? .36 : .3;
    const end = when + duration;
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(peak, when + Math.min(attack, duration * .45));
    env.gain.setTargetAtTime(peak * sustain, when + Math.min(attack, duration * .45), decay);
    env.gain.setTargetAtTime(0, end, role === 2 ? .19 : .095);
    filter.connect(env);
    env.connect(pan);
    pan.connect(this.master);
    const first = ctx.createOscillator();
    first.type = ['sawtooth', 'triangle', 'sine', 'triangle', 'sine'][role];
    first.frequency.setValueAtTime(freq, when);
    first.connect(filter);
    const second = ctx.createOscillator();
    second.type = 'sine';
    second.frequency.setValueAtTime(freq * (role === 4 ? 2.003 : role === 1 ? 1.999 : 1.005), when);
    const overtone = ctx.createGain();
    overtone.gain.value = role === 4 ? .25 : .18;
    second.connect(overtone);
    overtone.connect(filter);
    const stopAt = end + (role === 2 ? 1.2 : .55);
    first.start(when);
    second.start(when);
    first.stop(stopAt);
    second.stop(stopAt);
    const voice = { oscillators: [first, second], env, filter, overtone, pan };
    this.voices.add(voice);
    first.onended = () => {
      for (const node of [...voice.oscillators, env, filter, overtone, pan]) node.disconnect();
      this.voices.delete(voice);
    };
  }

  stopVoices() {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of [...this.voices]) {
      try {
        voice.env.gain.cancelScheduledValues(now);
        voice.env.gain.setTargetAtTime(0, now, .01);
        for (const osc of voice.oscillators) osc.stop(now + .055);
      } catch { /* Oscillator already ended. */ }
    }
  }

  pause(finished = false) {
    if (this.playing) this.offset = finished ? this.song.duration : this.getTime();
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.stopVoices();
  }

  stop() { this.pause(); this.offset = 0; }

  seek(seconds) {
    if (!this.song) return;
    const resume = this.playing;
    this.pause();
    this.offset = clamp(seconds, 0, this.song.duration);
    if (resume) return this.play();
  }

  stream() { return this.recordDestination?.stream ?? null; }

  async dispose() {
    this.pause();
    if (this.context) await this.context.close();
  }
}
