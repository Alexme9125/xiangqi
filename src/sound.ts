let context: AudioContext | null = null;
export function playMoveSound(capture: boolean) {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(capture ? 660 : 480, now);
    oscillator.frequency.exponentialRampToValueAtTime(capture ? 180 : 260, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now); oscillator.stop(now + 0.28);
  } catch { /* Sound is optional when a browser blocks audio. */ }
}
