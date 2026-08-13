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

/**
 * Apply many writes and deletes across stores in one transaction.
 * Ops are `{ store, put: value }` or `{ store, delete: key }`.
 *
 * Everything that mutates more than one record goes through here: an import
 * that half-succeeds, or a scene deletion that renumbers only some of its
 * siblings, would leave the library in a state nothing else expects.
 */
export async function transact(ops) {
  if (!ops.length) return;
  const db = await openDb();
  const names = [...new Set(ops.map((op) => op.store))];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    for (const op of ops) {
      const store = tx.objectStore(op.store);
      if ('delete' in op) store.delete(op.delete);
      else store.put(op.put);
    }
  });
}
