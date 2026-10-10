export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export const day = (ms) => (ms == null ? 'never' : new Date(ms).toISOString().slice(0, 10));

// The page's one status line.
export function say(root, text) {
  root.querySelector('.msg').textContent = text;
}
