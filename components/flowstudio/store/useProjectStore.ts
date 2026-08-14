import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import localforage from 'localforage';
import type { MediaItem, ProjectSettings, ActiveView, ConnectionState } from '../types';

const storage = localforage.createInstance({ name: 'flow-visual-studio' });

interface ProjectState {
  // View
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;

  // Media
  images: MediaItem[];
  videos: MediaItem[];
  setImages: (items: MediaItem[]) => void;
  setVideos: (items: MediaItem[]) => void;
  addMedia: (item: MediaItem) => void;
  removeMedia: (id: string) => void;
  updateMedia: (id: string, updates: Partial<MediaItem>) => void;

  // Settings
  settings: ProjectSettings;
  setSettings: (settings: Partial<ProjectSettings>) => void;

  // Connection
  flowkitStatus: ConnectionState;
  setFlowkitStatus: (status: ConnectionState) => void;
  backendStatus: ConnectionState;
  setBackendStatus: (status: ConnectionState) => void;

  // UI
  previewMedia: MediaItem | null;
  setPreviewMedia: (media: MediaItem | null) => void;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      // View
      activeView: 'all',
      setActiveView: (view) => set({ activeView: view }),

      // Media
      images: [],
      videos: [],
      setImages: (items) => set({ images: items }),
      setVideos: (items) => set({ videos: items }),
      addMedia: (item) =>
        set((state) => {
          if (item.type === 'image') {
            return { images: [item, ...state.images] };
          }
          return { videos: [item, ...state.videos] };
        }),
      removeMedia: (id) =>
        set((state) => ({
          images: state.images.filter((i) => i.id !== id),
          videos: state.videos.filter((v) => v.id !== id),
        })),
      updateMedia: (id, updates) =>
        set((state) => ({
          images: state.images.map((i) => (i.id === id ? { ...i, ...updates } : i)),
          videos: state.videos.map((v) => (v.id === id ? { ...v, ...updates } : v)),
        })),

      // Settings
      settings: {
        flowkitProjectId: '',
        globalArtStyle: '',
        aiProxyEndpoint: 'http://127.0.0.1:8045',
        aiProxyKey: '',
        aiProxyModel: 'gemini-3-flash',
      },
      setSettings: (updates) =>
        set((state) => ({
          settings: { ...state.settings, ...updates },
        })),

      // Connection
      flowkitStatus: 'disconnected',
      setFlowkitStatus: (status) => set({ flowkitStatus: status }),
      backendStatus: 'disconnected',
      setBackendStatus: (status) => set({ backendStatus: status }),

      // UI
      previewMedia: null,
      setPreviewMedia: (media) => set({ previewMedia: media }),
      isSidebarOpen: true,
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
    }),
    {
      name: 'flow-visual-studio-store',
      storage: createJSONStorage(() => ({
        getItem: async (name: string) => {
          const val = await storage.getItem<string>(name);
          return val ?? null;
        },
        setItem: async (name: string, value: string) => {
          await storage.setItem(name, value);
        },
        removeItem: async (name: string) => {
          await storage.removeItem(name);
        },
      })),
      partialize: (state) => ({
        activeView: state.activeView,
        settings: state.settings,
        isSidebarOpen: state.isSidebarOpen,
      }),
    }
  )
);
