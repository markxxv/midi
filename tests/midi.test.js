import test from 'node:test';
import assert from 'node:assert/strict';
import midiFile from 'midi-file';
const { writeMidi } = midiFile;
import { createTempoMap, demoMidi, parseMidi } from '../src/midi.js';

function encode(tracks) {
  return writeMidi({ header: { format: tracks.length > 1 ? 1 : 0, numTracks: tracks.length, ticksPerBeat: 480 }, tracks });
}

test('converts tempo changes on any MIDI track', () => {
  const events = [
    [{ deltaTime: 0, type: 'setTempo', microsecondsPerBeat: 500000 },
      { deltaTime: 480, type: 'setTempo', microsecondsPerBeat: 1000000 },
      { deltaTime: 0, type: 'endOfTrack' }],
    [{ deltaTime: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 },
      { deltaTime: 480, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
      { deltaTime: 0, type: 'noteOn', channel: 0, noteNumber: 64, velocity: 75 },
      { deltaTime: 480, type: 'noteOff', channel: 0, noteNumber: 64, velocity: 0 },
      { deltaTime: 0, type: 'endOfTrack' }],
  ];
  const song = parseMidi(new Uint8Array(encode(events)), 'Tempo.mid');
  assert.equal(song.notes.length, 2);
  assert.equal(song.name, 'Tempo');
  assert.equal(song.bpm, 120);
  assert.ok(Math.abs(song.notes[0].time - 0) < 1e-6);
  assert.ok(Math.abs(song.notes[0].duration - .5) < 1e-6);
  assert.ok(Math.abs(song.notes[1].time - .5) < 1e-6);
  assert.ok(Math.abs(song.notes[1].duration - 1) < 1e-6);
});

test('sustain pedal extends notes through controller release', () => {
  const events = [[
    { deltaTime: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 90 },
    { deltaTime: 120, type: 'controller', channel: 0, controllerType: 64, value: 127 },
    { deltaTime: 120, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
    { deltaTime: 240, type: 'controller', channel: 0, controllerType: 64, value: 0 },
    { deltaTime: 0, type: 'endOfTrack' },
  ]];
  const song = parseMidi(new Uint8Array(encode(events)), 'Pedal.mid');
  assert.ok(Math.abs(song.notes[0].duration - .5) < 1e-6);
});

test('percussion channel is filtered out of piano arrangement', () => {
  const events = [[
    { deltaTime: 0, type: 'noteOn', channel: 9, noteNumber: 36, velocity: 90 },
    { deltaTime: 240, type: 'noteOff', channel: 9, noteNumber: 36, velocity: 0 },
    { deltaTime: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 80 },
    { deltaTime: 240, type: 'noteOff', channel: 0, noteNumber: 60, velocity: 0 },
    { deltaTime: 0, type: 'endOfTrack' },
  ]];
  const song = parseMidi(new Uint8Array(encode(events)), 'Piano.mid');
  assert.deepEqual(song.notes.map(n => n.midi), [60]);
});

test('demo arrangements generate playable notes without ToneJS', () => {
  for (const id of ['midnight', 'glass']) {
    const song = demoMidi(id);
    assert.equal(song.tracks.length, 5);
    assert.ok(song.notes.length > 100);
    assert.ok(song.duration > 20);
  }
});

test('tempo map accepts multiple changes at the same tick', () => {
  const map = createTempoMap([[{ deltaTime: 0, type: 'setTempo', microsecondsPerBeat: 750000 }]], 480);
  assert.ok(Math.abs(map.seconds(480) - .75) < 1e-6);
});
