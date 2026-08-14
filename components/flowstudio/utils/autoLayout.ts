/**
 * Auto-layout utilities for workflow nodes.
 * Arranges nodes in a tree/grid layout automatically.
 */

interface LayoutConfig {
  startX?: number;
  startY?: number;
  colWidth?: number;
  rowHeight?: number;
  maxCols?: number;
  hasVideo?: boolean;
}

/**
 * Calculate grid positions for child nodes below a parent.
 * Returns array of {x, y} positions.
 */
export function gridLayout(
  parentX: number,
  parentY: number,
  count: number,
  config: LayoutConfig = {},
): { x: number; y: number }[] {
  const hasVideo = config.hasVideo === true;
  const defaultColWidth = hasVideo ? 720 : 360;
  const defaultRowHeight = hasVideo ? 360 : 300;
  const defaultMaxCols = hasVideo ? 2 : 3;

  const {
    colWidth = defaultColWidth,
    rowHeight = defaultRowHeight,
    maxCols = defaultMaxCols,
  } = config;

  const cols = Math.min(count, maxCols);
  const totalWidth = cols * colWidth;
  const offsetX = parentX - totalWidth / 2 + colWidth / 2;

  return Array.from({ length: count }, (_, i) => ({
    x: offsetX + (i % cols) * colWidth,
    y: parentY + 280 + Math.floor(i / cols) * rowHeight,
  }));
}

/**
 * Calculate positions for a pipeline: Prompt → Images → Videos
 * Returns { imagePositions, videoPositions }
 */
export function pipelineLayout(
  promptX: number,
  promptY: number,
  imageCount: number,
  hasVideo: boolean = false,
  config: LayoutConfig = {},
) {
  const imagePositions = gridLayout(promptX, promptY, imageCount, { ...config, hasVideo });
  const videoPositions = hasVideo
    ? imagePositions.map(p => ({ x: p.x + 350, y: p.y }))
    : [];

  return { imagePositions, videoPositions };
}

/**
 * Generate a queue-friendly task for image generation.
 */
export function createImageTask(
  prompt: string,
  index: number,
  projectId: string,
  aspectRatio: string,
  refMediaIds?: string[],
) {
  return {
    id: `img_${Date.now()}_${index}`,
    label: `Ảnh ${index + 1}`,
    prompt,
    projectId,
    aspectRatio,
    refMediaIds,
  };
}
