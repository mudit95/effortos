'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { PenLine, X } from 'lucide-react';

export function SessionNotesModal() {
  const showSessionNotes = useStore(s => s.showSessionNotes);
  const submitSessionNotes = useStore(s => s.submitSessionNotes);
  const dismissSessionNotes = useStore(s => s.dismissSessionNotes);
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    if (notes.trim()) {
      submitSessionNotes(notes.trim());
    } else {
      dismissSessionNotes();
    }
    setNotes('');
  };

  return (
    <AnimatePresence>
      {showSessionNotes && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-sm bg-[#131820] border border-white/10 rounded-2xl p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                <PenLine className="w-4 h-4 text-cyan-400" />
                <h3 className="text-base font-semibold text-white">Session complete!</h3>
              </div>
              <button
                onClick={() => { dismissSessionNotes(); setNotes(''); }}
                className="text-white/30 hover:text-white/60 transition-colors p-1"
                aria-label="Skip notes"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-white/40 mb-4">
              What did you accomplish? (optional)
            </p>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., Finished the auth flow, started on dashboard..."
              className="w-full h-20 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/25 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50 mb-4"
              autoFocus
            />

            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={() => { dismissSessionNotes(); setNotes(''); }}
              >
                Skip
              </Button>
              <Button
                variant="glow"
                size="sm"
                className="flex-1"
                onClick={handleSubmit}
              >
                Save Note
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
