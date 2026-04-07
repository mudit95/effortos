'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/store/useStore';
import { useTimer } from '@/hooks/useTimer';
import { usePiPStore } from '@/hooks/usePiP';

/**
 * Renders a compact timer into the Document Picture-in-Picture window.
 * Uses a canvas-based renderer for reliability.
 * Reads PiP state from the shared Zustand store so it always has the
 * same window/container references that PiPButton created.
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

  const animFrameRef = useRef<number>(0);

  const activeTaskTitle = dashboardMode === 'daily'
    ? (dailyTasks.find(t => t.id === activeDailyTaskId)?.title || 'Unassigned')
    : (activeGoal?.title || '');

  const focusDuration = user?.settings?.focus_duration || 25 * 60;
  const breakDuration = user?.settings?.break_duration || 5 * 60;

  const renderCanvas = useCallback(() => {
    if (!pipContainer || !pipWindow) return;

    let canvas = pipContainer.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      canvas = pipWindow.document.createElement('canvas');
      canvas.width = 340;
      canvas.height = 220;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      pipContainer.innerHTML = '';
      pipContainer.appendChild(canvas);

      // Position container for overlay elements
      pipContainer.style.position = 'relative';
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = 340;
    const h = 220;
    const progress = isBreak
      ? 1 - (timeRemaining / breakDuration)
      : 1 - (timeRemaining / focusDuration);
    const timerColor = isBreak ? '#22c55e' : '#22d3ee';

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

    // Glow effect on the arc
    ctx.shadowColor = timerColor;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = timerColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Timer text
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(timeStr, cx, cy);

    // Status label (above ring)
    ctx.fillStyle = isBreak ? 'rgba(34,197,94,0.5)' : 'rgba(34,211,238,0.4)';
    ctx.font = '600 10px system-ui, -apple-system, sans-serif';
    ctx.fillText(isBreak ? 'BREAK' : 'FOCUS', cx, cy - radius - 14);

    // Task title
    const title = activeTaskTitle.length > 35
      ? activeTaskTitle.substring(0, 32) + '...'
      : activeTaskTitle;
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
    ctx.fillText(stateLabels[timerState] || '', cx, 192);

    // EffortOS branding
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.font = '9px system-ui, -apple-system, sans-serif';
    ctx.fillText('EffortOS', cx, 212);

  }, [pipContainer, pipWindow, timeRemaining, isBreak, timerState, focusDuration, breakDuration, activeTaskTitle]);

  // Render loop — runs when PiP is active
  useEffect(() => {
    if (!isPiPActive || !pipContainer || !pipWindow) return;

    const tick = () => {
      renderCanvas();
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isPiPActive, pipContainer, pipWindow, renderCanvas]);

  return null;
}
