import type { VideoDetails } from '../types';

const VIDEOS_API_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';
const CHANNELS_API_ENDPOINT = 'https://www.googleapis.com/youtube/v3/channels';

// Interface for the video API response
interface YouTubeVideoApiResponse {
    items: {
        id: string;
        snippet: {
            publishedAt: string;
            title: string;
            description: string;
            channelId: string;
            channelTitle: string;
            tags?: string[];
            thumbnails: {
                default: { url: string; };
                medium: { url: string; };
                high: { url: string; };
                maxres?: { url: string; };
            };
        };
        contentDetails: {
            duration: string;
            caption: string;
        };
        statistics: {
            viewCount?: string;
            likeCount?: string;
            commentCount?: string;
        };
        topicDetails?: {
            topicCategories?: string[];
        };
    }[];
}

// Interface for the channel API response
interface YouTubeChannelApiResponse {
    items: {
        snippet: {
            description: string;
            publishedAt: string;
            country?: string;
        };
        statistics: {
            subscriberCount?: string;
            viewCount?: string;
            videoCount?: string;
        };
        brandingSettings?: {
            channel?: {
                keywords?: string;
            };
        };
        topicDetails?: {
            topicCategories?: string[];
        };
        status?: {
            madeForKids?: boolean;
        };
    }[];
}

// Helper to parse ISO 8601 duration to human-readable (HH:MM:SS)
const parseDuration = (isoDuration: string): string => {
    const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
    const matches = isoDuration.match(regex);
    if (!matches) return "00:00";

    const hours = parseInt(matches[1] || '0');
    const minutes = parseInt(matches[2] || '0');
    const seconds = parseInt(matches[3] || '0');

    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');

    if (hours > 0) {
        return `${hh}:${mm}:${ss}`;
    }
    return `${mm}:${ss}`;
};

// Helper to parse channel keywords
const parseChannelKeywords = (keywordsStr?: string): string[] => {
    if (!keywordsStr) return [];
    const matches = keywordsStr.match(/(?:"[^"]+"|[^"\s]+)/g);
    return matches ? matches.map(k => k.replace(/"/g, '')) : [];
};

// Helper to parse Wikipedia URLs from topics
const parseTopicDetails = (topicDetails?: { topicCategories?: string[] }): string[] => {
    if (!topicDetails?.topicCategories) return [];
    return topicDetails.topicCategories.map(url => {
        try {
            return decodeURIComponent(url.split('/').pop() || '').replace(/_/g, ' ');
        } catch (e) {
            return '';
        }
    }).filter(Boolean);
};

export const getVideoDetails = async (videoId: string, apiKey: string): Promise<VideoDetails> => {
    const videoUrl = `${VIDEOS_API_ENDPOINT}?id=${videoId}&key=${apiKey}&part=snippet,contentDetails,statistics,topicDetails`;

    try {
        // Step 1: Fetch Video Details
        const videoResponse = await fetch(videoUrl);
        if (!videoResponse.ok) {
            const errorData = await videoResponse.json();
            const errorMessage = errorData?.error?.message || `Lỗi API YouTube (Videos): ${videoResponse.statusText}`;
            throw new Error(errorMessage);
        }
        
        const videoData: YouTubeVideoApiResponse = await videoResponse.json();

        if (!videoData.items || videoData.items.length === 0) {
            throw new Error("Không tìm thấy video với ID đã cung cấp. Vui lòng kiểm tra lại URL.");
        }

        const item = videoData.items[0];
        const { snippet, contentDetails, statistics, topicDetails: videoTopicDetails } = item;
        const { channelId } = snippet;

        // Step 2: Fetch Channel Details
        const channelUrl = `${CHANNELS_API_ENDPOINT}?id=${channelId}&key=${apiKey}&part=snippet,statistics,brandingSettings,topicDetails,status`;
        let channelDetails: {
            subscriberCount: string;
            channelDescription: string;
            channelPublishedAt: string;
            channelViewCount: string;
            channelVideoCount: string;
            channelKeywords: string[];
            channelCountry: string;
            channelIsMadeForKids: boolean;
            channelTopics: string[];
        } = {
            subscriberCount: '0',
            channelDescription: '',
            channelPublishedAt: '',
            channelViewCount: '0',
            channelVideoCount: '0',
            channelKeywords: [],
            channelCountry: 'N/A',
            channelIsMadeForKids: false,
            channelTopics: [],
        };
        
        try {
            const channelResponse = await fetch(channelUrl);
            if (channelResponse.ok) {
                const channelData: YouTubeChannelApiResponse = await channelResponse.json();
                if (channelData.items && channelData.items.length > 0) {
                    const channelItem = channelData.items[0];
                    channelDetails = {
                        subscriberCount: channelItem.statistics?.subscriberCount || '0',
                        channelDescription: channelItem.snippet?.description || '',
                        channelPublishedAt: channelItem.snippet?.publishedAt || '',
                        channelViewCount: channelItem.statistics?.viewCount || '0',
                        channelVideoCount: channelItem.statistics?.videoCount || '0',
                        channelKeywords: parseChannelKeywords(channelItem.brandingSettings?.channel?.keywords),
                        channelCountry: channelItem.snippet?.country || 'N/A',
                        channelIsMadeForKids: channelItem.status?.madeForKids || false,
                        channelTopics: parseTopicDetails(channelItem.topicDetails),
                    };
                }
            }
        } catch (channelError) {
             console.warn(`Could not fetch channel details: ${channelError}`);
        }

        return {
            title: snippet.title,
            description: snippet.description,
            channelId: snippet.channelId,
            channelTitle: snippet.channelTitle,
            tags: snippet.tags || [],
            viewCount: statistics?.viewCount || '0',
            likeCount: statistics?.likeCount || '0',
            commentCount: statistics?.commentCount || '0',
            duration: parseDuration(contentDetails.duration),
            hasCaptions: contentDetails.caption === 'true',
            videoPublishedAt: snippet.publishedAt,
            videoTopics: parseTopicDetails(videoTopicDetails),
            ...channelDetails,
        };

    } catch (error) {
        console.error("Error fetching video details from YouTube:", error);
        if (error instanceof Error) {
            throw new Error(`Không thể lấy chi tiết video từ YouTube. ${error.message}`);
        }
        throw new Error("Không thể lấy chi tiết video từ YouTube do lỗi mạng hoặc API Key.");
    }
};
