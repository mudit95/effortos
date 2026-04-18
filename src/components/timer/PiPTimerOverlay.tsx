'use client';

import { useEffect, useRef } from 'react';
import { useStore } from '@/store/useStore';
import { useTimer } from '@/hooks/useTimer';
import { usePiPStore } from '@/hooks/usePiP';

/**
 * Renders a compact timer into the Document Picture-in-Picture window.
 * Uses a canvas-based renderer for reliability.
 *
 * Reads PiP state (window + container) from the shared Zustand store so
 * it always has the same references that PiPButton created when the user
 * opened the PiP window.
 *
 * Structure:
 *  - A "mount" effect runs when pipContainer/pipWindow change. It creates
 *    the <canvas>, attaches it to the container, and stashes it in a ref.
 *    Mutating the container here is unavoidable — the whole point of a
 *    PiP overlay is to put our pixels inside the PiP document — so the
 *    react-hooks/immutability rule is suppressed with justification.
 *  - A "draw" effect runs the RAF loop when isPiPActive flips on. It
 *    reads from the canvas ref and from the latest store values via
 *    another ref, so the RAF loop itself doesn't need to re-subscribe
 *    (and the draw function doesn't need to be recreated every tick).
 */
export function PiPTimerOverlay() {
  const isPiPActive = usePiPStore(s => s.isPiPActive);
  const pipContainer = usePiPStore(s => s.pipContainer);
  const pipWindow = usePiPStore(s => s.pipWindow);

  const { timerState, timeRemaining, isBreak } = useTimer();
  const user = useStore(s => s.user);
  const activeDailyTaskId = useStore(s => s.activeDailyTaskId);
  const dailyTasks = useStore(s => s.dailyTasks);
  const activeGoal = useStore(s => s.activeGoal);
  const dashboardMode = useStore(s => s.dashboardMode);

  // RAF handle. `null` (not 0) so the cleanup never calls
  // cancelAnimationFrame with a bogus id on first mount.
  const animFrameRef = useRef<number | null>(null);
  // Our own <canvas>, created once per PiP-window lifetime.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const activeTaskTitle = dashboardMode === 'daily'
    ? (dailyTasks.find(t => t.id === activeDailyTaskId)?.title || 'Unassigned')
    : (activeGoal?.title || '');

  const focusDuration = user?.settings?.focus_duration || 25 * 60;
  const breakDuration = user?.settings?.break_duration || 5 * 60;

  // Snapshot everything the RAF loop needs through a ref so draw() doesn't
  // close over stale values and the effect doesn't need to restart on
  // every tick-relevant change.
  const drawStateRef = useRef({
    timerState,
    timeRemaining,
    isBreak,
    focusDuration,
    breakDuration,
    activeTaskTitle,
  });
  drawStateRef.current = {
    timerState,
    timeRemaining,
    isBreak,
    focusDuration,
    breakDuration,
    activeTaskTitle,
  };

  // ── Mount <canvas> into the PiP container ─────────────────────────
  useEffect(() => {
    if (!pipContainer || !pipWindow) return;

    const canvas = pipWindow.document.createElement('canvas');
    canvas.width = 340;
    canvas.height = 220;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    // Mutating a DOM element that came back from a store hook is the
    // entire purpose of a PiP renderer. The react-hooks/immutability
    // rule assumes hook values are data; here it's the target surface.
    // eslint-disable-next-line react-hooks/immutability
    pipContainer.innerHTML = '';
    pipContainer.appendChild(canvas);
    // eslint-disable-next-line react-hooks/immutability
    pipContainer.style.position = 'relative';

    canvasRef.current = canvas;

    return () => {
      // PiP window's about to be torn down by PiPButton; clear our ref
      // so the next mount starts clean. We don't touch pipContainer on
      // unmount — the browser tears the whole PiP document down.
      canvasRef.current = null;
    };
  }, [pipContainer, pipWindow]);

  // ── RAF draw loop ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isPiPActive || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;

    const draw = () => {
      const s = drawStateRef.current;
      const w = 340;
      const h = 220;
      const progress = s.isBreak
        ? 1 - (s.timeRemaining / s.breakDuration)
        : 1 - (s.timeRemaining / s.focusDuration);
      const timerColor = s.isBreak ? '#22c55e' : '#22d3ee';

      // Clear
      ctx.fillStyle = '#0B0F14';
      ctx.fillRect(0, 0, w, h);

      // Ring
      const cx = w / 2;
      const cy = 90;
      const radius = 55;
      const lineWidth = 5;

      // Background ring
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = lineWidth;
      ctx.stroke();

      // Progress arc
      ctx.beginPath();
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (Math.PI * 2 * progress);
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.strokeStyle = timerColor;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Glow
      ctx.shadowColor = timerColor;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.strokeStyle = timerColor;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Timer text
      const minutes = Math.floor(s.timeRemaining / 60);
      const seconds = s.timeRemaining % 60;
      const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(timeStr, cx, cy);

      // Status label (above ring)
      ctx.fillStyle = s.isBreak ? 'rgba(34,197,94,0.5)' : 'rgba(34,211,238,0.4)';
      ctx.font = '600 10px system-ui, -apple-system, sans-serif';
      ctx.fillText(s.isBreak ? 'BREAK' : 'FOCUS', cx, cy - radius - 14);

      // Task title
      const title = s.activeTaskTitle.length > 35
        ? s.activeTaskTitle.substring(0, 32) + '...'
        : s.activeTaskTitle;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '12px system-ui, -apple-system, sans-serif';
      ctx.fillText(title, cx, 170);

      // State label
      const stateLabels: Record<string, string> = {
        running: 'Session in progress',
        paused: '⏸ Paused',
        break: 'Take a break',
        idle: 'Ready to focus',
      };
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '10px system-ui, -apple-system, sans-serif';
      ctx.fillText(stateLabels[s.timerState] || '', cx, 192);

      // EffortOS branding
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.font = '9px system-ui, -apple-system, sans-serif';
      ctx.fillText('EffortOS', cx, 212);
    };

    const tick = () => {
      if (cancelled) return;
      draw();
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelled = true;
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isPiPActive]);

  return null;
}
