const _isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';
const BASE_URL = import.meta.env.VITE_API_URL || (_isFileProtocol ? 'http://127.0.0.1:8100' : '');
const _wsProto = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'wss:' : 'ws:';
const _wsHost = (typeof window !== 'undefined' && !_isFileProtocol) ? window.location.host : '127.0.0.1:8100';
const WS_BASE = import.meta.env.VITE_WS_URL || `${_wsProto}//${_wsHost}`;

export const API = {
  // Media
  images: `${BASE_URL}/api/images`,
  videos: `${BASE_URL}/api/videos`,
  mediaFile: `${BASE_URL}/api/media/file`,
  mediaUpload: `${BASE_URL}/api/media/upload`,
  mediaDownloadUrl: `${BASE_URL}/api/media/download-url`,
  mediaDelete: (id: string) => `${BASE_URL}/api/media/${id}`,
  mediaStats: `${BASE_URL}/api/media/stats`,
  mediaPickFolder: `${BASE_URL}/api/media/pick-folder`,
  mediaSaveToFolder: `${BASE_URL}/api/media/save-to-folder`,

  // Project
  project: `${BASE_URL}/api/project`,

  // FlowKit
  flowkitStatus: `${BASE_URL}/api/flowkit/status`,
  extCallback: `${BASE_URL}/api/ext/callback`,

  // Generate
  generateImage: `${BASE_URL}/api/generate/image`,
  generateVideo: `${BASE_URL}/api/generate/video`,
  uploadReference: `${BASE_URL}/api/generate/upload-reference`,
  uploadStartImage: `${BASE_URL}/api/generate/upload-start-image`,
  generateJobs: `${BASE_URL}/api/generate/jobs`,
  generateR2V: `${BASE_URL}/api/generate/r2v`,
  generateAudio: `${BASE_URL}/api/generate/audio`,
  uploadVideo: `${BASE_URL}/api/generate/upload-video`,
  createEntity: `${BASE_URL}/api/generate/create-entity`,
  createCharacter: `${BASE_URL}/api/generate/create-character`,
  i2vFile: `${BASE_URL}/api/generate/i2v-file`,

  // Agent
  agentScript: `${BASE_URL}/api/agent/generate-script`,
  agentChat: `${BASE_URL}/api/agent/chat`,

  // WebSocket
  wsFlowkit: `${WS_BASE}/ws/flowkit`,
} as const;

export { BASE_URL, WS_BASE };

/**
 * Resolve media URL for img/video src attributes.
 * In file:// protocol (EXE mode), relative paths like "/media-files/..." 
 * need to be prefixed with http://127.0.0.1:8100
 */
export function resolveMediaUrl(url: string | undefined | null): string {
  if (!url) return '';
  // Already absolute http(s) URL — return as-is
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }
  // Relative path in file:// mode — prepend backend URL
  if (_isFileProtocol && url.startsWith('/')) {
    return `http://127.0.0.1:8100${url}`;
  }
  return url;
}
