// The pinned engine is a classic script that sets window.Komorebi. The page passes the file name from engine.json.
let loading;
export function loadEngine(file) {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `/engine/${file}`;
    script.onload = () => resolve(window.Komorebi);
    script.onerror = () => reject(new Error('the engine could not be loaded'));
    document.head.append(script);
  });
  return loading;
}
