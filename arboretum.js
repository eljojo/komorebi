// ============================================================================
// Komorebi editor — arboretum's DOM half (editor-integration-design §6.2). EDITOR ONLY, reached solely through the dynamic
// import behind `detect` in editor.js. This is the placeholder the gate loads until the sign-in and playlist UI is written:
// it only marks the page, so the smoke can see the gate open, and is replaced whole.
// ============================================================================
export function mount(origin) {
  document.body.dataset.arboretum = origin;
}
