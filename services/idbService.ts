import { LibraryEntry } from '../types';

const DB_NAME = 'ContentFactoryDB';
const STORE_NAME = 'analysisHistory';
const DB_VERSION = 1;

let db: IDBDatabase;

export const initDB = (): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        if (db) return resolve(true);

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('IndexedDB error:', request.error);
            reject('Error opening database');
        };

        request.onsuccess = () => {
            db = request.result;
            resolve(true);
        };

        request.onupgradeneeded = (event) => {
            const dbInstance = (event.target as IDBOpenDBRequest).result;
            if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
                // 'id' is our videoId, which is unique for successful analyses.
                // For failures, we generate a unique ID.
                dbInstance.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
};

export const addHistoryEntry = (entry: LibraryEntry): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(entry); // Use put instead of add for robustness

        request.onsuccess = () => resolve();
        request.onerror = () => {
            console.error('Error adding entry:', request.error);
            reject(request.error);
        };
    });
};

export const updateHistoryEntry = (entry: LibraryEntry): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(entry);

        request.onsuccess = () => resolve();
        request.onerror = () => {
            console.error('Error updating entry:', request.error);
            reject(request.error);
        };
    });
};

export const getHistory = (): Promise<LibraryEntry[]> => {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            // Sort by createdAt descending (newest first)
            const sorted = (request.result as LibraryEntry[]).sort((a, b) => b.createdAt - a.createdAt);
            resolve(sorted);
        };
        request.onerror = () => {
            console.error('Error getting history:', request.error);
            reject(request.error);
        };
    });
};

export const deleteHistoryEntry = (id: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => {
            console.error('Error deleting entry:', request.error);
            reject(request.error);
        };
    });
};

export const clearHistory = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => {
            console.error('Error clearing history:', request.error);
            reject(request.error);
        };
    });
};