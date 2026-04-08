'use client';

import React, { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Page error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0B0F14] text-white p-4">
      <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
      <p className="text-white/50 mb-4 text-sm max-w-md text-center">
        {error.message || 'An unexpected error occurred.'}
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm"
        >
          Try again
        </button>
        <button
          onClick={() => {
            // Clear all state and reload
            try { localStorage.clear(); } catch {}
            window.location.href = '/';
          }}
          className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
        >
          Reset & Reload
        </button>
      </div>
    </div>
  );
}
