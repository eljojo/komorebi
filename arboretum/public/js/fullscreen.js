// Double-click a look to take it fullscreen, and again to come back (José, 2026-10-09). The engine reads the
// canvas's CSS size every frame, so it re-renders at the new size by itself.
// Fullscreen is a nicety: a browser without the API, or one that refuses the request, leaves the look inline.
export function toggleFullscreen(doc, el) {
  const [owner, method] = doc.fullscreenElement ? [doc, 'exitFullscreen'] : [el, 'requestFullscreen'];
  if (typeof owner[method] !== 'function') return;
  Promise.resolve(owner[method]()).catch(() => {});
}

export function fullscreenOnDoubleClick(canvas, doc = document) {
  canvas.addEventListener('dblclick', () => toggleFullscreen(doc, canvas));
}
