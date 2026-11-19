/**
 * The photos themselves: the original file bytes, kept in IndexedDB under the widget's instance id.
 * Nothing is re-encoded or resized on the way in, so what is shown is the user's own file.
 * IndexedDB lives in the app's WebView data folder (%LOCALAPPDATA%), shared by every overlay window.
 */

const DB_NAME = "dotdock-photos";
const DB_VERSION = 1;
const STORE = "photos";

/** Image types WebView2 decodes natively. */
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/bmp"] as const;
/** Larger files are refused: they would take seconds to decode on every start for no visible gain. */
export const MAX_PHOTO_BYTES = 80 * 1024 * 1024;

export interface StoredPhoto {
  readonly blob: Blob;
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

export type PhotoProblem = "type" | "size" | "decode";

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error ?? new Error("Could not open photo storage"));
    };
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = work(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error("Photo storage failed"));
        tx.onabort = () => reject(tx.error ?? new Error("Photo storage was interrupted"));
      }),
  );
}

export function loadPhoto(id: string): Promise<StoredPhoto | undefined> {
  return run<StoredPhoto | undefined>("readonly", (s) => s.get(id) as IDBRequest<StoredPhoto | undefined>);
}

export async function savePhoto(id: string, photo: StoredPhoto): Promise<void> {
  await run("readwrite", (s) => s.put(photo, id));
}

/** Checks a picked file and reads its pixel size by decoding it once. */
export async function readPhotoFile(file: File): Promise<StoredPhoto | PhotoProblem> {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size > MAX_PHOTO_BYTES) return "size";
  try {
    const bitmap = await createImageBitmap(file);
    const photo = { blob: file, name: file.name, width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return photo;
  } catch {
    return "decode";
  }
}
