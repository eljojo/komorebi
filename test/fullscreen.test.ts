import { describe, expect, it } from 'vitest';
import { fullscreenOnDoubleClick, toggleFullscreen } from '../public/js/fullscreen.js';

// A stand-in for the bits of the DOM the toggle touches.
function fakes(fullscreenElement: unknown = null) {
  const calls: string[] = [];
  const doc = { fullscreenElement, exitFullscreen: () => calls.push('exit') };
  const el = { requestFullscreen: () => calls.push('request') };
  return { calls, doc, el };
}

describe('double-click to fullscreen (José, 2026-10-09)', () => {
  it('takes the canvas fullscreen when nothing is', () => {
    const { calls, doc, el } = fakes();
    toggleFullscreen(doc, el);
    expect(calls).toEqual(['request']);
  });

  it('comes back out when something is fullscreen', () => {
    const { calls, doc, el } = fakes({});
    toggleFullscreen(doc, el);
    expect(calls).toEqual(['exit']);
  });

  it('listens for a double-click on the canvas', () => {
    const { calls, doc, el } = fakes();
    const listeners: Record<string, () => void> = {};
    const canvas = Object.assign(el, { addEventListener: (type: string, fn: () => void) => (listeners[type] = fn) });
    fullscreenOnDoubleClick(canvas, doc);
    listeners.dblclick();
    expect(calls).toEqual(['request']);
  });
});
