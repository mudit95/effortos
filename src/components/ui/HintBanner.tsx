'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lightbulb } from 'lucide-react';

interface HintBannerProps {
  id: string;          // unique hint ID for tracking
  children: React.ReactNode;
  icon?: React.ReactNode;
}

export function HintBanner({ id, children, icon }: HintBannerProps) {
  const [dismissed, setDismissed] = React.useState(false);

  // Check if hint was already seen
  React.useEffect(() => {
    try {
      const seen = JSON.parse(localStorage.getItem('effortos_hints_seen') || '[]');
      if (seen.includes(id)) setDismissed(true);
    } catch {}
  }, [id]);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      const seen = JSON.parse(localStorage.getItem('effortos_hints_seen') || '[]');
      if (!seen.includes(id)) {
        seen.push(id);
        localStorage.setItem('effortos_hints_seen', JSON.stringify(seen));
      }
    } catch {}
  };

  if (dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className="overflow-hidden"
      >
        <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-cyan-500/[0.06] border border-cyan-500/10 mb-3">
          <div className="shrink-0 mt-0.5">
            {icon || <Lightbulb className="w-3.5 h-3.5 text-cyan-400/60" />}
          </div>
          <p className="flex-1 text-xs text-white/40 leading-relaxed">{children}</p>
          <button
            onClick={handleDismiss}
            className="shrink-0 p-0.5 text-white/20 hover:text-white/50 transition-colors"
            aria-label="Dismiss hint"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
