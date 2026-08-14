
import type { VideoMetadata } from '../types';

// Hardcoded API key for YouTube Data API v3
const YOUTUBE_API_KEY = 'AIzaSyDwTSvkH1mvEuXwjbnE8OqpBlI3SMZTbDk';

const generateUUID = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};


const getVideoId = (url: string): string | null => {
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('music.youtube.com')) {
            const videoId = urlObj.searchParams.get('v');
            if (videoId) return videoId;
            if (urlObj.pathname.includes('/shorts/')) {
                return urlObj.pathname.split('/').filter(Boolean).pop() || null;
            }
        }
        if (urlObj.hostname === 'youtu.be') {
            return urlObj.pathname.split('/').filter(Boolean).pop() || null;
        }
        return null;
    } catch (e) {
        const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
        const match = url.match(regex);
        if (match) {
            return match[1];
        }
        return null;
    }
};

const formatSeconds = (totalSeconds: number): string => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const fmtHours = String(hours).padStart(2, '0');
    const fmtMinutes = String(minutes).padStart(2, '0');
    const fmtSeconds = String(seconds).padStart(2, '0');

    let formatted = `${fmtMinutes}:${fmtSeconds}`;
    if (hours > 0) {
        formatted = `${fmtHours}:${formatted}`;
    }
    return formatted;
};

const parseISO8601Duration = (duration: string): { seconds: number, formatted: string } => {
    const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
    const matches = duration.match(regex);
    if (!matches) return { seconds: 0, formatted: '00:00' };

    const hours = parseInt(matches[1] || '0', 10);
    const minutes = parseInt(matches[2] || '0', 10);
    const seconds = parseInt(matches[3] || '0', 10);

    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    return { seconds: totalSeconds, formatted: formatSeconds(totalSeconds) };
};

export const fetchFileMetadata = (file: File): Promise<VideoMetadata> => {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        // Create separate blob URLs: one for thumbnail extraction (will be revoked), one for playback (kept)
        const thumbnailBlobUrl = URL.createObjectURL(file);
        const playbackBlobUrl = URL.createObjectURL(file);
        
        video.onloadedmetadata = () => {
            const duration = video.duration;
            
            // Create a thumbnail by capturing a frame at 1 second (or 0 if very short)
            video.currentTime = Math.min(1, duration / 2);
            video.onseeked = () => {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
                const thumbnailUrl = canvas.toDataURL('image/jpeg');
                
                // Revoke the thumbnail blob URL — no longer needed (thumbnail is now a data URI)
                URL.revokeObjectURL(thumbnailBlobUrl);
                
                resolve({
                    videoId: 'local-' + generateUUID(),
                    title: file.name,
                    author_name: "Tệp nội bộ",
                    thumbnail_url: thumbnailUrl,
                    hasCaptions: false,
                    duration: duration,
                    durationFormatted: formatSeconds(duration),
                    localBlobUrl: playbackBlobUrl
                });
            };
        };

        video.onerror = () => {
            // Revoke both blob URLs on error — they won't be used
            URL.revokeObjectURL(thumbnailBlobUrl);
            URL.revokeObjectURL(playbackBlobUrl);
            
            resolve({
                videoId: 'local-error-' + generateUUID(),
                title: "Tệp video không hợp lệ",
                author_name: "Không rõ",
                thumbnail_url: 'https://placehold.co/480x360/1e293b/94a3b8/png?text=Lỗi+đọc+tệp',
                hasCaptions: false,
                duration: 0,
                durationFormatted: '00:00',
            });
        };

        video.src = thumbnailBlobUrl;
    });
};

export const fetchVideoMetadata = async (videoUrl: string): Promise<VideoMetadata> => {
    const videoId = getVideoId(videoUrl);

    if (!videoId) {
        return {
            videoId: 'invalid',
            title: "URL YouTube không hợp lệ",
            author_name: "Không rõ",
            thumbnail_url: 'https://placehold.co/480x360/1e293b/94a3b8/png?text=URL+không+hợp+lệ',
            hasCaptions: false,
            duration: 0,
            durationFormatted: '00:00',
        };
    }
    
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${YOUTUBE_API_KEY}`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`API YouTube error`);
        const data = await response.json();
        
        const videoItem = data.items?.[0];
        if (!videoItem) throw new Error("Video not found");
        
        const snippet = videoItem.snippet;
        const contentDetails = videoItem.contentDetails;
        const bestThumbnail = snippet.thumbnails.maxres || snippet.thumbnails.standard || snippet.thumbnails.high || snippet.thumbnails.medium || snippet.thumbnails.default;
        const durationInfo = parseISO8601Duration(contentDetails.duration);

        return {
            videoId: videoId,
            title: snippet.title,
            author_name: snippet.channelTitle,
            thumbnail_url: bestThumbnail.url,
            hasCaptions: contentDetails.caption === 'true',
            duration: durationInfo.seconds,
            durationFormatted: durationInfo.formatted,
        };
    } catch (error) {
        // Fallback for API failure: we still have the videoId from the URL
        return {
            videoId: videoId,
            title: "Tiêu đề Video (Không thể lấy từ API)",
            author_name: "YouTube Channel",
            thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            hasCaptions: false,
            duration: 0, // Fallback duration
            durationFormatted: 'N/A',
        };
    }
};
