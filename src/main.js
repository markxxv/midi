import './style.css';
import { AudioEngine } from './audio.js';
import { MidiVisualizer } from './visualizer.js';
import { VideoRecorder } from './recorder.js';
import { demoMidi, parseMidi } from './midi.js';
import { clamp, formatTime } from './utils.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const audio = new AudioEngine();
let visualizer;
let recorder;
let song;
let playingWas = false;
let dragDepth = 0;
let toastTimeout = 0;
let selectedRatio = '16:9';

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => el.classList.remove('show'), 4200);
}

function setPlaying(playing) {
  $('#play-icon').textContent = playing ? 'Ⅱ' : '▶';
  $('#play').title = playing ? 'Pause' : 'Play';
}

function installSong(value) {
  if (recorder?.recording) return;
  song = value;
  audio.load(song);
  visualizer.setSong(song);
  const title = song.name.toUpperCase();
  $('#top-file').textContent = title;
  $('#stage-filename').textContent = title;
  $('#overlay-title').textContent = title;
  $('#overlay-bpm').textContent = song.bpm + ' BPM';
  $('#overlay-subtitle').textContent = song.tracks.length + ' TRACKS / ' + song.notes.length.toLocaleString() + ' EVENTS';
  $('#stage-note-count').textContent = song.notes.length.toLocaleString() + ' NOTES';
  $('#track-count').textContent = String(song.tracks.length).padStart(2, '0');
  $('#total-time').textContent = formatTime(song.duration);
  $('#seek').value = 0;
  $('#seek').style.setProperty('--progress', '0%');
  setPlaying(false);
  $('#track-list').replaceChildren();
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

async function loadFile(file) {
  if (recorder.recording) { toast('Stop recording before importing another MIDI.'); return; }
  if (!file || !/\.(mid|midi)$/i.test(file.name)) {
    toast('Choose a .mid or .midi file.');
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    toast('MIDI file is too large (maximum 15 MB).');
    return;
  }
  try {
    const data = await file.arrayBuffer();
    const parsed = parseMidi(data, file.name);
    installSong(parsed);
    $$('.demo-item').forEach(button => button.classList.remove('selected'));
    toast('Loaded ' + file.name + ' · ' + song.notes.length.toLocaleString() + ' notes');
  } catch (error) {
    console.error(error);
    toast('Could not read MIDI: ' + error.message);
  }
}

function chooseDemo(kind) {
  if (recorder.recording) return;
  try {
    installSong(demoMidi(kind));
    $$('.demo-item').forEach(button => button.classList.toggle('selected', button.dataset.demo === kind));
  } catch (error) { toast(error.message); }
}

async function togglePlay() {
  if (recorder.recording) return;
  try {
    if (audio.playing) audio.pause();
    else await audio.play();
    setPlaying(audio.playing);
  } catch (error) { console.error(error); toast(error.message); }
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
        $('#header-export').disabled = false;
        $('#export').disabled = false;
        setPlaying(false);
        if (error) toast(error.message);
        else toast('Video exported · ' + result.format.toUpperCase() + ' · ' + Math.round(result.bytes / 1024 / 1024) + ' MB');
      },
    });
    $('#export-label').textContent = 'STOP & SAVE';
    $('#export-help').textContent = 'Keep this tab visible during capture';
    $('#recording-indicator').hidden = false;
    $('#export').disabled = false;
    setPlaying(true);
    toast('Recording started. Video and audio are being captured.');
  } catch (error) {
    console.error(error);
    $('#export').disabled = false;
    $('#header-export').disabled = false;
    $('#recording-indicator').hidden = true;
    toast(error.message);
  }
}

function bindEvents() {
  $('#file-input').addEventListener('change', event => {
    loadFile(event.target.files?.[0]);
    event.target.value = '';
  });
  $$('.demo-item').forEach(button => button.addEventListener('click', () => chooseDemo(button.dataset.demo)));
  $('#play').addEventListener('click', togglePlay);
  $('#restart').addEventListener('click', () => audio.seek(0));
  $('#stop').addEventListener('click', () => { if (!recorder.recording) { audio.stop(); setPlaying(false); } });
  $('#seek').addEventListener('input', event => {
    if (!recorder.recording && song) {
      const fraction = Number(event.target.value) / 1000;
      audio.seek(song.duration * fraction);
      $('#current-time').textContent = formatTime(song.duration * fraction);
      event.target.style.setProperty('--progress', fraction * 100 + '%');
    }
  });
  $('#volume').addEventListener('input', event => audio.setVolume(Number(event.target.value) / 100));
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
  const prevent = event => event.preventDefault();
  document.addEventListener('dragover', prevent);
  document.addEventListener('drop', prevent);
  drop.addEventListener('dragenter', event => {
    event.preventDefault();
    dragDepth++;
    drop.classList.add('drag-over');
  });
  drop.addEventListener('dragleave', event => {
    event.preventDefault();
    if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('drag-over'); }
  });
  drop.addEventListener('drop', event => {
    event.preventDefault();
    dragDepth = 0;
    drop.classList.remove('drag-over');
    loadFile(event.dataTransfer?.files?.[0]);
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
    bindEvents();
    chooseDemo('midnight');
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    toast('Unable to initialize WebGL: ' + error.message);
  }
}

main();
