'use client';

import React from 'react';
import { usePiP } from '@/hooks/usePiP';
import { PictureInPicture2, X, Monitor } from 'lucide-react';

/**
 * Prominent PiP toggle — shows a descriptive card when inactive,
 * compact close button when active. Only renders if Document PiP API is available.
 */
export function PiPButton({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const { isPiPSupported, isPiPActive, openPiP, closePiP } = usePiP();

  if (!isPiPSupported) return null;

  if (isPiPActive) {
    return (
      <button
        onClick={closePiP}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
          bg-[var(--accent,#22d3ee)]/10 text-[var(--accent,#22d3ee)] border border-[var(--accent,#22d3ee)]/20
          hover:bg-[var(--accent,#22d3ee)]/20 ${className}`}
        title="Close floating timer"
      >
        <X className="w-3.5 h-3.5" />
        Close Floating Timer
      </button>
    );
  }

  if (compact) {
    return (
      <button
        onClick={openPiP}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
          text-white/30 hover:text-white/60 hover:bg-white/5 border border-white/5 hover:border-white/10 ${className}`}
        title="Pop out timer as floating overlay"
      >
        <PictureInPicture2 className="w-3.5 h-3.5" />
        Float Timer
      </button>
    );
  }

  return (
    <button
      onClick={openPiP}
      className={`group flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all
        bg-gradient-to-r from-cyan-500/5 to-blue-500/5
        border border-white/[0.06] hover:border-cyan-500/20
        hover:from-cyan-500/10 hover:to-blue-500/10 ${className}`}
      title="Pop out a floating timer that stays on top while you work"
    >
      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-cyan-500/10 flex items-center justify-center group-hover:bg-cyan-500/15 transition-colors">
        <Monitor className="w-4.5 h-4.5 text-cyan-400/70 group-hover:text-cyan-400 transition-colors" />
      </div>
      <div className="flex-1 text-left min-w-0">
        <p className="text-sm font-medium text-white/60 group-hover:text-white/80 transition-colors">
          Float Timer
        </p>
        <p className="text-[11px] text-white/25 group-hover:text-white/40 transition-colors leading-tight mt-0.5">
          Have a floating Pomodoro timer while you work
        </p>
      </div>
      <PictureInPicture2 className="w-4 h-4 text-white/15 group-hover:text-white/30 flex-shrink-0 transition-colors" />
    </button>
  );
}
