/**
 * useTaskQueue — Concurrent task queue with progress tracking.
 * Replaces sequential for-loops with parallel execution (max N concurrent).
 */
import { useState, useCallback, useRef } from 'react';

export interface QueueTask<T = any> {
  id: string;
  label: string;
  execute: () => Promise<T>;
}

export interface QueueResult<T = any> {
  id: string;
  label: string;
  success: boolean;
  result?: T;
  error?: string;
}

interface QueueState<T = any> {
  pending: number;
  running: number;
  completed: QueueResult<T>[];
  failed: QueueResult<T>[];
  total: number;
  isRunning: boolean;
  progress: string; // "3/5"
}

export function useTaskQueue<T = any>(concurrency = 3) {
  const [state, setState] = useState<QueueState<T>>({
    pending: 0,
    running: 0,
    completed: [],
    failed: [],
    total: 0,
    isRunning: false,
    progress: '',
  });

  const abortRef = useRef(false);

  /**
   * Run tasks concurrently with max concurrency.
   * Returns { completed, failed } arrays.
   */
  const runAll = useCallback(async (tasks: QueueTask<T>[]) => {
    const total = tasks.length;
    const completed: QueueResult<T>[] = [];
    const failed: QueueResult<T>[] = [];
    let runningCount = 0;

    abortRef.current = false;

    setState({
      pending: total,
      running: 0,
      completed: [],
      failed: [],
      total,
      isRunning: true,
      progress: `0/${total}`,
    });

    // Create a queue of tasks to process
    const queue = [...tasks];
    const active: Promise<void>[] = [];

    const processNext = async (): Promise<void> => {
      if (abortRef.current || queue.length === 0) return;

      const task = queue.shift()!;
      runningCount++;

      setState(prev => ({
        ...prev,
        pending: queue.length,
        running: runningCount,
        progress: `${completed.length + failed.length}/${total}`,
      }));

      try {
        const result = await task.execute();
        completed.push({ id: task.id, label: task.label, success: true, result });
      } catch (err: any) {
        failed.push({
          id: task.id,
          label: task.label,
          success: false,
          error: err?.response?.data?.detail || err.message || 'Unknown error',
        });
      }

      runningCount--;

      setState(prev => ({
        ...prev,
        running: runningCount,
        completed: [...completed],
        failed: [...failed],
        progress: `${completed.length + failed.length}/${total}`,
      }));

      // Process next task if available
      if (queue.length > 0 && !abortRef.current) {
        await processNext();
      }
    };

    // Start up to `concurrency` parallel workers
    const workers = Math.min(concurrency, tasks.length);
    for (let i = 0; i < workers; i++) {
      active.push(processNext());
    }

    await Promise.all(active);

    setState(prev => ({
      ...prev,
      isRunning: false,
      progress: `${completed.length + failed.length}/${total}`,
    }));

    return { completed, failed };
  }, [concurrency]);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  return { ...state, runAll, abort };
}
