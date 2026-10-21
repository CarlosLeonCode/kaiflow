/**
 * A short, soft two-note chime made with WebAudio (no audio file to bundle, nothing loaded
 * from the network). Best effort: a webview that refuses to start audio stays silent.
 */

type AudioContextCtor = new () => AudioContext;

/** Two bell-like notes, a fifth apart (E5, B5), each with a quick attack and a long fade. */
const NOTES: readonly { frequency: number; at: number }[] = [
  { frequency: 659.25, at: 0 },
  { frequency: 987.77, at: 0.16 },
];
const PEAK_GAIN = 0.16;
const DECAY_S = 1.4;

function audioContext(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function playChime(): void {
  const Ctor = audioContext();
  if (!Ctor) return;
  try {
    const ctx = new Ctor();
    void ctx.resume?.();
    const start = ctx.currentTime + 0.02;
    for (const note of NOTES) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(note.frequency, start + note.at);
      gain.gain.setValueAtTime(0.0001, start + note.at);
      gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, start + note.at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + DECAY_S);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + note.at);
      osc.stop(start + note.at + DECAY_S + 0.05);
    }
    window.setTimeout(() => void ctx.close().catch(() => undefined), (DECAY_S + 0.5) * 1000);
  } catch {
    // No audio output or autoplay refused: the notification and the end card still show.
  }
}
