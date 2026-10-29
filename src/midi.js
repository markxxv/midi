import { Midi } from '@tonejs/midi';
import { pitchRange } from './utils.js';

export function normalizeMidi(midi, fallbackName = 'UNTITLED SESSION') {
  const tracks = midi.tracks.filter(track => track.notes.length).map((track, index) => ({
    id: index,
    name: track.name?.trim() || (track.channel === 9 ? 'Percussion' : 'Instrument ' + String(index + 1).padStart(2, '0')),
    channel: track.channel,
    program: track.instrument?.number ?? 0,
    notes: track.notes.map((note, i) => ({
      id: index + '-' + i,
      track: index,
      midi: note.midi,
      time: Math.max(0, note.time),
      duration: Math.max(0.04, note.duration),
      velocity: note.velocity || 0.75,
    })).sort((a, b) => a.time - b.time),
  }));
  const notes = tracks.flatMap(track => track.notes).sort((a, b) => a.time - b.time);
  if (!notes.length) throw new Error('This MIDI file has no playable notes.');
  let lastNote = 0;
  for (const note of notes) lastNote = Math.max(lastNote, note.time + note.duration);
  return {
    name: (midi.name || fallbackName).replace(/\.midi?$/i, '').trim().slice(0, 64) || fallbackName,
    bpm: Math.round(midi.header.tempos?.[0]?.bpm || 120),
    tracks,
    notes,
    duration: Math.max(1, lastNote + 1.3),
    range: pitchRange(notes),
  };
}

export function parseMidi(buffer, filename) {
  const midi = new Midi(buffer);
  return normalizeMidi(midi, filename.replace(/\.midi?$/i, ''));
}

function add(track, pitch, time, duration, velocity = 0.8) {
  track.addNote({ midi: pitch, time, duration, velocity });
}

export function demoMidi(kind = 'midnight') {
  const midi = new Midi();
  const glass = kind === 'glass';
  const bpm = glass ? 96 : 126;
  midi.header.setTempo(bpm);
  const beat = 60 / bpm;
  const bars = glass ? 12 : 16;
  const roots = glass ? [48, 44, 51, 46] : [48, 44, 41, 43];
  const chords = glass ? [[0, 4, 7, 11], [0, 3, 7, 10], [0, 4, 7, 11], [0, 3, 7, 10]] : [[0, 3, 7, 10], [0, 4, 7, 10], [0, 3, 7, 10], [0, 3, 7, 10]];
  const bass = midi.addTrack(); bass.name = glass ? 'Sub Atmosphere' : 'Low Frequency';
  const arp = midi.addTrack(); arp.name = glass ? 'Glass Arpeggios' : 'Prism Sequences';
  const pad = midi.addTrack(); pad.name = glass ? 'Soft Halo' : 'Wide Analog';
  const melody = midi.addTrack(); melody.name = glass ? 'Crystal Echoes' : 'Night Signals';
  const sparkle = midi.addTrack(); sparkle.name = glass ? 'Overtones' : 'Starlight';
  for (let bar = 0; bar < bars; bar++) {
    const k = bar % 4;
    const root = roots[k];
    const chord = chords[k];
    const start = bar * beat * 4;
    add(bass, root - 12, start, beat * (glass ? 3.7 : 1.8), .8);
    if (!glass) add(bass, root - 12, start + beat * 2, beat * 1.7, .6);
    for (let j = 0; j < 4; j++) add(pad, root + chord[j] + 12, start, beat * 3.72, .33 + j * .055);
    const steps = glass ? 8 : 16;
    for (let s = 0; s < steps; s++) {
      const idx = glass ? [0, 2, 3, 1, 2, 3, 1, 0][s] : [0, 1, 2, 3, 2, 1, 3, 2, 0, 2, 1, 3, 1, 2, 3, 1][s];
      const pitch = root + chord[idx] + (glass ? 24 : (s % 8 < 4 ? 12 : 24));
      add(arp, pitch, start + s * beat * (4 / steps), beat * (glass ? .34 : .17), .50 + ((s % 4 === 0) ? .27 : 0));
    }
    const motives = glass ? [0, 2, 1, 3] : [2, 3, 1, 2];
    for (let m = 0; m < 4; m++) {
      const tick = start + (m * beat);
      if (bar > 1 || m > 1) add(melody, root + chord[motives[(m + bar) % 4]] + 24, tick, beat * (glass ? .85 : .55), .64);
      if ((bar + m) % (glass ? 2 : 3) === 0) add(sparkle, root + chord[(bar + m) % 4] + 36, tick + beat * .5, beat * .35, .42);
    }
  }
  midi.name = glass ? 'GLASS HORIZON' : 'MIDNIGHT DRIVE';
  return normalizeMidi(midi, midi.name);
}
