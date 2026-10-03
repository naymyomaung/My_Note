// Attachment file bytes live in IndexedDB (localStorage is too small for images).

const DB_NAME = "my-note-attachments";
const STORE_NAME = "blobs";
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open attachment storage."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = work(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Attachment storage failed."));
    });
  } finally {
    db.close();
  }
}

export async function saveAttachmentBlob(id: string, blob: Blob): Promise<void> {
  await withStore("readwrite", (store) => store.put(blob, id));
}

export async function getAttachmentBlob(id: string): Promise<Blob | undefined> {
  const blob = await withStore("readonly", (store) => store.get(id));
  return blob instanceof Blob ? blob : undefined;
}

export async function deleteAttachmentBlob(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}
