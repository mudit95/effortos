'use client';

import { create } from 'zustand';

/**
 * Shared PiP state store — ensures PiPButton and PiPTimerOverlay
 * share the same window/container references.
 */
interface PiPState {
  isPiPActive: boolean;
  pipWindow: Window | null;
  pipContainer: HTMLDivElement | null;
  setActive: (active: boolean, win?: Window | null, container?: HTMLDivElement | null) => void;
  clear: () => void;
}

export const usePiPStore = create<PiPState>((set) => ({
  isPiPActive: false,
  pipWindow: null,
  pipContainer: null,
  setActive: (active, win = null, container = null) =>
    set({ isPiPActive: active, pipWindow: win, pipContainer: container }),
  clear: () =>
    set({ isPiPActive: false, pipWindow: null, pipContainer: null }),
}));

const isPiPSupported =
  typeof window !== 'undefined' && 'documentPictureInPicture' in window;

export async function openPiP() {
  if (!isPiPSupported) return;

  const { setActive } = usePiPStore.getState();

  try {
    // @ts-expect-error — documentPictureInPicture not yet in TS lib
    const pipWindow: Window = await window.documentPictureInPicture.requestWindow({
      width: 340,
      height: 220,
    });

    // Copy stylesheets into PiP window
    const styles = document.querySelectorAll('style, link[rel="stylesheet"]');
    styles.forEach((style) => {
      pipWindow.document.head.appendChild(style.cloneNode(true));
    });

    // Add base styles
    const baseStyle = pipWindow.document.createElement('style');
    baseStyle.textContent = `
      :root {
        --accent: #22d3ee;
        --background: #0B0F14;
      }
      body {
        margin: 0;
        padding: 0;
        background: #0B0F14;
        color: white;
        font-family: system-ui, -apple-system, sans-serif;
        overflow: hidden;
        -webkit-font-smoothing: antialiased;
      }
      * { box-sizing: border-box; }
    `;
    pipWindow.document.head.appendChild(baseStyle);

    // Create container
    const container = pipWindow.document.createElement('div');
    container.id = 'pip-root';
    pipWindow.document.body.appendChild(container);

    setActive(true, pipWindow, container);

    // Listen for PiP window close
    pipWindow.addEventListener('pagehide', () => {
      usePiPStore.getState().clear();
    });
  } catch (err) {
    console.warn('PiP failed:', err);
  }
}

export function closePiP() {
  const { pipWindow, clear } = usePiPStore.getState();
  if (pipWindow) {
    pipWindow.close();
  }
  clear();
}

export function usePiP() {
  const { isPiPActive, pipWindow, pipContainer } = usePiPStore();

  return {
    isPiPSupported,
    isPiPActive,
    pipContainer,
    pipWindow,
    openPiP,
    closePiP,
  };
}
