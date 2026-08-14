/**
 * useStoryMemory — Save/load story state for multi-episode continuity.
 */
import { useState, useCallback } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

export interface StoryCharacter {
  name: string;
  role: string;
  description: string;
  design_prompt: string;
  media_ids: string[];
}

export interface StoryEpisode {
  ep: number;
  title: string;
  summary: string;
  key_events: string[];
  cliffhanger: string;
  scene_count: number;
  created_at?: string;
}

export interface StorySummary {
  project_id: string;
  title: string;
  episodes: number;
  characters: number;
  total_scenes: number;
  updated_at: string;
}

export function useStoryMemory() {
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [currentStory, setCurrentStory] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  // List all saved stories
  const listStories = useCallback(async () => {
    try {
      const res = await axios.get('/api/story/list');
      if (res.data.success) {
        setStories(res.data.stories);
        return res.data.stories;
      }
    } catch (err) {
      console.error('Failed to list stories:', err);
    }
    return [];
  }, []);

  // Load a specific story
  const loadStory = useCallback(async (projectId: string) => {
    try {
      const res = await axios.get(`/api/story/${projectId}`);
      if (res.data.success) {
        setCurrentStory(res.data.story);
        return res.data.story;
      }
    } catch (err) {
      console.error('Failed to load story:', err);
    }
    return null;
  }, []);

  // Save story after episode creation
  const saveStory = useCallback(async (
    projectId: string,
    title: string,
    characters: StoryCharacter[],
    episode: StoryEpisode,
    worldState: Record<string, any> = {},
    styleDna: Record<string, any> = {},
    scenesInEpisode: number = 0,
  ) => {
    try {
      const res = await axios.post('/api/story/save', {
        project_id: projectId,
        title,
        characters,
        episode,
        world_state: worldState,
        style_dna: styleDna,
        scenes_in_episode: scenesInEpisode,
      });
      if (res.data.success) {
        toast.success(`📚 Story saved! ${res.data.message}`);
        return true;
      }
    } catch (err: any) {
      toast.error(`Lỗi lưu story: ${err.message}`);
    }
    return false;
  }, []);

  // Build context for next episode
  const buildContinueContext = useCallback(async (
    projectId: string,
    userDirection: string = '',
    sceneCount: number = 5,
  ) => {
    setIsLoading(true);
    try {
      const res = await axios.post('/api/story/build-context', {
        project_id: projectId,
        user_direction: userDirection,
        scene_count: sceneCount,
      });
      setIsLoading(false);
      if (res.data.success) {
        return {
          context: res.data.context,
          nextEpisode: res.data.next_episode,
          characterMediaIds: res.data.character_media_ids,
          characters: res.data.characters,
        };
      }
    } catch (err: any) {
      setIsLoading(false);
      toast.error(`Lỗi load context: ${err.message}`);
    }
    return null;
  }, []);

  // Delete a story
  const deleteStory = useCallback(async (projectId: string) => {
    try {
      await axios.delete(`/api/story/${projectId}`);
      setStories(prev => prev.filter(s => s.project_id !== projectId));
      toast.success('Story deleted');
    } catch (err) {
      toast.error('Lỗi xóa story');
    }
  }, []);

  return {
    stories, currentStory,
    isLoading,
    listStories, loadStory, saveStory,
    buildContinueContext, deleteStory,
  };
}
