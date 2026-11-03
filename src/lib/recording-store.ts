/**
 * Lokale buffer (IndexedDB) voor opnamesegmenten die nog niet bij de server zijn.
 * Een segment blijft hier staan tot de upload gelukt is, zodat een gecrashte tab,
 * slaapstand of netwerkstoring geen audio kost. Ook het lopende segment wordt
 * periodiek weggeschreven (checkpoint).
 */

export type StoredSegment = {
  meetingId: string;
  index: number;
  offsetSeconds: number;
  durationSeconds: number;
  blob: Blob;
  savedAt: number;
};

const DB_NAME = "ai-meetings-recordings";
const STORE = "segments";

function key(meetingId: string, index: number) {
  return `${meetingId}:${index}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB niet beschikbaar"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Fouten worden ingeslikt: de buffer is een vangnet, nooit een reden om de opname te stoppen. */
export async function saveSegment(seg: StoredSegment): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.put(seg, key(seg.meetingId, seg.index)));
  } catch (err) {
    console.warn("[recording-store] opslaan mislukt:", err);
  }
}

export async function deleteSegment(meetingId: string, index: number): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(key(meetingId, index)));
  } catch (err) {
    console.warn("[recording-store] verwijderen mislukt:", err);
  }
}

export async function listSegments(meetingId: string): Promise<StoredSegment[]> {
  try {
    const all = (await withStore("readonly", (s) => s.getAll())) as StoredSegment[];
    return all.filter((s) => s.meetingId === meetingId).sort((a, b) => a.index - b.index);
  } catch {
    return [];
  }
}
