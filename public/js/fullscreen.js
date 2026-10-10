// Double-click a look to take it fullscreen, and again to come back (José, 2026-10-09). The engine reads the
// canvas's CSS size every frame, so it re-renders at the new size by itself.
export function toggleFullscreen(doc, el) {
  if (doc.fullscreenElement) doc.exitFullscreen();
  else el.requestFullscreen();
}

export function fullscreenOnDoubleClick(canvas, doc = document) {
  canvas.addEventListener('dblclick', () => toggleFullscreen(doc, canvas));
}
