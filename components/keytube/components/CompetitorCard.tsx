import React, { useState } from 'react';
import { Eye, Heart, MessageSquare, Calendar, Award, Globe, Copy, Check, UserCheck, Key } from 'lucide-react';
import type { VideoDetails } from '../types';

interface CompetitorCardProps {
  details: VideoDetails;
  videoId: string;
}

export const CompetitorCard: React.FC<CompetitorCardProps> = ({ details, videoId }) => {
  const [copiedTags, setCopiedTags] = useState(false);
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

  const handleCopyTags = async () => {
    if (details.tags.length === 0) return;
    await navigator.clipboard.writeText(details.tags.join(', '));
    setCopiedTags(true);
    setTimeout(() => setCopiedTags(false), 2000);
  };

  const formatNumber = (numStr: string) => {
    const num = parseInt(numStr);
    if (isNaN(num)) return 'N/A';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  return (
    <div className="bg-cinema-900/60 backdrop-blur-md border border-cinema-700/40 rounded-2xl overflow-hidden shadow-xl flex flex-col h-full">
      {/* Thumbnail Header */}
      <div className="relative aspect-video w-full bg-black/40 overflow-hidden group">
        <img
          src={thumbnailUrl}
          alt={details.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          onError={(e) => {
            e.currentTarget.src = `https://img.youtube.com/vi/${videoId}/sddefault.jpg`;
          }}
        />
        <div className="absolute top-3 left-3 px-3 py-1 bg-black/70 backdrop-blur-sm rounded-lg text-xs font-semibold border border-white/10 text-white/90">
          Độ dài: {details.duration}
        </div>
        <div className="absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-black to-transparent" />
      </div>

      <div className="p-5 flex-1 flex flex-col space-y-4">
        {/* Title */}
        <div className="space-y-1.5">
          <span className="text-[10px] tracking-widest uppercase font-bold text-pink-500">Video Đối Thủ</span>
          <h3 className="text-base font-bold text-gray-100 leading-snug line-clamp-2" title={details.title}>
            {details.title}
          </h3>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="font-semibold text-purple-400">{details.channelTitle}</span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Globe className="w-3.5 h-3.5" />
              {details.channelCountry || 'N/A'}
            </span>
          </div>
        </div>

        {/* Video Statistics Grid */}
        <div className="grid grid-cols-3 gap-2.5 bg-cinema-950/50 p-3 rounded-xl border border-cinema-800">
          <div className="text-center space-y-0.5">
            <div className="flex items-center justify-center text-gray-400 gap-1 text-[10px] uppercase font-bold tracking-wider">
              <Eye className="w-3 h-3 text-blue-400" />
              <span>Xem</span>
            </div>
            <p className="text-xs font-extrabold text-gray-200">{formatNumber(details.viewCount)}</p>
          </div>
          <div className="text-center space-y-0.5 border-x border-cinema-800">
            <div className="flex items-center justify-center text-gray-400 gap-1 text-[10px] uppercase font-bold tracking-wider">
              <Heart className="w-3 h-3 text-red-500" />
              <span>Thích</span>
            </div>
            <p className="text-xs font-extrabold text-gray-200">{formatNumber(details.likeCount)}</p>
          </div>
          <div className="text-center space-y-0.5">
            <div className="flex items-center justify-center text-gray-400 gap-1 text-[10px] uppercase font-bold tracking-wider">
              <MessageSquare className="w-3 h-3 text-green-400" />
              <span>C.Luận</span>
            </div>
            <p className="text-xs font-extrabold text-gray-200">{formatNumber(details.commentCount)}</p>
          </div>
        </div>

        {/* Channel Details */}
        <div className="space-y-2 text-xs text-gray-300 flex-1">
          <div className="flex items-center justify-between py-1.5 border-b border-cinema-800/40">
            <span className="text-gray-400 flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-purple-400" />
              Subscribers Kênh:
            </span>
            <span className="font-bold text-purple-300">{formatNumber(details.subscriberCount)}</span>
          </div>
          <div className="flex items-center justify-between py-1.5 border-b border-cinema-800/40">
            <span className="text-gray-400 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-blue-400" />
              Ngày Đăng Video:
            </span>
            <span className="font-semibold text-gray-200">
              {new Date(details.videoPublishedAt).toLocaleDateString('vi-VN')}
            </span>
          </div>
          {details.videoTopics.length > 0 && (
            <div className="py-1.5 space-y-1">
              <span className="text-gray-400 flex items-center gap-1.5 mb-1">
                <Award className="w-4 h-4 text-yellow-500" />
                Chủ Đề Phân Loại:
              </span>
              <div className="flex flex-wrap gap-1">
                {details.videoTopics.map((topic, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded-md text-[10px] capitalize font-medium"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Tags Section */}
        <div className="space-y-2 pt-2 border-t border-cinema-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-400 flex items-center gap-1">
              <Key className="w-3.5 h-3.5 text-pink-500" />
              Bộ Thẻ Tags Đối Thủ ({details.tags.length})
            </span>
            {details.tags.length > 0 && (
              <button
                onClick={handleCopyTags}
                className="text-[10px] font-bold text-pink-400 hover:text-pink-300 flex items-center gap-1 transition-colors"
              >
                {copiedTags ? (
                  <>
                    <Check className="w-3 h-3 text-green-400" />
                    <span>Đã chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Chép tất cả</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div className="max-h-24 overflow-y-auto bg-cinema-950/40 p-2 border border-cinema-800 rounded-lg">
            {details.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {details.tags.map((tag, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 bg-cinema-800 text-gray-300 rounded text-[10px] font-mono select-all hover:bg-cinema-700 transition-colors"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-600 text-center py-2 font-medium">Video này không có thẻ Tags nào.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
