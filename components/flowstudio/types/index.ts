export interface MediaItem {
  id: string;
  type: 'image' | 'video';
  filename: string;
  path: string;
  url: string;
  thumbnail?: string;
  prompt?: string;
  createdAt: string;
  fileSize: number;
  dimensions?: { width: number; height: number };
  duration?: number;
  status: 'ready' | 'generating' | 'failed';
  metadata?: Record<string, unknown>;
}

export interface ProjectSettings {
  flowkitProjectId: string;
  globalArtStyle: string;
  aiProxyEndpoint: string;
  aiProxyKey: string;
  aiProxyModel: string;
}

export interface MediaStats {
  totalImages: number;
  totalVideos: number;
  totalSize: number;
}

export type ActiveView = 'images' | 'videos' | 'all' | 'workflow';

export type ConnectionState = 'connected' | 'disconnected' | 'connecting';
