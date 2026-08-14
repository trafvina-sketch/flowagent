import { createContext } from 'react';

interface WorkflowContextType {
  onGenImage: (nodeId: string) => void;
  onGenVideo: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onBatchVideoCreated?: (batchNodeId: string, jobId: string, prompt: string) => void;
  onBatchGenImage?: (nodeId: string, prompts: string[], ratio: string, concurrent?: number) => void;
  onRegenImage?: (nodeId: string) => void;
  onRegenVideo?: (nodeId: string) => void;
  onBatchGenVideoFromImages?: () => void;
  onGenVideoFromVideoPrompt?: (nodeId: string) => void;
  onRetryFailedFromVideoPrompt?: (nodeId: string) => void;
}

export const WorkflowContext = createContext<WorkflowContextType>({
  onGenImage: () => {},
  onGenVideo: () => {},
  onDeleteNode: () => {},
  onBatchVideoCreated: () => {},
  onBatchGenImage: () => {},
  onRegenImage: () => {},
  onRegenVideo: () => {},
  onBatchGenVideoFromImages: () => {},
  onGenVideoFromVideoPrompt: () => {},
  onRetryFailedFromVideoPrompt: () => {},
});
