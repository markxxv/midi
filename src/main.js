import './style.css';
import { AudioEngine } from './audio.js';
import { MidiVisualizer } from './visualizer.js';
import { VideoRecorder } from './recorder.js';
import { Playlist } from './playlist.js';
import { demoMidi, parseMidi } from './midi.js';
import { clamp, formatTime } from './utils.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const audio = new AudioEngine();
const playlist = new Playlist();
let visualizer;
let recorder;
let song = null;
let playingWas = false;
let playbackStarting = false;
let toastTimeout = 0;
let selectedRatio = '16:9';
let demoRequest = 0;

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => el.classList.remove('show'), 4500);
}

function setPlaying(playing) {
  $('#play-icon').textContent = playing ? 'Ⅱ' : '▶';
  $('#play').title = playing ? 'Pause' : 'Play';
}

function renderPlaylist() {
  const list = $('#playlist-list');
  list.replaceChildren();
  $('#playlist-count').textContent = String(playlist.length).padStart(2, '0');
  $('#playlist-clear').disabled = !playlist.length;
  $('#previous').disabled = playlist.currentIndex < 1;
  $('#next').disabled = playlist.currentIndex >= playlist.length - 1;
  $('#play').disabled = !song || playbackStarting;
  $('#export').disabled = !song && !recorder?.recording;
  $('#header-export').disabled = !song && !recorder?.recording;
  if (!playlist.length) {
    const empty = document.createElement('div');
    empty.className = 'playlist-empty';
    empty.textContent = 'Add MIDI files to build your playlist.';
    list.append(empty);
  }
  for (const [index, item] of playlist.entries.entries()) {
    const row = document.createElement('div');
    row.className = 'playlist-row' + (index === playlist.currentIndex ? ' active' : '');
    const button = document.createElement('button');
    button.className = 'playlist-item';
    button.type = 'button';
    button.title = item.song.name;
    button.setAttribute('aria-current', index === playlist.currentIndex ? 'true' : 'false');
    const number = document.createElement('span');
    number.className = 'playlist-index';
    number.textContent = String(index + 1).padStart(2, '0');
    const label = document.createElement('span');
    label.className = 'playlist-name';
    label.textContent = item.song.name;
    const duration = document.createElement('span');
    duration.className = 'playlist-duration';
    duration.textContent = formatTime(item.song.duration);
    button.append(number, label, duration);
    button.addEventListener('click', () => selectIndex(index, audio.playing));
    const remove = document.createElement('button');
    remove.className = 'playlist-remove';
    remove.type = 'button';
    remove.title = 'Remove ' + item.song.name;
    remove.setAttribute('aria-label', 'Remove ' + item.song.name);
    remove.textContent = '×';
    remove.addEventListener('click', () => removeIndex(index));
    row.append(button, remove);
    list.append(row);
  }
  const selectedDemo = playlist.current?.source;
  $$('.demo-item').forEach(button => {
    button.classList.toggle('selected', selectedDemo === 'demo:' + button.dataset.demo);
  });
}

function renderTracks() {
  $('#track-list').replaceChildren();
  $('#track-count').textContent = String(song?.tracks.length || 0).padStart(2, '0');
  if (!song) return;
  const colors = ['#b69bff', '#50f0e7', '#ff88bf', '#ffc48d', '#688bff'];
  for (const track of song.tracks) {
    const row = document.createElement('div');
    row.className = 'track';
    const dot = document.createElement('span');
    dot.className = 'track-dot';
    dot.style.color = colors[track.id % 5];
    dot.style.background = colors[track.id % 5];
    const name = document.createElement('span');
    name.className = 'track-name';
    name.textContent = track.name;
    name.title = track.name;
    const count = document.createElement('span');
    count.className = 'track-notes';
    count.textContent = String(track.notes.length);
    row.append(dot, name, count);
    $('#track-list').appendChild(row);
  }
}

function displaySong(value) {
  song = value;
  audio.load(song);
  visualizer.setSong(song);
  const title = song ? song.name.toUpperCase() : 'NO MIDI LOADED';
  $('#top-file').textContent = title;
  $('#stage-filename').textContent = title;
  $('#overlay-title').textContent = title;
  $('#overlay-bpm').textContent = song ? song.bpm + ' BPM' : '— BPM';
  $('#overlay-subtitle').textContent = song
    ? song.tracks.length + ' TRACKS / ' + song.notes.length.toLocaleString() + ' EVENTS'
    : 'ADD FILES OR CHOOSE A DEMO';
  $('#stage-note-count').textContent = song ? song.notes.length.toLocaleString() + ' NOTES' : '00 NOTES';
  $('#total-time').textContent = formatTime(song?.duration || 0);
  $('#current-time').textContent = '00:00';
  $('#seek').value = '0';
  $('#seek').style.setProperty('--progress', '0%');
  setPlaying(false);
  renderTracks();
  renderPlaylist();
}

async function selectIndex(index, resume = false) {
  if (recorder?.recording) return false;
  const selected = playlist.select(index);
  if (!selected) return false;
  displaySong(selected.song);
  if (resume) {
    try { await audio.play(); }
    catch (error) { console.error(error); toast(error.message); }
  }
  return true;
}

function removeIndex(index) {
  if (recorder?.recording) return;
  const wasCurrent = index === playlist.currentIndex;
  const resume = audio.playing;
  playlist.remove(index);
  if (wasCurrent) {
    displaySong(playlist.current?.song || null);
    if (resume && song) audio.play().catch(error => toast(error.message));
  } else {
    renderPlaylist();
  }
}

async function addFiles(files) {
  if (recorder?.recording) { toast('Stop recording before importing MIDI files.'); return; }
  const selectedFiles = Array.from(files || []).filter(file => /\.(mid|midi)$/i.test(file.name));
  if (!selectedFiles.length) { toast('Choose one or more .mid / .midi files.'); return; }
  const space = 200 - playlist.length;
  if (space <= 0) { toast('Playlist limit reached: 200 MIDI files.'); return; }
  const wasPlaying = audio.playing;
  let firstIndex = -1;
  let imported = 0;
  const errors = [];
  for (const file of selectedFiles.slice(0, space)) {
    if (file.size > 15 * 1024 * 1024) {
      errors.push(file.name + ' exceeds 15 MB');
      continue;
    }
    try {
      const parsed = parseMidi(await file.arrayBuffer(), file.name);
      const index = playlist.add(parsed, 'upload');
      if (firstIndex === -1) firstIndex = index;
      imported++;
    } catch (error) {
      console.error('MIDI import failed:', file.name, error);
      errors.push(file.name);
    }
  }
  if (firstIndex !== -1) await selectIndex(firstIndex, wasPlaying);
  if (errors.length) toast(imported + ' imported; ' + errors.length + ' skipped (' + errors.slice(0, 2).join(', ') + ').');
  else toast(imported + ' MIDI file' + (imported === 1 ? '' : 's') + ' added to playlist.');
  renderPlaylist();
}

async function chooseDemo(kind) {
  if (recorder?.recording) return;
  const source = 'demo:' + kind;
  const existing = playlist.entries.findIndex(item => item.source === source);
  if (existing >= 0) {
    await selectIndex(existing, audio.playing);
    return;
  }
  const request = ++demoRequest;
  try {
    let parsed;
    if (kind === 'nocturne') {
      const response = await fetch('/demo.mid');
      if (!response.ok) throw new Error('Could not load the Nocturne demo.');
      parsed = parseMidi(await response.arrayBuffer(), 'Nocturne Op. 9 No. 2.mid');
    } else parsed = demoMidi(kind);
    if (request !== demoRequest || recorder?.recording) return;
    const resume = audio.playing;
    const index = playlist.add(parsed, source);
    await selectIndex(index, resume);
  } catch (error) {
    console.error(error);
    toast(error.message);
  }
}

async function togglePlay() {
  if (recorder?.recording || !song) return;
  if (playbackStarting) {
    audio.pause(); // Cancel pending sample-loading play.
    return;
  }
  if (audio.playing) {
    audio.pause();
    setPlaying(false);
    return;
  }
  playbackStarting = true;
  renderPlaylist();
  try {
    await audio.play();
    setPlaying(audio.playing);
  } catch (error) {
    console.error(error);
    toast(error.message);
  } finally {
    playbackStarting = false;
    renderPlaylist();
  }
}

function previousTrack() {
  if (recorder?.recording) return;
  if (audio.getTime() > 3) { audio.seek(0).catch(error => toast(error.message)); return; }
  selectIndex(playlist.currentIndex - 1, audio.playing);
}

function nextTrack() {
  if (recorder?.recording) return;
  selectIndex(playlist.currentIndex + 1, audio.playing);
}

async function toggleRecord() {
  if (!song) return;
  if (recorder.recording) {
    recorder.stop();
    return;
  }
  try {
    $('#export').disabled = true;
    $('#header-export').disabled = true;
    await recorder.start({
      ratio: selectedRatio,
      quality: $('#quality').value,
      fps: $('#fps').value,
      name: song.name,
      onFinish: (error, result) => {
        $('#export-label').textContent = 'RECORD VIDEO';
        $('#export-help').textContent = 'Real-time recording · audio included';
        $('#recording-indicator').hidden = true;
        renderPlaylist();
        setPlaying(false);
        if (error) toast(error.message);
        else toast('Video exported · ' + result.format.toUpperCase() + ' · ' + Math.round(result.bytes / 1024 / 1024) + ' MB');
      },
    });
    $('#export-label').textContent = 'STOP & SAVE';
    $('#export-help').textContent = 'Recording current MIDI · keep tab visible';
    $('#recording-indicator').hidden = false;
    $('#export').disabled = false;
    setPlaying(true);
    toast('Recording ' + song.name + ' with sampled grand piano audio.');
  } catch (error) {
    console.error(error);
    $('#recording-indicator').hidden = true;
    renderPlaylist();
    toast(error.message);
  }
}

function bindEvents() {
  $('#file-input').addEventListener('change', event => {
    addFiles(event.target.files);
    event.target.value = '';
  });
  $$('.demo-item').forEach(button => button.addEventListener('click', () => chooseDemo(button.dataset.demo)));
  $('#playlist-clear').addEventListener('click', () => {
    if (recorder.recording) return;
    demoRequest++;
    playlist.clear();
    displaySong(null);
  });
  $('#play').addEventListener('click', togglePlay);
  $('#previous').addEventListener('click', previousTrack);
  $('#next').addEventListener('click', nextTrack);
  $('#restart').addEventListener('click', () => {
    if (!recorder.recording) audio.seek(0).catch(error => toast(error.message));
  });
  $('#stop').addEventListener('click', () => {
    if (!recorder.recording) { audio.stop(); setPlaying(false); }
  });
  $('#seek').addEventListener('input', event => {
    if (!recorder.recording && song) {
      const fraction = Number(event.target.value) / 1000;
      audio.seek(song.duration * fraction).catch(error => toast(error.message));
      $('#current-time').textContent = formatTime(song.duration * fraction);
      event.target.style.setProperty('--progress', fraction * 100 + '%');
    }
  });
  $('#volume').addEventListener('input', event => audio.setVolume(Number(event.target.value) / 100));
  $('#reverb').addEventListener('input', event => {
    const percentage = Number(event.target.value);
    audio.setReverb(percentage / 100);
    $('#reverb-value').textContent = percentage + '%';
  });
  $('#glow').addEventListener('input', event => {
    const value = Number(event.target.value);
    visualizer.setGlow(value);
    $('#glow-value').textContent = value.toFixed(1);
  });
  $('#speed').addEventListener('input', event => {
    const value = Number(event.target.value);
    visualizer.setSpeed(value);
    $('#speed-value').textContent = value.toFixed(1);
  });
  $('#particles').addEventListener('change', event => visualizer.setParticles(event.target.checked));
  $('#camera-motion').addEventListener('change', event => visualizer.setMotion(event.target.checked));
  $$('.theme-swatch').forEach(button => button.addEventListener('click', () => {
    $$('.theme-swatch').forEach(other => other.classList.toggle('active', other === button));
    visualizer.setTheme(button.dataset.theme);
  }));
  $$('#ratio-select button').forEach(button => button.addEventListener('click', () => {
    if (recorder.recording) return;
    selectedRatio = button.dataset.ratio;
    $$('#ratio-select button').forEach(other => other.classList.toggle('active', other === button));
    $('#stage-shell').dataset.ratio = selectedRatio;
    $('#stage-resolution').textContent = selectedRatio;
    visualizer.setRatio(selectedRatio);
  }));
  $('#export').addEventListener('click', toggleRecord);
  $('#header-export').addEventListener('click', toggleRecord);

  const drop = $('#dropzone');
  document.addEventListener('dragover', event => {
    event.preventDefault();
    if (event.dataTransfer?.types?.includes('Files')) drop.classList.add('drag-over');
  });
  document.addEventListener('dragleave', event => {
    if (!event.relatedTarget) drop.classList.remove('drag-over');
  });
  document.addEventListener('drop', event => {
    event.preventDefault();
    drop.classList.remove('drag-over');
    addFiles(event.dataTransfer?.files);
  });
  window.addEventListener('keydown', event => {
    const tag = event.target?.tagName;
    if (event.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) {
      event.preventDefault();
      togglePlay();
    }
  });
}

function frame() {
  requestAnimationFrame(frame);
  const time = audio.getTime();
  if (song) {
    $('#current-time').textContent = formatTime(time);
    $('#recording-time').textContent = formatTime(time);
    const fraction = clamp(time / song.duration, 0, 1);
    $('#seek').value = String(Math.round(fraction * 1000));
    $('#seek').style.setProperty('--progress', fraction * 100 + '%');
    if (recorder.recording && (!audio.playing || time >= song.duration - .015)) recorder.stop();
  }
  if (playingWas !== audio.playing) {
    playingWas = audio.playing;
    setPlaying(audio.playing);
  }
  visualizer.render(time);
}

function main() {
  try {
    visualizer = new MidiVisualizer($('#viewport'));
    recorder = new VideoRecorder(visualizer, audio);
    audio.onStatus = status => { $('#engine-status').textContent = status; };
    audio.onEnded = () => {
      if (recorder.recording) { recorder.stop(); return; }
      if ($('#autoplay-next').checked && playlist.currentIndex < playlist.length - 1) {
        selectIndex(playlist.currentIndex + 1, true);
      } else setPlaying(false);
    };
    bindEvents();
    chooseDemo('midnight');
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    toast('Unable to initialize WebGL: ' + error.message);
  }
}

main();
