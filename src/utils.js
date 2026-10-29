export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

export function lowerBound(notes, time) {
  let left = 0;
  let right = notes.length;
  while (left < right) {
    const middle = (left + right) >> 1;
    if (notes[middle].time < time) left = middle + 1;
    else right = middle;
  }
  return left;
}

export function pitchRange(notes) {
  if (!notes.length) return { min: 36, max: 96 };
  const pitches = notes.map(note => note.midi);
  const low = Math.min(...pitches);
  const high = Math.max(...pitches);
  let min = Math.max(21, low - 4);
  let max = Math.min(108, high + 4);
  if (max - min < 48) {
    const center = (min + max) / 2;
    min = Math.max(21, Math.floor(center - 24));
    max = Math.min(108, min + 48);
  }
  return { min, max };
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const pitchHz = midi => 440 * Math.pow(2, (midi - 69) / 12);
