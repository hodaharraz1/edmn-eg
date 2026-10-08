'use client';

/**
 * Short, subtle two-note chime generated with WebAudio (no audio file, no loop). Browsers only allow audio
 * after a user gesture: the context is created/resumed on the first click or key press, and until then the
 * chime is simply skipped — we never try to work around autoplay rules. Sound is supplementary only: the
 * badge, toast and live region always carry the information.
 */
let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function playChime(): boolean {
  try {
    if (!ctx || ctx.state !== 'running') return false;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    gain.connect(ctx.destination);
    for (const [freq, start] of [
      [880, 0],
      [1318.5, 0.12],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, now + start);
      o.connect(gain);
      o.start(now + start);
      o.stop(now + start + 0.18);
    }
    window.dispatchEvent(new CustomEvent('edmn:chime'));
    return true;
  } catch {
    return false;
  }
}
