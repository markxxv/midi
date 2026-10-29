# LUMEN — MIDI Visual Studio

Browser-based 3D MIDI visualizer, sampled grand-piano player, playlist, and synchronized audio/video recorder.

## Run

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

For production: `npm run build`. For tests: `npm test`.

## Piano audio

- **No ToneJS or oscillator synthesizer**: uses [smplr](https://github.com/danigb/smplr) and its **SplendidGrandPiano** (four velocity layers of recorded Steinway grand-piano samples).
- Human-like key dynamics are derived from the original MIDI velocity.
- Stereo convolution reverb has a gentle **16% default wet level**, adjustable between 0% and 50%.
- The same Web Audio output is sent to the speakers and video capture, so **recorded video includes the piano and the reverb**.
- MIDI tempo changes and sustain-pedal CC64 are handled; drum-channel (channel 10) events are skipped in piano mode.
- Samples are **downloaded on first playback** and hosted externally. An internet connection is required when they have not been cached by the browser. The engine displays download progress and errors instead of silently switching to beeps.
- The Steinway sample pack is from [sfzinstruments-splendid-grand-piano](https://github.com/smpldsnds/sfzinstruments-splendid-grand-piano), **public domain**, originally distributed by AKAI. Samples are owned/licensed independently of this app.

## MIDI playlist

- Drag and drop **multiple `.mid` / `.midi` files** anywhere on the page or use **Add MIDI files** (multi-select).
- Imported MIDI files are added **in the order selected** and remain in memory during the current browser session.
- Playlist shows title and duration; select any file to play it.
- **Previous / Next** buttons, **Autoplay next** switch (enabled by default), remove individual entry, clear playlist.
- Built-in example arrangements and included `demo.mid` can also be added to the playlist.
- Each file can contain multiple MIDI tracks; they are performed together on the acoustic grand piano.
- Limit: 200 files per playlist and 15 MB per MIDI file. Invalid files are reported and skipped.
- The player stops when the last track finishes (does not loop the playlist).

## Visuals and export

- Three.js 3D falling notes and piano, UnrealBloomPass bloom, key glows, impact particles and camera drift.
- Four palettes: Aurora, Ember, Ocean, Mono. Control note travel and bloom intensity.
- Canvas formats **16:9**, **9:16**, **1:1**; **720p / 1080p** and **30 / 60 FPS**.
- **Record Video** records the currently selected MIDI, beginning at 00:00. Captures the same Web Audio graph, including reverb. Automatically saves when the file finishes, or use **Stop & Save**.
- Uses MediaRecorder. Format is browser-dependent (usually WebM, MP4 when supported); capture occurs in real time. Keep the tab visible during capture to avoid browser throttling.

## Structure

| File | Purpose |
| --- | --- |
| `src/midi.js` | Read and normalize Standard MIDI Files, tempo and pedal handling, built-in demos |
| `src/audio.js` | Sampled grand piano, reverb, shared audio clock and capture stream |
| `src/playlist.js` | In-memory playlist selection/removal/navigation |
| `src/visualizer.js` | Three.js piano roll and stage effects |
| `src/recorder.js` | Browser video and audio export |
| `src/main.js` | UI, controls, playlist playback and keyboard shortcuts |
| `src/style.css` | Responsive interface |

The visualizer's positions come from `AudioContext.currentTime` rather than the visual frame counter. A short lookahead schedules musical events and follows exact tempo changes.

This is an original implementation inspired by the visual approach of [THREE-MIDI-Visualizer](https://github.com/Brackets-Coder/THREE-MIDI-Visualizer). It doesn't copy that project's source code.

## License

Application code: MIT. External piano recordings: public domain (AKAI Splendid Grand); package smplr: MIT.
