import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, lowerBound, pitchHz, pitchRange } from '../src/utils.js';

test('playhead formatting clamps invalid values', () => {
  assert.equal(formatTime(66.8), '01:06');
  assert.equal(formatTime(-5), '00:00');
  assert.equal(formatTime(NaN), '00:00');
});

test('binary search returns first note not earlier than playhead', () => {
  const notes = [{ time: 0 }, { time: 1 }, { time: 1 }, { time: 4 }];
  assert.equal(lowerBound(notes, 1), 1);
  assert.equal(lowerBound(notes, 2), 3);
  assert.equal(lowerBound(notes, 6), 4);
});

test('pitch tuning and keyboard range', () => {
  assert.equal(pitchHz(69), 440);
  assert.ok(pitchRange([{ midi: 60 }, { midi: 72 }]).max - pitchRange([{ midi: 60 }, { midi: 72 }]).min >= 48);
});
