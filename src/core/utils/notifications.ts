/**
 * Utility for triggering toolbar badge notifications and optional gentle chimes
 * Desktop OS notifications have been replaced by the non-intrusive toolbar icon badge.
 */
import { notifyToolbarBadge, clearToolbarBadge, setToolbarBadgeRunning } from './badge';

export { notifyToolbarBadge, clearToolbarBadge, setToolbarBadgeRunning };

export function playNotificationChime(): void {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Subtle gentle tone: 587.33 Hz (D5) -> 880 Hz (A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.16);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.1);
    gain2.gain.setValueAtTime(0.14, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.3);
  } catch {
    // AudioContext may be restricted before initial interaction
  }
}

export function triggerNotification(title: string, message: string): void {
  playNotificationChime();
  // Instead of intrusive desktop OS popups, trigger the toolbar icon badge
  if (title.toLowerCase().includes('budget')) {
    notifyToolbarBadge('budget_limit');
  } else if (title.toLowerCase().includes('input') || title.toLowerCase().includes('user')) {
    notifyToolbarBadge('ask_user', { question: message });
  } else if (title.toLowerCase().includes('completed') || title.toLowerCase().includes('finish')) {
    notifyToolbarBadge('finish', { summary: message });
  } else {
    notifyToolbarBadge('ask_user', { question: message });
  }
}
