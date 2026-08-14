import React from 'react';
import { KeyframeData } from '../types';

interface KeyframeGridProps {
  keyframes: KeyframeData[];
}

const KeyframeGrid: React.FC<KeyframeGridProps> = ({ keyframes }) => {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 mt-3">
      {keyframes.map((frame) => (
        <div key={frame.sceneId} className="aspect-video bg-gray-200 rounded overflow-hidden flex flex-col items-center justify-center relative group">
          <img src={frame.url} alt={`Keyframe for Scene ${frame.sceneId}`} className="w-full h-full object-cover" />
          <div className="absolute bottom-0 left-0 right-0 text-xs text-white bg-black/60 w-full text-center py-0.5 transition-opacity opacity-0 group-hover:opacity-100">
            Cảnh {frame.sceneId}
          </div>
        </div>
      ))}
    </div>
  );
};

export default KeyframeGrid;