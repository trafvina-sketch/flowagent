
export enum StepStatus {
    PENDING,
    PROCESSING,
    COMPLETE,
    ERROR,
}

export interface SubStep {
    title: string;
    status: 'pending' | 'complete';
}

export interface KeyframeData {
    sceneId: number;
    url: string;
}

export interface KeyframeOutput {
    log: string;
    keyframes: KeyframeData[];
}

export interface AnalysisStep {
    title: string;
    status: StepStatus;
    output: string | KeyframeOutput;
    error: string | null;
    subSteps?: SubStep[];
}

export interface AnalysisState {
    currentStep: number;
    steps: AnalysisStep[];
}

export enum JobStatus {
    ANALYZING,
    COMPLETE,
    ERROR,
}

export interface Keyframe {
    ts: number;
    url: string;
    labels: string[];
}

export interface Scene {
    start: number;
    end: number;
    description: string;
}

export interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
}

export interface ChatMessage {
    sender: 'user' | 'ai';
    text: string;
}

export interface VideoMetadata {
    videoId: string; // "local" if from file
    title: string;
    author_name: string;
    thumbnail_url: string;
    hasCaptions: boolean;
    duration: number; // Duration in seconds
    durationFormatted: string; // Duration in hh:mm:ss format
    localBlobUrl?: string; // URL for playing local files
}

// ── Audio Mode ──────────────────────────────────────────────
// 'dialogue' : nhiều nhân vật có giọng riêng (cinematic/anime/3d)
// 'narration': 1 giọng thuyết minh duy nhất (voiceover style)
// 'asmr'     : không lời thoại, chỉ mô tả âm thanh
export type AudioMode = 'dialogue' | 'narration' | 'asmr';

export interface StoryCharacter {
    id: string;       // e.g. [HERO_V1] — Character Anchor ID
    name: string;
    prompt: string;   // Visual character sheet for image generation
    voice_id?: string; // TTS voice label (e.g. "male_deep", "female_soft") — unique per character
    original_names?: string[]; // Original character names in source video to allow automatic mapping
}

export interface StoryPart {
    part_id: number;
    title: string;
    summary: string;
    script: string; // High-level script for this part
    start_time: string; // "mm:ss"
    end_time: string;   // "mm:ss"
}
export interface StoryOutline {
    title: string;
    logline: string;
    characters: StoryCharacter[];
    parts: StoryPart[];
}


// Types for Gemini AI Analysis Response
export interface GeminiScene {
  scene_id: number;
  t0: string; // "mm:ss"
  t1: string; // "mm:ss"
  summary: string;
  action_prompt: string;
  CAM: string;
  SUBJ: string;
  SET: string;
  MOOD: string;
  FX: string;
  CLR: string;
  SND: string;
  EDIT: string;
  RNDR: string;
  '!FOCAL': string;
  TIM: string;
  title: string;
  style_video: string;
  /**
   * Dialogue mode  : Mỗi dòng bắt đầu bằng [CHAR_ID]: "..."
   *   VD: [HERO_V1]: "Anh không thể để điều này xảy ra!"
   *       [VILLAIN_V1]: "Ngây thơ quá."
   * Narration mode : Văn xuôi thuần túy, không prefix nhân vật.
   */
  script: string;
  /**
   * ID của nhân vật nói chính trong cảnh (dùng để route TTS voice).
   * null = cảnh narrator / không có thoại.
   */
  speaker_id: string | null;
  /**
   * TTS voice locale cho cảnh này (e.g. 'vi-VN', 'en-US', 'ko-KR').
   * Phải khớp với ngôn ngữ đầu ra đã chọn.
   */
  voice_locale?: string;
}

export interface CharacterProfile {
    id: string;
    description: string;
    physical_traits: string[];
}

export interface StyleProfile {
    medium: string;
    lighting: string;
    color_grading: string;
    lens_film: string;
    environment_materials: string;
    style_tags: string[];
}

export interface GeminiAsset {
    id: string;
    type: 'character' | 'location' | 'prop';
    description: string;
}

export interface GeminiAnalysisResponse {
  video_meta: {
    url: string;
    title: string;
    duration_sec: number;
    style: { mood: string; palette: string[]; music: string; };
    /**
     * Chế độ audio:
     * - 'dialogue'  : Nhiều nhân vật, mỗi nhân vật có giọng TTS riêng.
     * - 'narration' : 1 người dẫn chuyện duy nhất.
     */
    audio_mode: AudioMode;
  };
  character_profile?: CharacterProfile;
  style_profile?: StyleProfile;
  sample_video_prompt?: string;
  scenes: GeminiScene[];
  assets: GeminiAsset[];
  story_outline?: StoryOutline;
}

export interface LibraryEntry {
    id: string; 
    url: string; // original link or "file://filename"
    title: string;
    thumbnail_url: string;
    createdAt: number; 
    completedAt?: number; 
    result?: GeminiAnalysisResponse;
    status: 'pending' | 'processing' | 'complete' | 'error';
    error?: string;
    modelId?: string; 
    languageCode?: string;
    isLocalFile?: boolean;
    localBlobUrl?: string;
    duration?: number;
    styleWeight?: number;      // Remix phong cách (0-100%)
    characterWeight?: number;  // Remix nhân vật (0-100%)
    userNote?: string;         // Yêu cầu remix / ý tưởng phần tiếp theo
    includeSrtAnalysis?: boolean;
    generateSrt?: boolean;
}
