import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatRelativeDate(date: string | Date): string {
  const now = new Date();
  const target = new Date(date);
  const diffMs = target.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays < 0) return `${Math.abs(diffDays)} days ago`;
  if (diffDays <= 7) return `${diffDays} days`;
  if (diffDays <= 30) return `${Math.ceil(diffDays / 7)} weeks`;
  return `${Math.ceil(diffDays / 30)} months`;
}

export function sessionsToHours(sessions: number): number {
  return Math.round((sessions * 25 / 60) * 10) / 10;
}

export function hoursToSessions(hours: number): number {
  return Math.round(hours * 60 / 25);
}

export function clampBias(value: number): number {
  return Math.max(-2, Math.min(2, value));
}

export function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}

export function getStreaks(dailySessions: { date: string; count: number }[]): { current: number; longest: number } {
  if (!dailySessions.length) return { current: 0, longest: 0 };

  const sorted = [...dailySessions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  let current = 0;
  let longest = 0;
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < sorted.length; i++) {
    const sessionDate = new Date(sorted[i].date);
    sessionDate.setHours(0, 0, 0, 0);
    const expectedDate = new Date(today);
    expectedDate.setDate(expectedDate.getDate() - i);
    expectedDate.setHours(0, 0, 0, 0);

    if (sessionDate.getTime() === expectedDate.getTime() && sorted[i].count > 0) {
      streak++;
      if (i === 0 || streak > 0) current = streak;
    } else {
      break;
    }
  }

  // Calculate longest streak
  streak = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].count > 0) {
      streak++;
      longest = Math.max(longest, streak);
    } else {
      streak = 0;
    }
  }

  return { current, longest };
}
