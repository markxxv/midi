/**
 * In-memory MIDI playlist. Items hold normalized MIDI note data only.
 * UI and audio playback are deliberately separate from this state model.
 */
export class Playlist {
  constructor() {
    this.entries = [];
    this.currentIndex = -1;
    this.nextId = 1;
  }

  get current() { return this.entries[this.currentIndex] ?? null; }
  get length() { return this.entries.length; }

  add(song, source = 'import') {
    if (this.entries.length >= 200) throw new Error('Playlist limit: 200 MIDI files.');
    const item = { id: this.nextId++, song, source };
    this.entries.push(item);
    if (this.currentIndex === -1) this.currentIndex = 0;
    return this.entries.length - 1;
  }

  select(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.entries.length) return null;
    this.currentIndex = index;
    return this.current;
  }

  next() { return this.select(this.currentIndex + 1); }
  previous() { return this.select(this.currentIndex - 1); }

  remove(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.entries.length) return null;
    const [removed] = this.entries.splice(index, 1);
    if (!this.entries.length) this.currentIndex = -1;
    else if (index < this.currentIndex) this.currentIndex--;
    else if (index === this.currentIndex) this.currentIndex = Math.min(index, this.entries.length - 1);
    return removed;
  }

  clear() { this.entries = []; this.currentIndex = -1; }
}
