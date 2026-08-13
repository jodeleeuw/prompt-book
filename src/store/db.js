// Thin IndexedDB wrapper. Two object stores: scripts, and scenes indexed by script.

const DB_NAME = 'prompt-book';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('scripts')) {
        db.createObjectStore('scripts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('scenes')) {
        const scenes = db.createObjectStore('scenes', { keyPath: 'id' });
        scenes.createIndex('scriptId', 'scriptId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database upgrade blocked by another tab.'));
  });
  return dbPromise;
}

const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

// The transaction is created after the await resolves, so it is still active
// when the request below is issued.
async function objectStore(name, mode) {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export const get = async (name, key) => request((await objectStore(name, 'readonly')).get(key));
export const getAll = async (name) => request((await objectStore(name, 'readonly')).getAll());

export const getAllBy = async (name, index, key) =>
  request((await objectStore(name, 'readonly')).index(index).getAll(key));

export const put = async (name, value) => request((await objectStore(name, 'readwrite')).put(value));

/** Write many records across stores in one transaction, so an import is all-or-nothing. */
export async function writeAll(entries) {
  if (!entries.length) return;
  const db = await openDb();
  const names = [...new Set(entries.map(([name]) => name))];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    for (const [name, value] of entries) tx.objectStore(name).put(value);
  });
}

/** Delete many records across stores in one transaction. */
export async function deleteAll(entries) {
  if (!entries.length) return;
  const db = await openDb();
  const names = [...new Set(entries.map(([name]) => name))];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    for (const [name, key] of entries) tx.objectStore(name).delete(key);
  });
}
