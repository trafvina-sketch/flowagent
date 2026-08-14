export interface VideoDetails {
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  tags: string[];
  viewCount: string;
  likeCount: string;
  commentCount: string;
  duration: string;
  hasCaptions: boolean;
  videoPublishedAt: string;
  videoTopics: string[];
  subscriberCount: string;
  channelDescription: string;
  channelPublishedAt: string;
  channelViewCount: string;
  channelVideoCount: string;
  channelKeywords: string[];
  channelCountry: string;
  channelIsMadeForKids: boolean;
  channelTopics: string[];
}

export interface Chapter {
  timestamp: string;
  title: string;
}

export interface OptimizedSEO {
  titles: string[];
  description: string;
  tags: string;
  hashtags: string[];
  chapters: Chapter[];
  cta: string;
  shortsTitles: string[];
}

export enum Tone {
  Default = 'Mặc định',
  Friendly = 'Thân thiện (Vlog, Đời thường)',
  Professional = 'Chuyên nghiệp (Kinh doanh, Học thuật)',
  Humorous = 'Hài hước (Hài, Giải trí)',
  Explanatory = 'Giải thích (Hướng dẫn, Kỹ thuật)',
  Storytelling = 'Kể chuyện (Kịch tính, Tự sự)',
}

export interface Settings {
  tone: Tone;
  includeEmojis: boolean;
  channelName: string;
  videoDuration: string;
  outputLanguage: string;
  youtubeApiKey: string;
  geminiApiKeys: string[];
}

export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  videoId: string;
  originalDetails?: VideoDetails;
  optimizedSEO?: OptimizedSEO;
  thumbnailPrompt?: string;
  generatedThumbnailUrl?: string | null;
  timestamp: number;
}
