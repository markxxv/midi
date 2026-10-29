import { SplendidGrandPiano } from 'smplr';
import { clamp, lowerBound } from './utils.js';

/**
 * Four-velocity-layer Steinway samples, shared Web Audio clock, and a quiet
 * stereo convolution reverb. The same master output feeds speakers and video.
 */
export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.recordDestination = null;
    this.piano = null;
    this.loadingPromise = null;
    this.song = null;
    this.playing = false;
    this.offset = 0;
    this.startedAt = 0;
    this.nextIndex = 0;
    this.timer = null;
    this.playToken = 0;
    this.volume = .75;
    this.reverb = .16;
    this.onStatus = null;
    this.onEnded = null;
  }

  async init() {
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('Web Audio is unavailable in this browser.');
      const ctx = new Context({ latencyHint: 'interactive' });
      this.context = ctx;
      this.input = ctx.createGain();
      this.dry = ctx.createGain();
      this.dry.gain.value = .96;
      this.wet = ctx.createGain();
      this.wet.gain.value = this.reverb;
      this.convolver = ctx.createConvolver();
      this.convolver.buffer = createImpulse(ctx);
      this.master = ctx.createGain();
      this.master.gain.value = this.volume * .92;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -9;
      compressor.knee.value = 12;
      compressor.ratio.value = 2;
      compressor.attack.value = .003;
      compressor.release.value = .27;
      this.input.connect(this.dry);
      this.dry.connect(this.master);
      this.input.connect(this.convolver);
      this.convolver.connect(this.wet);
      this.wet.connect(this.master);
      this.master.connect(compressor);
      compressor.connect(ctx.destination);
      this.recordDestination = ctx.createMediaStreamDestination();
      compressor.connect(this.recordDestination);
    }
    if (this.context.state !== 'running') await this.context.resume();

    if (!this.piano) {
      if (!this.loadingPromise) {
        this.onStatus?.('Loading Steinway samples…');
        this.loadingPromise = (async () => {
          const piano = SplendidGrandPiano(this.context, {
            destination: this.input,
            volume: 100,
            maxVoices: 128,
            onLoadProgress: ({ loaded, total }) => {
              if (total) this.onStatus?.('Loading piano ' + Math.round(loaded / total * 100) + '%');
            },
          });
          try {
            await piano.ready;
            this.piano = piano;
            this.onStatus?.('STEINWAY GRAND READY');
          } catch (error) {
            piano.dispose();
            throw error;
          }
        })().catch(error => {
          this.loadingPromise = null;
          this.onStatus?.('PIANO UNAVAILABLE');
          throw new Error('Could not load piano samples. Check your connection and retry. ' + (error?.message || ''));
        });
      }
      await this.loadingPromise;
    }
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
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume * .92, this.context.currentTime, .025);
  }

  setReverb(value) {
    this.reverb = clamp(value, 0, .5);
    if (this.wet && this.context) this.wet.gain.setTargetAtTime(this.reverb, this.context.currentTime, .06);
  }

  async play() {
    if (this.playing || !this.song) return;
    const token = ++this.playToken;
    const selectedSong = this.song;
    await this.init();
    if (token !== this.playToken || selectedSong !== this.song) return;
    if (this.offset >= this.song.duration - .05) this.offset = 0;
    this.startedAt = this.context.currentTime + .045 - this.offset;
    this.playing = true;
    this.nextIndex = lowerBound(this.song.notes, this.offset);
    this.scheduleSustained();
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  scheduleSustained() {
    const now = this.offset;
    if (!now) return;
    for (const note of this.song.notes) {
      if (note.time >= now) break;
      const remaining = note.time + note.duration - now;
      if (remaining > .06) this.trigger(note, this.context.currentTime + .045, remaining, .7);
    }
  }

  schedule() {
    if (!this.playing || !this.song) return;
    const playhead = this.getTime();
    const deadline = playhead + .2;
    const notes = this.song.notes;
    while (this.nextIndex < notes.length && notes[this.nextIndex].time <= deadline) {
      const note = notes[this.nextIndex++];
      const remaining = note.time + note.duration - playhead;
      if (remaining <= 0) continue;
      const when = Math.max(this.context.currentTime + .004, this.startedAt + note.time);
      this.trigger(note, when, Math.min(note.duration, remaining));
    }
    if (playhead >= this.song.duration - .015) {
      const completed = this.song;
      this.pause(true);
      queueMicrotask(() => {
        if (this.song === completed && !this.playing) this.onEnded?.();
      });
    }
  }

  trigger(note, when, duration, gain = 1) {
    if (!this.piano || duration <= .015) return;
    this.piano.start({
      note: note.midi,
      velocity: Math.max(1, Math.min(127, Math.round(note.velocity * gain * 127))),
      time: when,
      duration: Math.max(.04, duration),
    });
  }

  pause(finished = false) {
    this.playToken++;
    if (this.playing) this.offset = finished ? this.song.duration : this.getTime();
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.piano?.stop();
  }

  stop() {
    this.pause();
    this.offset = 0;
  }

  async seek(seconds) {
    if (!this.song) return;
    const resume = this.playing;
    this.pause();
    this.offset = clamp(seconds, 0, this.song.duration);
    if (resume) await this.play();
  }

  stream() { return this.recordDestination?.stream ?? null; }

  async dispose() {
    this.pause();
    this.piano?.dispose();
    if (this.context) await this.context.close();
  }
}

function createImpulse(ctx) {
  const seconds = 1.6;
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let filtered = 0;
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      // High-frequency roll-off and gentle exponential tail.
      const noise = Math.random() * 2 - 1;
      filtered = .68 * filtered + .32 * noise;
      const fade = Math.pow(1 - i / length, 2.6);
      const early = t > .024 && t < .095 ? 1.23 : 1;
      data[i] = filtered * fade * early;
    }
  }
  return buffer;
}
