import test from 'node:test';
import assert from 'node:assert/strict';
import { Playlist } from '../src/playlist.js';

const song = name => ({ name, duration: 25, notes: [] });

test('multi-song playlist keeps import order and supports navigation', () => {
  const list = new Playlist();
  list.add(song('First'));
  list.add(song('Second'));
  list.add(song('Third'));
  assert.equal(list.length, 3);
  assert.equal(list.current.song.name, 'First');
  list.select(1);
  assert.equal(list.current.song.name, 'Second');
  list.next();
  assert.equal(list.current.song.name, 'Third');
  assert.equal(list.next(), null);
  list.previous();
  assert.equal(list.current.song.name, 'Second');
});

test('removing a song preserves current selection', () => {
  const list = new Playlist();
  list.add(song('A'));
  list.add(song('B'));
  list.add(song('C'));
  list.select(2);
  list.remove(0);
  assert.equal(list.current.song.name, 'C');
  list.remove(1);
  assert.equal(list.current.song.name, 'B');
  list.clear();
  assert.equal(list.current, null);
  assert.equal(list.currentIndex, -1);
});
