import type { DictationTarget } from "#lib/plugins/conversation/ports.js";

const METER_BANDS = [120, 200, 330, 550, 900, 1500, 2500, 4200];

type Recording = {
  stream?: MediaStream;
  recorder?: MediaRecorder;
  meter?: AudioContext;
  metering?: number;
  clock?: ReturnType<typeof setInterval>;
  deadline?: ReturnType<typeof setTimeout>;
  request?: AbortController;
  chunks: Blob[];
  bytes: number;
};

export class DictationSession {
  phase = $state<"idle" | "opening" | "recording" | "finishing">("idle");
  message = $state("");
  elapsed = $state(0);
  levels = $state.raw(METER_BANDS.slice(0, -1).map(frequency => ({ frequency, level: 0 })));
  #recording?: Recording;
  #disposed = false;
  constructor(private editor: DictationTarget, private busy: (value: boolean) => void) {}

  async start() {
    if (this.#disposed || this.#recording || !this.editor.beginDictation()) return;
    const recording: Recording = { chunks: [], bytes: 0 };
    this.#recording = recording;
    this.phase = "opening";
    this.message = "";
    this.elapsed = 0;
    this.levels = this.levels.map(bar => ({ ...bar, level: 0 }));
    this.busy(true);
    recording.deadline = setTimeout(() => this.#fail(recording, "请检查麦克风权限后重试。"), 30_000);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.#recording !== recording) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      recording.stream = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("当前浏览器不支持录音。");
      const recorder = new MediaRecorder(stream, { mimeType });
      recording.recorder = recorder;
      recorder.ondataavailable = event => {
        if (this.#recording !== recording || !event.data.size) return;
        recording.bytes += event.data.size;
        if (recording.bytes > 2 * 1024 * 1024) {
          this.#fail(recording, "录音过长，请缩短后再试。");
          return;
        }
        recording.chunks.push(event.data);
      };
      recorder.onerror = () => this.#fail(recording, "录音中断，请重新开始。");
      recorder.onstop = () => {
        if (this.#recording !== recording) return;
        this.phase = "finishing";
        this.#releaseMicrophone(recording);
        recording.deadline = setTimeout(() => this.#fail(recording, "识别等待超时，请重试。"), 30_000);
        void this.#transcribe(recording, mimeType);
      };
      recorder.start(250);
      clearTimeout(recording.deadline);
      this.phase = "recording";
      this.#startMeter(recording, stream);
      const started = performance.now();
      recording.clock = setInterval(() => {
        this.elapsed = Math.floor((performance.now() - started) / 1000);
        if (this.elapsed >= 60) this.finish();
      }, 250);
      for (const track of stream.getTracks()) track.onended = () => this.#fail(recording, "麦克风已断开，请重新开始。");
    } catch (error) {
      const message = error instanceof Error && error.name === "NotAllowedError"
        ? "请允许麦克风访问后重试。"
        : "无法使用麦克风，请检查设备后重试。";
      this.#fail(recording, message);
    }
  }

  #startMeter(recording: Recording, stream: MediaStream) {
    // Optional local feedback: recording has already started and never waits for the meter.
    try {
      const context = new AudioContext();
      recording.meter = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.55;
      context.createMediaStreamSource(stream).connect(analyser);
      void context.resume().catch(() => {});
      const samples = new Float32Array(analyser.fftSize);
      const spectrum = new Float32Array(analyser.frequencyBinCount);
      const bins = METER_BANDS.map(frequency => Math.min(spectrum.length, Math.round(frequency * analyser.fftSize / context.sampleRate)));
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      let previous = performance.now();
      const draw = (now: number) => {
        if (this.#recording !== recording || this.phase !== "recording") return;
        const delta = Math.min(50, now - previous);
        previous = now;
        analyser.getFloatTimeDomainData(samples);
        analyser.getFloatFrequencyData(spectrum);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        const gate = Math.min(1, Math.max(0, (rms - 0.006) / 0.012));
        // Each stationary bar follows its own voice band, with a soft attack and longer release.
        this.levels = this.levels.map((bar, index) => {
          let peak = -Infinity;
          for (let bin = bins[index]!; bin < bins[index + 1]!; bin++) peak = Math.max(peak, spectrum[bin]!);
          const target = gate * Math.min(1, Math.max(0, (peak + 70) / 48));
          const envelope = target > bar.level ? 75 : 220;
          const response = reducedMotion ? 350 : envelope;
          const level = bar.level + (target - bar.level) * (1 - Math.exp(-delta / response));
          return { frequency: bar.frequency, level: level < 0.002 ? 0 : level };
        });
        recording.metering = requestAnimationFrame(draw);
      };
      recording.metering = requestAnimationFrame(draw);
    } catch { /* Metering support is optional; MediaRecorder continues recording. */ }
  }

  finish() {
    const recording = this.#recording;
    if (!recording || this.phase !== "recording") return;
    this.phase = "finishing";
    recording.recorder?.stop();
    this.#releaseMicrophone(recording);
  }
  cancel() {
    if (!this.#recording) return;
    this.#close(this.#recording);
    this.editor.finishDictation(false);
  }
  async #transcribe(recording: Recording, mimeType: string) {
    try {
      if (!recording.bytes) throw new Error("没有听清，请再说一次。");
      recording.request = new AbortController();
      const response = await fetch("/api/speech/transcribe", {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: new Blob(recording.chunks, { type: mimeType }),
        signal: recording.request.signal,
      });
      if (!response.ok) throw new Error("暂时无法识别语音，请再试一次。");
      const result: { text: string } = await response.json();
      if (this.#recording !== recording) return;
      const text = result.text.trim();
      if (!text) throw new Error("没有听清，请再说一次。");
      const error = this.editor.previewDictation(text);
      if (error) throw new Error(error);
      this.#close(recording);
      this.editor.finishDictation(true);
    } catch (error) {
      this.#fail(recording, error instanceof Error ? error.message : "暂时无法识别语音，请重试。");
    }
  }
  #fail(recording: Recording, message: string) {
    if (this.#recording !== recording) return;
    this.#close(recording);
    this.editor.finishDictation(false);
    this.message = message;
  }
  #releaseMicrophone(recording: Recording) {
    clearInterval(recording.clock);
    if (recording.metering !== undefined) cancelAnimationFrame(recording.metering);
    if (recording.meter) {
      void recording.meter.close().catch(() => {});
      recording.meter = undefined;
    }
    this.levels = this.levels.map(bar => ({ ...bar, level: 0 }));
    recording.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
  }
  #close(recording: Recording) {
    if (this.#recording !== recording) return;
    this.#recording = undefined;
    clearTimeout(recording.deadline);
    recording.request?.abort();
    if (recording.recorder) {
      recording.recorder.onstop = recording.recorder.onerror = recording.recorder.ondataavailable = null;
      if (recording.recorder.state === "recording") recording.recorder.stop();
    }
    this.#releaseMicrophone(recording);
    this.phase = "idle";
    this.busy(false);
  }
  dispose() { this.#disposed = true; this.cancel(); }
}
