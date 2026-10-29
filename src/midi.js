import { parseMidi as readMidi } from 'midi-file';
import { pitchRange } from './utils.js';

const DEFAULT_TEMPO = 500000; // Microseconds per quarter note.
const MIN_DURATION = 0.045;

function finishSong(tracks, name, bpm = 120) {
  const audible = tracks.filter(track => track.notes.length).map((track, index) => ({
    ...track,
    id: index,
    notes: track.notes.map((note, i) => ({
      ...note,
      id: index + '-' + i,
      track: index,
      duration: Math.max(MIN_DURATION, note.duration),
      velocity: Math.max(.01, Math.min(1, note.velocity)),
    })).sort((a, b) => a.time - b.time),
  }));
  const notes = audible.flatMap(track => track.notes).sort((a, b) => a.time - b.time);
  if (!notes.length) throw new Error('This MIDI file has no playable piano notes.');
  let lastNote = 0;
  for (const note of notes) lastNote = Math.max(lastNote, note.time + note.duration);
  return {
    name: (name || 'UNTITLED SESSION').replace(/\.midi?$/i, '').trim().slice(0, 80) || 'UNTITLED SESSION',
    bpm: Math.round(bpm),
    tracks: audible,
    notes,
    duration: Math.max(1, lastNote + 1.3),
    range: pitchRange(notes),
  };
}

/**
 * Converts absolute MIDI ticks to wall clock seconds. Handles tempo changes
 * anywhere in the file (not only in track 0).
 */
export function createTempoMap(rawTracks, ppq) {
  if (!Number.isFinite(ppq) || ppq <= 0) throw new Error('Unsupported MIDI timing format.');
  const tempos = [{ tick: 0, microsecondsPerBeat: DEFAULT_TEMPO, order: -1 }];
  let order = 0;
  for (const track of rawTracks) {
    let tick = 0;
    for (const event of track) {
      tick += event.deltaTime || 0;
      if (event.type === 'setTempo' && event.microsecondsPerBeat > 0) {
        tempos.push({ tick, microsecondsPerBeat: event.microsecondsPerBeat, order: order++ });
      }
    }
  }
  tempos.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const entries = [];
  for (const tempo of tempos) {
    const previous = entries[entries.length - 1];
    if (previous?.tick === tempo.tick) {
      previous.microsecondsPerBeat = tempo.microsecondsPerBeat;
      continue;
    }
    const seconds = previous
      ? previous.seconds + (tempo.tick - previous.tick) * previous.microsecondsPerBeat / (ppq * 1000000)
      : 0;
    entries.push({ tick: tempo.tick, seconds, microsecondsPerBeat: tempo.microsecondsPerBeat });
  }
  return {
    bpm: 60000000 / entries[0].microsecondsPerBeat,
    seconds(tick) {
      let lo = 0;
      let hi = entries.length;
      while (lo + 1 < hi) {
        const m = (lo + hi) >> 1;
        if (entries[m].tick <= tick) lo = m;
        else hi = m;
      }
      const current = entries[lo];
      return current.seconds + Math.max(0, tick - current.tick) * current.microsecondsPerBeat / (ppq * 1000000);
    },
  };
}

export function normalizeMidi(data, fallbackName = 'UNTITLED SESSION') {
  const header = data.header || {};
  const tempo = createTempoMap(data.tracks || [], header.ticksPerBeat);
  const tracks = [];
  let embeddedTitle = '';
  for (const [trackNumber, events] of (data.tracks || []).entries()) {
    let tick = 0;
    let trackName = '';
    let channel = 0;
    let program = 0;
    const finished = [];
    const held = new Map();
    const pedalDown = new Set();
    const sustained = new Map();

    const release = (note, endTick) => {
      finished.push({
        midi: note.midi,
        time: tempo.seconds(note.tick),
        duration: tempo.seconds(endTick) - tempo.seconds(note.tick),
        velocity: note.velocity,
      });
    };

    for (const event of events) {
      tick += event.deltaTime || 0;
      if (event.type === 'trackName' && typeof event.text === 'string') {
        if (!trackName) trackName = event.text.trim();
        if (!embeddedTitle) embeddedTitle = trackName;
      }
      if (event.type === 'programChange') program = event.programNumber ?? program;
      if (event.channel != null) channel = event.channel;
      const key = event.channel + ':' + event.noteNumber;
      const isNoteOn = event.type === 'noteOn' && event.velocity > 0;
      const isNoteOff = event.type === 'noteOff' || (event.type === 'noteOn' && event.velocity === 0);
      if (isNoteOn) {
        if (event.channel === 9) continue; // GM percussion is intentionally omitted from piano playback.
        if (!held.has(key)) held.set(key, []);
        held.get(key).push({ midi: event.noteNumber, tick, velocity: event.velocity / 127 });
      } else if (isNoteOff) {
        const active = held.get(key)?.shift();
        if (active) {
          if (pedalDown.has(event.channel)) {
            if (!sustained.has(event.channel)) sustained.set(event.channel, []);
            sustained.get(event.channel).push(active);
          } else release(active, tick);
        }
      } else if (event.type === 'controller' && event.controllerType === 64) {
        if (event.value >= 64) pedalDown.add(event.channel);
        else {
          pedalDown.delete(event.channel);
          for (const note of sustained.get(event.channel) || []) release(note, tick);
          sustained.delete(event.channel);
        }
      }
    }
    for (const queue of held.values()) for (const active of queue) release(active, tick);
    for (const queue of sustained.values()) for (const active of queue) release(active, tick);
    if (finished.length) {
      tracks.push({
        id: tracks.length,
        name: trackName || 'Piano ' + String(trackNumber + 1).padStart(2, '0'),
        channel,
        program,
        notes: finished,
      });
    }
  }
  // Uploaded filename is a more reliable title than often-generic track metadata.
  return finishSong(tracks, fallbackName || embeddedTitle, tempo.bpm);
}

export function parseMidi(buffer, filename = 'UNTITLED SESSION') {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return normalizeMidi(readMidi(bytes), filename);
}

export function demoMidi(kind = 'midnight') {
  const glass = kind === 'glass';
  const bpm = glass ? 96 : 126;
  const beat = 60 / bpm;
  const bars = glass ? 12 : 16;
  const roots = glass ? [48, 44, 51, 46] : [48, 44, 41, 43];
  const chords = glass
    ? [[0, 4, 7, 11], [0, 3, 7, 10], [0, 4, 7, 11], [0, 3, 7, 10]]
    : [[0, 3, 7, 10], [0, 4, 7, 10], [0, 3, 7, 10], [0, 3, 7, 10]];
  const names = glass
    ? ['Sub Atmosphere', 'Glass Arpeggios', 'Soft Halo', 'Crystal Echoes', 'Overtones']
    : ['Low Frequency', 'Prism Sequences', 'Wide Analog', 'Night Signals', 'Starlight'];
  const tracks = names.map((name, id) => ({ id, name, channel: 0, program: 0, notes: [] }));
  const add = (track, midi, time, duration, velocity = .8) =>
    tracks[track].notes.push({ midi, time, duration, velocity });
  for (let bar = 0; bar < bars; bar++) {
    const k = bar % 4;
    const root = roots[k];
    const chord = chords[k];
    const start = bar * beat * 4;
    add(0, root - 12, start, beat * (glass ? 3.7 : 1.8), .8);
    if (!glass) add(0, root - 12, start + beat * 2, beat * 1.7, .6);
    for (let j = 0; j < 4; j++) add(2, root + chord[j] + 12, start, beat * 3.72, .33 + j * .055);
    const steps = glass ? 8 : 16;
    for (let s = 0; s < steps; s++) {
      const idx = glass
        ? [0, 2, 3, 1, 2, 3, 1, 0][s]
        : [0, 1, 2, 3, 2, 1, 3, 2, 0, 2, 1, 3, 1, 2, 3, 1][s];
      const pitch = root + chord[idx] + (glass ? 24 : (s % 8 < 4 ? 12 : 24));
      add(1, pitch, start + s * beat * (4 / steps), beat * (glass ? .34 : .17), .50 + ((s % 4 === 0) ? .27 : 0));
    }
    const motives = glass ? [0, 2, 1, 3] : [2, 3, 1, 2];
    for (let m = 0; m < 4; m++) {
      const time = start + m * beat;
      if (bar > 1 || m > 1) add(3, root + chord[motives[(m + bar) % 4]] + 24, time, beat * (glass ? .85 : .55), .64);
      if ((bar + m) % (glass ? 2 : 3) === 0) add(4, root + chord[(bar + m) % 4] + 36, time + beat * .5, beat * .35, .42);
    }
  }
  return finishSong(tracks, glass ? 'GLASS HORIZON' : 'MIDNIGHT DRIVE', bpm);
}
