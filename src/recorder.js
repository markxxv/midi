export class VideoRecorder {
  constructor(visualizer, audio) {
    this.visualizer = visualizer;
    this.audio = audio;
    this.recording = false;
    this.mediaRecorder = null;
    this.videoStream = null;
    this.chunks = [];
    this.onFinish = null;
  }

  get mimeType() {
    if (!window.MediaRecorder) return '';
    return [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
    ].find(type => MediaRecorder.isTypeSupported(type)) || '';
  }

  static dimensions(ratio, quality) {
    const long = Number(quality) === 720 ? 1280 : 1920;
    if (ratio === '9:16') return { width: long * 9 / 16, height: long };
    if (ratio === '1:1') return { width: Number(quality) === 720 ? 720 : 1080, height: Number(quality) === 720 ? 720 : 1080 };
    return { width: long, height: long * 9 / 16 };
  }

  async start({ ratio, quality, fps, name, onFinish }) {
    if (this.recording) return;
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      throw new Error('Video recording requires a recent Chrome, Edge, or Safari browser.');
    }
    await this.audio.init();
    const mimeType = this.mimeType;
    if (!mimeType) throw new Error('This browser does not support MediaRecorder video encoding.');
    const dimensions = VideoRecorder.dimensions(ratio, quality);
    this.onFinish = onFinish;
    this.name = name;
    this.chunks = [];
    this.visualizer.setExportSize(dimensions);
    // Make sure WebGL has rendered at the export resolution before capturing.
    this.visualizer.render(0);
    try {
      this.videoStream = this.visualizer.canvas().captureStream(Number(fps));
      const audioTrack = this.audio.stream()?.getAudioTracks() || [];
      if (!audioTrack.length) throw new Error('The audio capture stream is unavailable.');
      const stream = new MediaStream([...this.videoStream.getVideoTracks(), ...audioTrack]);
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: Number(quality) === 720 ? 10_000_000 : 18_000_000,
        audioBitsPerSecond: 192_000,
      });
      this.mediaRecorder.ondataavailable = event => {
        if (event.data?.size) this.chunks.push(event.data);
      };
      this.mediaRecorder.onerror = event => {
        this.finish(new Error(event.error?.message || 'Recording failed.'));
      };
      this.mediaRecorder.onstop = () => this.finish();
      this.mediaRecorder.start(1000);
      this.recording = true;
      this.audio.stop();
      await this.audio.play();
    } catch (error) {
      this.recording = false;
      this.videoStream?.getTracks().forEach(track => track.stop());
      if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();
      this.visualizer.setExportSize(null);
      throw error;
    }
  }

  stop() {
    if (!this.recording) return;
    this.recording = false;
    this.audio.pause();
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();
  }

  finish(error = null) {
    this.recording = false;
    this.videoStream?.getTracks().forEach(track => track.stop());
    this.videoStream = null;
    this.visualizer.setExportSize(null);
    if (error) {
      this.onFinish?.(error);
      return;
    }
    if (!this.chunks.length) {
      this.onFinish?.(new Error('The browser did not produce any video data.'));
      return;
    }
    const mime = this.mediaRecorder?.mimeType || 'video/webm';
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(this.chunks, { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = String(this.name || 'lumen').toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
    a.href = url;
    a.download = (safeName || 'lumen') + '-lumen.' + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    this.onFinish?.(null, { bytes: blob.size, format: ext });
    this.chunks = [];
  }
}
