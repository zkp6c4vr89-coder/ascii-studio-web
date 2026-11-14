// Keeps the browser wallpaper (the photo/video itself + its look) in IndexedDB,
// so the extension's New Tab page can show it. Stays on this device.

const DB = "ascii-studio", STORE = "wallpaper", KEY = "current";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

// data: { mode: "source" | "rain", blob?: Blob, isVideo?: boolean, settings: {...} }
export const saveWallpaper = (data) => run("readwrite", (s) => s.put(data, KEY));
export const loadWallpaper = () => run("readonly", (s) => s.get(KEY));
export const clearWallpaper = () => run("readwrite", (s) => s.delete(KEY));
