// Simple in-memory store for image files from ImageUploadNode
// Keyed by node ID, stores File objects for deferred upload

const store = new Map<string, File[]>();

export const setImageFiles = (nodeId: string, files: File[]) => {
  store.set(nodeId, files);
};

export const getImageFiles = (nodeId: string): File[] => {
  return store.get(nodeId) || [];
};

export const clearImageFiles = (nodeId: string) => {
  store.delete(nodeId);
};
