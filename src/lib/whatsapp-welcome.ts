/**
 * Persona-aware WhatsApp welcome message.
 *
 * Called from /api/whatsapp/verify (action: 'confirm') after a user
 * verifies their phone via OTP. The user picks one of four bot
 * personas during onboarding (or in Settings later); the welcome
 * message is the first place that voice shows up.
 *
 * Each persona keeps the same _functional_ payload — quick-start
 * cheat sheet, "send help", etc. — but rewrites greetings, sign-offs
 * and humour. We deliberately keep the structure stable so users can
 * switch personas later without losing the cheat sheet.
 */
import type { BotPersona } from '@/types';

interface WelcomeOpts {
  firstName: string;
  goalTitle: string | null;
  persona: BotPersona;
}

const CHEATSHEET =
  '*Quick start — try any of these:*\n' +
  '• Add tasks — _Study React 2 poms, review PRs_\n' +
  '• See today\'s list — _tasks_\n' +
  '• Mark done — reply with the *number*\n' +
  '• Errands — _remind me to grab groceries_\n' +
  '• Voice notes work too 🎤\n' +
  '\n' +
  '💡 Pro tip: when I show a numbered list, just reply with *1*, *2 and 4*, or *delete 3* — I\'ll figure out the rest.\n' +
  '\n' +
  'Send *help* anytime for the full menu.';

function goalLineFor(persona: BotPersona, goalTitle: string | null): string {
  // Each persona refers to the goal in its own voice. When we don't
  // have a goal yet, fall back to a persona-flavoured generic line.
  if (!goalTitle) {
    switch (persona) {
      case 'friend':
        return "I've got your back on whatever you're chasing.";
      case 'mentor':
        return "I'll help you build the habits to get there, whatever 'there' looks like.";
      case 'boss':
        return "Tell me what we're shipping and I'll keep us honest.";
      case 'colleague':
        return "Drop your todos here — happy to keep the list moving with you.";
    }
  }
  switch (persona) {
    case 'friend':
      return `We're tackling *${goalTitle}* together. I'll cheer, nag, and occasionally roast — whatever it takes. 💪`;
    case 'mentor':
      return `Your focus is *${goalTitle}*. Let's break it into something compoundable — small reps, every day.`;
    case 'boss':
      return `Mission: *${goalTitle}*. I'll track the deliverables. You bring the execution. 📈`;
    case 'colleague':
      return `Logged: *${goalTitle}*. I'll keep the queue tidy — ping me when something needs to move.`;
  }
}

/**
 * Build the welcome WhatsApp body for a freshly-linked user.
 * Returns the full message string, ready for sendTextMessage().
 */
export function buildWelcomeMessage({ firstName, goalTitle, persona }: WelcomeOpts): string {
  const goalLine = goalLineFor(persona, goalTitle);

  switch (persona) {
    case 'friend':
      return (
        `🎉 Yo ${firstName}! WhatsApp linked — we are officially a duo.\n` +
        `\n` +
        `${goalLine}\n` +
        `\n` +
        `${CHEATSHEET}\n` +
        `\n` +
        `Alright, what are we crushing first? 🚀`
      );

    case 'mentor':
      return (
        `🌱 Welcome, ${firstName}. Glad you're here.\n` +
        `\n` +
        `${goalLine}\n` +
        `\n` +
        `${CHEATSHEET}\n` +
        `\n` +
        `Progress is built one focused block at a time. What's the very next step?`
      );

    case 'boss':
      return (
        `🫡 ${firstName}, you're on the books. WhatsApp link confirmed.\n` +
        `\n` +
        `${goalLine}\n` +
        `\n` +
        `${CHEATSHEET}\n` +
        `\n` +
        `Stand-up's whenever you reply. What's on the agenda?`
      );

    case 'colleague':
      return (
        `👋 Hey ${firstName} — WhatsApp's hooked up, we're good to go.\n` +
        `\n` +
        `${goalLine}\n` +
        `\n` +
        `${CHEATSHEET}\n` +
        `\n` +
        `What do you want to knock out first? I'll keep notes.`
      );
  }
}

/**
 * Defensive default — if the persona column is somehow NULL (e.g.
 * a profile created before migration 020) treat them as a 'friend'.
 * Used at every read site instead of `?? 'friend'` so the fallback
 * is documented in one place.
 */
export function resolvePersona(value: unknown): BotPersona {
  if (value === 'mentor' || value === 'boss' || value === 'colleague') return value;
  // Anything else, including 'friend', null, undefined, or unexpected → 'friend'.
  return 'friend';
}
