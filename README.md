# LUMEN — MIDI Visual Studio

A cinematic, browser-native MIDI visualizer with **glowing 3D notes, animated piano keys, impact particles, synchronized synthesized audio, and video recording with sound**.

![Stack](https://img.shields.io/badge/Three.js-WebGL-927bff) ![Stack](https://img.shields.io/badge/Web_Audio-Synth-55dacf) ![Stack](https://img.shields.io/badge/Vite-7-8678eb)

## Run

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (usually http://localhost:5173).

```bash
npm test
npm run build
npm run preview
```

## Features

- Import **.mid / .midi** via file picker or drag and drop; parsing stays in the browser.
- Two generated MIDI arrangements (**Midnight Drive** and **Glass Horizon**) and an imported **Nocturne Op. 9 No. 2** demo (preserved from the repository's existing `demo.mid`).
- WebGL note highway with pitch lanes, moving note bars proportional to duration, illuminated keys, 3D piano, reactive light impacts, particles, and floating stars.
- Four palettes: Aurora, Ember, Ocean, Mono. Bloom, note speed, camera drift, particles.
- Audio-clock synchronization, polyphonic Web Audio synthesizer, seek, volume, start/pause/stop.
- Canvas ratios: **16:9**, **9:16**, **1:1**. Export to **720p / 1080p**, **30 / 60 FPS**.
- Exports a video **with audio** using `HTMLCanvasElement.captureStream()`, `MediaStreamAudioDestinationNode`, and `MediaRecorder`. Downloads **WebM** (most Chromium browsers) or **MP4** when supported by the browser.

## Project structure

| Path | Responsibility |
| --- | --- |
| `src/midi.js` | Import/normalize MIDI and generate demos |
| `src/audio.js` | AudioContext clock, polyphonic synthesis and audio capture stream |
| `src/visualizer.js` | Three.js scene, note objects, piano, effects and rendering |
| `src/recorder.js` | Video and audio capture, encoding, download |
| `src/main.js` | Application state, playback transport and controls |
| `src/style.css` | Responsive studio UI |

## Recording details

1. Import a MIDI or select a demo.
2. Pick a color palette and adjust visual effects.
3. Select the canvas ratio, resolution, and frame rate.
4. Press **Record video**. Recording starts from the beginning and automatically stops when the arrangement completes; **Stop & Save** exports a partial recording.
5. Keep the browser tab **visible** during capture, because browsers may throttle WebGL and animation in background tabs.

Recording runs **in real time**, and the resulting file is encoded using codecs available in the browser. For best results, use desktop **Chrome or Edge**; modern Safari may use a different output format. Browser support, GPU capability, and performance influence capture quality. This is **not** offline deterministic Remotion rendering, frame-by-frame encoding, or an MP4 guarantee.

The built-in Web Audio instruments are **synthesized approximations**, not General MIDI soundfonts; drum channels are rendered as pitched synthesized events. The MIDI file itself never leaves the browser. For authentic instrument playback or production-grade offline export, add a licensed SoundFont/sampler and a WebCodecs/FFmpeg or Remotion renderer as a later engine.

## Controls

- **Space**: play/pause (when not focused on a control)
- **Seek bar**: drag to any point
- **Restart**: rewind to 00:00
- **Stop**: stop and rewind
- **Record video**: begin recording
- **Stop & Save**: finish current recording and download

## Implementation notes

The Web Audio `AudioContext.currentTime` clock is the playback source of truth. A 25 ms scheduler schedules oscillator events roughly 200 ms in advance; Three.js visual positions are computed from the same clock on every animation frame. Recording combines the WebGL canvas capture track with the Web Audio graph's MediaStream track.

This is an original implementation. The visualization approach was informed by [THREE-MIDI-Visualizer](https://github.com/Brackets-Coder/THREE-MIDI-Visualizer); it does not copy that project's source code.

## License

MIT.
