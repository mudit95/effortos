import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { extractIncomingMessage, sendTextMessage, sendButtonMessage, downloadWhatsAppMedia } from '@/lib/whatsapp';
import { parseWhatsAppMessage, type WAIntent } from '@/lib/whatsapp-ai';
import { getUserTimezone, todayKeyInTz, dateKeyInTz } from '@/lib/user-date';
import {
  setPendingFlow,
  consumePendingFlow,
  setTaskList,
  getTaskList,
  setErrandList,
  getErrandList,
  setLastListType,
  getLastListType,
  checkWhatsappRateLimit,
} from '@/lib/whatsapp-state';

// ── Text normalization helpers ────────────────────────────────────────────
// Mobile keyboards (especially iOS) auto-substitute curly quotes and em-dashes
// for the ASCII originals. AI-generated task titles tend to use ASCII. This
// mismatch alone broke fuzzy matching: "Ale's letter" (curly apostrophe in
// the user's reply) didn't substring-match "Ale's letter" (ASCII apostrophe
// in the stored title). Normalize both sides before any case-insensitive
// includes() check.
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // curly single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // curly double quotes
    .replace(/[\u2013\u2014\u2015]/g, '-')        // en-dash, em-dash, horizontal bar
    .replace(/\s+/g, ' ')
    .trim();
}

// Strip a leading list-position prefix from a fuzzy-match query. Users often
// reproduce the number from the list they were just shown — "done with 6. Ale's
// letter" shouldn't fail just because "6. " isn't part of the stored title.
// Falls back to the full normalized string if stripping leaves nothing.
function fuzzyTitleQuery(query: string): string {
  const q = normalizeForMatch(query);
  const stripped = q.replace(/^#?\d{1,3}\s*[.):\-]?\s+/, '').trim();
  return stripped.length > 0 ? stripped : q;
}

// Extract a list-position number from a wide variety of phrasings the user
// might use after we've shown them a numbered list. Returns null if the
// message doesn't look like a numbered reply at all. Patterns covered:
//   "1", "1.", "#1", "✓ 1", "✅ 1"
//   "1 done", "1 complete", "1 finished"
//   "done 1", "done with 1", "complete 1", "completed 1", "finished 1"
//   "mark 1", "mark 1 done", "mark 1 as done"
// Anything fancier ("done with task 1", "done with 6. Ale's letter") falls
// through to the text-based fuzzy matcher — fuzzyTitleQuery will strip the
// leading "6." so the substring check still finds the right task.
function extractListPosition(input: string): number | null {
  // Strip trailing punctuation and leading checkmark glyphs first.
  const s = input
    .trim()
    .replace(/[\u2705\u2713\u2714]/g, '') // ✅ ✓ ✔
    .replace(/[.!?]+$/, '')
    .trim();
  if (!s) return null;
  // Pattern A: number first, optional verb after.
  let m = s.match(/^#?\s*(\d{1,3})\s*(?:done|complete|completed|finished)?$/i);
  if (m) return parseInt(m[1], 10);
  // Pattern B: verb first, then number, optional trailing modifier.
  m = s.match(/^(?:done|complete|completed|finished|mark)\s+(?:with\s+)?#?(\d{1,3})(?:\s+(?:done|as\s+done|complete|completed|finished))?$/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

// ── Webhook signature verification ──
// Meta signs every webhook POST with X-Hub-Signature-256 using your app secret.
// Verifying this prevents spoofed requests from third parties.
//
// Behaviour:
//   - In production (NODE_ENV === 'production'): if META_APP_SECRET is missing
//     we FAIL CLOSED. A misconfigured webhook should never accept anonymous
//     payloads — the cost of a spoofed message executing actions on a user's
//     account is far higher than the cost of a 503 until ops fix the env.
//   - In non-production: missing secret bypasses verification so local dev /
//     preview environments can use ngrok without real Meta keys.
function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[WhatsApp] META_APP_SECRET is not set in production — refusing webhook to avoid accepting spoofed payloads.',
      );
      return false;
    }
    // Dev / preview only.
    console.warn('[WhatsApp] META_APP_SECRET not set — skipping verification (non-production).');
    return true;
  }
  if (!signature) return false;

  try {
    const expectedSig = 'sha256=' + createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    // timingSafeEqual throws if lengths differ
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return false;

    return timingSafeEqual(sigBuf, expectedBuf);
  } catch (err) {
    console.error('[WhatsApp] Signature verification error:', err);
    return false;
  }
}

// ── Persistent webhook state ──
// Rate limits, multi-step flow tracking, and numbered-task memory live in
// Redis (see @/lib/whatsapp-state). Module-scoped Maps don't survive across
// Vercel instances so anything we used to keep here was effectively
// ephemeral and per-cold-container — see the doc-comment on whatsapp-state.ts
// for the full rationale.

/**
 * GET /api/whatsapp/webhook
 * Meta sends a verification challenge when you first configure the webhook.
 */
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (
    mode === 'subscribe' &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new Response(challenge || '', { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * POST /api/whatsapp/webhook
 * Receives incoming WhatsApp messages, parses intent via AI, executes action.
 */
export async function POST(req: NextRequest) {
  // WhatsApp expects a 200 quickly — process in-band but keep it fast.
  try {
    const rawBody = await req.text();

    // Verify Meta webhook signature if app secret is configured
    const signature = req.headers.get('x-hub-signature-256');
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.error('[WhatsApp] Invalid webhook signature — rejecting request');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error('[WhatsApp] Failed to parse webhook body');
      return NextResponse.json({ status: 'ok' });
    }
    const msg = extractIncomingMessage(body);

    // Not a user message (e.g. status callback) — acknowledge silently
    if (!msg) {
      return NextResponse.json({ status: 'ok' });
    }

    const { from, text, buttonReplyId, audioId } = msg;

    // ── 1. Look up user by phone number ──
    const supabase = createServiceClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, name, phone_number, focus_duration')
      .eq('phone_number', `+${from}`)
      .single();

    if (!profile) {
      await sendTextMessage(
        from,
        `👋 Hey! I don't recognize this number yet.\n\nTo link your WhatsApp to EffortOS:\n1. Open EffortOS → Settings\n2. Add your WhatsApp number\n3. Send me a message again!\n\nNeed an account? Sign up at effortos-zeta.vercel.app`,
      );
      return NextResponse.json({ status: 'ok' });
    }

    // ── 1b. Check for pending multi-step flow (e.g., journal entry) ──
    // consumePendingFlow uses GETDEL so two near-simultaneous deliveries
    // can't both consume the same flow. Redis TTL (10 min) handles
    // expiration server-side — no manual sweep needed.
    const pendingFlow = await consumePendingFlow(from);
    if (pendingFlow) {
      if (pendingFlow.type === 'journal' || pendingFlow.type === 'reflection') {
        await handleSaveJournalEntry(supabase, pendingFlow.userId, from, text);
        return NextResponse.json({ status: 'ok' });
      }
    }

    // ── 1c. Handle voice notes — transcribe and process as text ──
    if (audioId && !text) {
      await handleVoiceNote(supabase, profile, from, audioId);
      return NextResponse.json({ status: 'ok' });
    }

    // ── 1d. Handle numbered task/errand completion ──
    // The user replies with a position number (and maybe a verb) referring
    // to whichever list we showed them most recently. extractListPosition
    // accepts the messy real-world variants ("1", "Done 1", "Done with 1",
    // "Mark 6 as done", "✓ 1", etc.) — see helper above for the full list.
    //
    // Disambiguation: getLastListType tells us whether the most recent list
    // was tasks or errands, so "3" resolves correctly without confusing
    // task #3 with errand #3. If we have no recent list at all, we tell the
    // user how to get one rather than silently passing through to the AI
    // parser (which would almost certainly classify "3" as off-topic).
    const trimmedText = text.trim();
    const listPos = extractListPosition(trimmedText);
    if (listPos !== null && listPos > 0) {
      const lastList = await getLastListType(from);
      const ids = lastList === 'errands'
        ? await getErrandList(from)
        : await getTaskList(from);

      if (!ids || ids.length === 0) {
        await sendTextMessage(
          from,
          `🤔 I don't have a recent list to match "${listPos}" against. Send *"tasks"* or *"my errands"* first, then reply with a number.`,
        );
        return NextResponse.json({ status: 'ok' });
      }

      const idx = listPos - 1;
      if (idx >= ids.length) {
        const label = lastList === 'errands' ? 'errand' : 'task';
        await sendTextMessage(
          from,
          `🤔 You only have ${ids.length} ${label}${ids.length === 1 ? '' : 's'} on the list — pick a number from 1 to ${ids.length}.`,
        );
        return NextResponse.json({ status: 'ok' });
      }

      if (lastList === 'errands') {
        await handleCompleteOtherTodoById(supabase, profile.id, from, ids[idx]);
      } else {
        await handleCompleteTaskById(supabase, profile.id, from, ids[idx]);
      }
      return NextResponse.json({ status: 'ok' });
    }

    // ── 2. Handle button replies directly (no AI cost) ──
    if (buttonReplyId) {
      await handleButtonReply(supabase, profile.id, from, buttonReplyId);
      return NextResponse.json({ status: 'ok' });
    }

    // ── 3. Rate limit check before calling AI ──
    // Backed by Upstash sliding-window — survives across Vercel instances and
    // can't be circumvented by spreading load over warm containers.
    if (!(await checkWhatsappRateLimit(profile.id))) {
      await sendTextMessage(
        from,
        '⏳ You\'ve sent a lot of messages this hour. Take a break and try again in a bit!\n\nTip: You can manage tasks directly in the EffortOS app too.',
      );
      return NextResponse.json({ status: 'ok' });
    }

    // ── 4. Quick-match common phrases without AI (saves tokens) ──
    const lowerText = text.trim().toLowerCase();
    let intent: WAIntent;

    // Carry all — moves incomplete tasks to tomorrow
    if (/^carry\s*(all|forward|over)$/i.test(lowerText)) {
      await handleCarryAllForward(supabase, profile.id, from);
      return NextResponse.json({ status: 'ok' });
    }

    // Pause coaching — "shh", "quiet", "pause", "stop coaching"
    if (/^(shh+|quiet|pause|mute|stop coaching|pause coaching)$/i.test(lowerText)) {
      intent = { type: 'pause_coaching' };
    }
    // Plan tomorrow
    else if (
      /^plan\s*tomorrow$/i.test(lowerText) ||
      /tomorrow.?s?\s*(plan|tasks)/i.test(lowerText)
    ) {
      intent = { type: 'plan_tomorrow' };
    }
    // Journal entry
    else if (
      /journal/i.test(lowerText) &&
      /(add|write|log|new|create|entry|today)/i.test(lowerText)
    ) {
      intent = { type: 'add_journal' };
    }
    // Time today — "how long today", "time today", "hours today"
    else if (
      /how (long|much).*today/i.test(lowerText) ||
      /^(time today|hours today|today.?s time|work today)$/i.test(lowerText)
    ) {
      intent = { type: 'time_today' };
    }
    // Delete task — "delete X", "remove X"
    else if (/^(delete|remove)\s+(.+)/i.test(lowerText)) {
      const match = lowerText.match(/^(?:delete|remove)\s+(.+)/i);
      intent = { type: 'delete_task', query: match?.[1]?.trim() || '' };
    }
    // Edit task pomodoros — "change X to 3 pomodoros"
    else if (/change\s+(.+?)\s+to\s+(\d+)\s*pom/i.test(lowerText)) {
      const match = lowerText.match(/change\s+(.+?)\s+to\s+(\d+)\s*pom/i);
      if (match) {
        intent = { type: 'edit_task', query: match[1].trim(), newPomodoros: parseInt(match[2], 10) };
      } else {
        intent = await parseWhatsAppMessage(text);
      }
    }
    // Rename task — "rename X to Y"
    else if (/rename\s+(.+?)\s+to\s+(.+)/i.test(lowerText)) {
      const match = lowerText.match(/rename\s+(.+?)\s+to\s+(.+)/i);
      if (match) {
        intent = { type: 'edit_task', query: match[1].trim(), newTitle: match[2].trim() };
      } else {
        intent = await parseWhatsAppMessage(text);
      }
    }
    // Help / greeting
    else if (/^(help|\/help|hi|hello|hey|\/start|menu|commands)$/i.test(lowerText)) {
      intent = { type: 'help' };
    }
    // ── Errand quick-matches (run BEFORE the task quick-matches so "my
    //    errands" doesn't get caught by the generic "list/plan" patterns).
    // List errands — "my errands", "side list", "errand list", etc.
    else if (
      /^(my errands|errands|errand list|side list|other todos|other to-?dos|show errands|list errands)$/i.test(lowerText) ||
      /what.?s on my (errand|side) list/i.test(lowerText) ||
      /^what errands/i.test(lowerText)
    ) {
      intent = { type: 'list_other_todos' };
    }
    // Add errand with explicit prefix — "add errand X", "errand: X", "errands: X"
    else if (/^(?:add\s+)?errands?\s*[:\-]?\s+(.+)/i.test(lowerText)) {
      const match = lowerText.match(/^(?:add\s+)?errands?\s*[:\-]?\s+(.+)/i);
      const raw = match?.[1]?.trim() || '';
      // Split on commas, " and ", semicolons, or newlines.
      const titles = raw
        .split(/\s*,\s*|\s+and\s+|\s*;\s*|\n+/i)
        .map(t => t.trim())
        .filter(t => t.length > 0);
      if (titles.length > 0) {
        intent = {
          type: 'add_other_todos',
          todos: titles.map(t => ({ title: t.slice(0, 200), estimated_minutes: null })),
        };
      } else {
        intent = await parseWhatsAppMessage(text);
      }
    }
    // "Remind me to X" — single errand. AI handles multi-errand parsing
    // with time estimates; this fast path is for the one-line common case.
    else if (/^remind me to\s+(.+)/i.test(lowerText)) {
      const match = lowerText.match(/^remind me to\s+(.+)/i);
      const title = match?.[1]?.trim() || '';
      if (title) {
        intent = {
          type: 'add_other_todos',
          todos: [{ title: title.slice(0, 200), estimated_minutes: null }],
        };
      } else {
        intent = await parseWhatsAppMessage(text);
      }
    }
    // List tasks — exact or contains keywords
    else if (
      /^(tasks|my tasks|list|plan|show tasks|today)$/i.test(lowerText) ||
      /what.?s (on my plate|my plan|my tasks|today)/i.test(lowerText) ||
      /show.*(tasks|plan)/i.test(lowerText) ||
      /^what am i doing today\??$/i.test(lowerText)
    ) {
      intent = { type: 'list_tasks' };
    }
    // Progress / stats
    else if (
      /^(progress|stats|streak|status)$/i.test(lowerText) ||
      /how am i doing/i.test(lowerText) ||
      /my (progress|stats|streak)/i.test(lowerText)
    ) {
      intent = { type: 'check_progress' };
    }
    // Complete task — "done with X", "finished X", "completed X"
    else if (/^(done|finished|completed|complete)\s*(with\s+)?(.+)/i.test(lowerText)) {
      const match = lowerText.match(/^(?:done|finished|completed|complete)\s*(?:with\s+)?(.+)/i);
      if (match) {
        intent = { type: 'complete_task', query: match[1].trim() };
      } else {
        intent = await parseWhatsAppMessage(text);
      }
    }
    else {
      // Fall through to AI parsing
      console.log('[WhatsApp] No quick-match, falling through to AI for:', lowerText.slice(0, 80));
      intent = await parseWhatsAppMessage(text);
    }

    // ── 4. Execute intent ──
    await executeIntent(supabase, profile, from, intent);

    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    // Always return 200 so Meta doesn't retry aggressively
    return NextResponse.json({ status: 'error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Intent handlers
// ────────────────────────────────────────────────────────────────────────────

interface UserProfile {
  id: string;
  name: string;
  phone_number: string;
  focus_duration: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

async function executeIntent(
  supabase: SupabaseClient,
  profile: UserProfile,
  phone: string,
  intent: WAIntent,
) {
  switch (intent.type) {
    case 'add_tasks':
      await handleAddTasks(supabase, profile.id, phone, intent.tasks);
      break;
    case 'list_tasks':
      await handleListTasks(supabase, profile.id, phone, profile.name);
      break;
    case 'complete_task':
      await handleCompleteTask(supabase, profile.id, phone, intent.query);
      break;
    case 'check_progress':
      await handleCheckProgress(supabase, profile.id, phone, profile.name);
      break;
    case 'pause_coaching':
      await handlePauseCoaching(supabase, profile.id, phone, profile.name);
      break;
    case 'plan_tomorrow':
      await handlePlanTomorrow(supabase, profile.id, phone, profile.name);
      break;
    case 'add_journal':
      await handleAddJournalPrompt(profile.id, phone, profile.name);
      break;
    case 'edit_task':
      await handleEditTask(supabase, profile.id, phone, intent.query, intent.newPomodoros, intent.newTitle);
      break;
    case 'delete_task':
      await handleDeleteTask(supabase, profile.id, phone, intent.query);
      break;
    case 'time_today':
      await handleTimeToday(supabase, profile.id, phone, profile.name);
      break;
    case 'add_other_todos':
      await handleAddOtherTodos(supabase, profile.id, phone, intent.todos);
      break;
    case 'list_other_todos':
      await handleListOtherTodos(supabase, profile.id, phone, profile.name);
      break;
    case 'complete_other_todo':
      await handleCompleteOtherTodo(supabase, profile.id, phone, intent.query);
      break;
    case 'delete_other_todo':
      await handleDeleteOtherTodo(supabase, profile.id, phone, intent.query);
      break;
    case 'help':
      await sendHelpMessage(phone, profile.name);
      break;
    case 'off_topic':
    case 'unknown':
    default: {
      // Check if we recently sent a weekly_reflection prompt — if so, save this as a journal entry
      const recentReflection = await supabase
        .from('coach_log')
        .select('id')
        .eq('user_id', profile.id)
        .eq('nudge_type', 'weekly_reflection')
        .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (recentReflection.data && recentReflection.data.length > 0 && intent.type !== 'off_topic') {
        // Looks like a reflection reply — save to journal
        const rawText = 'raw' in intent ? (intent as { raw: string }).raw : '';
        const journalText = rawText || '';
        if (journalText.length > 10) {
          await handleSaveJournalEntry(supabase, profile.id, phone, journalText);
          return;
        }
      }

      const helpText = intent.type === 'off_topic'
        ? `🎯 I'm your EffortOS task assistant — I only handle daily tasks, errands, and focus sessions.\n\nTry:\n• *Tasks:* "Study math 2 poms" / "tasks" / "done 1"\n• *Errands:* "remind me to grab groceries" / "my errands"\n• *Status:* "progress" / "time today"\n• *Help:* "help"`
        : `🤔 I'm not sure what you mean. Try:\n\n📝 *Tasks*\n• "Study math 2 poms and review notes"\n• "tasks" — see today's list\n• Reply with a number to mark done\n\n🗒 *Errands*\n• "remind me to grab groceries"\n• "my errands" — see side list\n\n📊 *Status*\n• "progress" / "time today"\n\nType *"help"* for the full menu.`;
      await sendTextMessage(phone, helpText);
      break;
    }
  }
}

async function handleAddTasks(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  tasks: Array<{ title: string; pomodoros: number; tag?: string }>,
) {
  // IMPORTANT: bucket tasks under the user's LOCAL date, not UTC. A task
  // added at 12:30 AM IST would otherwise land on yesterday's UTC date.
  const tz = await getUserTimezone(supabase, userId);
  const todayKey = todayKeyInTz(tz);

  // sort_order is INT — use seconds-of-day + index to avoid INT overflow
  const now = new Date();
  const baseSortOrder = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  const rows = tasks.map((t, i) => ({
    user_id: userId,
    title: t.title,
    pomodoros_target: t.pomodoros,
    pomodoros_done: 0,
    completed: false,
    date: todayKey,
    tag: ['startup', 'job', 'learning', 'personal', 'health', 'creative'].includes(t.tag || '') ? t.tag! : 'job',
    sort_order: baseSortOrder + i,
  }));

  console.log('[WhatsApp] Inserting tasks:', JSON.stringify(rows, null, 2));
  const { error, data } = await supabase.from('daily_tasks').insert(rows).select();

  if (error) {
    console.error('[WhatsApp] Failed to insert tasks:', JSON.stringify(error));
    await sendTextMessage(phone, '❌ Something went wrong adding your tasks. Try again?');
    return;
  }
  console.log('[WhatsApp] Insert success:', data?.length, 'tasks');

  const summary = tasks
    .map((t) => `  ✅ ${t.title} — ${t.pomodoros} pom${t.pomodoros > 1 ? 's' : ''}`)
    .join('\n');

  const totalPoms = tasks.reduce((s, t) => s + t.pomodoros, 0);

  await sendTextMessage(
    phone,
    `📝 Added ${tasks.length} task${tasks.length > 1 ? 's' : ''} for today:\n\n${summary}\n\n⏱ Total: ${totalPoms} pomodoros. Let's crush it! 💪`,
  );
}

async function handleListTasks(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  name: string,
) {
  const tz = await getUserTimezone(supabase, userId);
  const todayKey = todayKeyInTz(tz);

  const { data: tasks } = await supabase
    .from('daily_tasks')
    .select('id, title, pomodoros_target, pomodoros_done, completed, tag')
    .eq('user_id', userId)
    .eq('date', todayKey)
    .order('sort_order', { ascending: true });

  if (!tasks || tasks.length === 0) {
    await sendTextMessage(
      phone,
      `📋 No tasks for today yet, ${name}.\n\nSend me your tasks like:\n"Study React 2 pomodoros, review PRs, write docs for 3 pomodoros"`,
    );
    return;
  }

  // Number each task so users can reply with just a number to complete
  const lines = tasks.map((t: { id: string; title: string; pomodoros_done: number; pomodoros_target: number; completed: boolean }, i: number) => {
    const check = t.completed ? '✅' : `${i + 1}.`;
    const progress = `${t.pomodoros_done}/${t.pomodoros_target}`;
    return `${check} ${t.title} (${progress})`;
  });

  // Store task IDs so we can match a numbered reply (TTL handled by Redis).
  // Also remember that the most recent list shown to this phone was TASKS,
  // so a bare "3" resolves to task #3 (not errand #3 if both lists are
  // currently cached).
  const incompleteTasks = tasks.filter((t: { completed: boolean }) => !t.completed);
  if (incompleteTasks.length > 0) {
    await setTaskList(phone, tasks.map((t: { id: string }) => t.id));
    await setLastListType(phone, 'tasks');
  }

  const done = tasks.filter((t: { completed: boolean }) => t.completed).length;
  const totalDone = tasks.reduce((s: number, t: { pomodoros_done: number }) => s + t.pomodoros_done, 0);
  const totalTarget = tasks.reduce((s: number, t: { pomodoros_target: number }) => s + t.pomodoros_target, 0);

  await sendTextMessage(
    phone,
    `📋 *Today's Tasks* (${done}/${tasks.length} complete)\n\n${lines.join('\n')}\n\n⏱ ${totalDone}/${totalTarget} pomodoros done` +
    (incompleteTasks.length > 0 ? `\n\n💡 _Reply with a number to mark it done_` : ''),
  );
}

async function handleCompleteTask(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  query: string,
) {
  const tz = await getUserTimezone(supabase, userId);
  const todayKey = todayKeyInTz(tz);

  // Get today's incomplete tasks
  const { data: tasks } = await supabase
    .from('daily_tasks')
    .select('id, title, pomodoros_target, pomodoros_done')
    .eq('user_id', userId)
    .eq('date', todayKey)
    .eq('completed', false);

  if (!tasks || tasks.length === 0) {
    await sendTextMessage(phone, '🎉 All tasks are already complete! Great work!');
    return;
  }

  // Fuzzy match: normalize curly-quote / em-dash variants on both sides AND
  // strip any leading list number from the query — both keep mobile-keyboard
  // typography and "done with 6. Ale's letter" from killing the substring
  // check.
  const q = fuzzyTitleQuery(query);
  const match = tasks.find((t: { title: string }) =>
    normalizeForMatch(t.title).includes(q),
  );

  if (!match) {
    const taskList = tasks
      .map((t: { title: string }, i: number) => `${i + 1}. ${t.title}`)
      .join('\n');
    await sendTextMessage(
      phone,
      `🤔 Couldn't find a task matching "${query}".\n\nYour open tasks:\n${taskList}\n\nTry the number, or "Done with [task name]".`,
    );
    return;
  }

  // Mark complete — set pomodoros_done to target
  await supabase
    .from('daily_tasks')
    .update({
      completed: true,
      pomodoros_done: match.pomodoros_target,
    })
    .eq('id', match.id);

  await sendTextMessage(
    phone,
    `✅ *${match.title}* marked as complete! Nice work! 🔥`,
  );
}

async function handleCheckProgress(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  name: string,
) {
  const tz = await getUserTimezone(supabase, userId);
  const todayKey = todayKeyInTz(tz);

  // Today's tasks
  const { data: tasks } = await supabase
    .from('daily_tasks')
    .select('pomodoros_target, pomodoros_done, completed')
    .eq('user_id', userId)
    .eq('date', todayKey);

  const totalTasks = tasks?.length || 0;
  const doneTasks = tasks?.filter((t: { completed: boolean }) => t.completed).length || 0;
  const totalPomsDone = tasks?.reduce((s: number, t: { pomodoros_done: number }) => s + t.pomodoros_done, 0) || 0;
  const totalPomsTarget = tasks?.reduce((s: number, t: { pomodoros_target: number }) => s + t.pomodoros_target, 0) || 0;

  // Active goal
  const { data: goal } = await supabase
    .from('goals')
    .select('title, sessions_completed, estimated_sessions_current')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  // Streak: fetch distinct session dates (last 90 days) in one query,
  // then count consecutive days backwards from today.
  let streak = 0;
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const { data: recentSessions } = await supabase
    .from('sessions')
    .select('start_time')
    .eq('user_id', userId)
    .gte('start_time', ninetyDaysAgo.toISOString())
    .eq('status', 'completed');

  if (recentSessions && recentSessions.length > 0) {
    // Build a set of unique dates (YYYY-MM-DD) that have sessions, keyed in
    // the USER'S local timezone so a late-night 11:30 PM IST session on
    // April 16 doesn't count as April 16 UTC (= still April 16) but also a
    // 12:30 AM IST session on April 17 correctly falls on April 17, not 16.
    const sessionDates = new Set(
      recentSessions.map((s: { start_time: string }) =>
        dateKeyInTz(tz, new Date(s.start_time))
      )
    );

    // Walk backwards from today counting consecutive days, using the user's
    // local date boundaries rather than UTC midnight.
    const checkDate = new Date();
    for (let i = 0; i < 90; i++) {
      const dateStr = dateKeyInTz(tz, checkDate);
      if (sessionDates.has(dateStr)) {
        streak++;
      } else if (i > 0) {
        break; // Allow today to have 0 (streak counts from yesterday)
      }
      checkDate.setDate(checkDate.getDate() - 1);
    }
  }

  let msg = `📊 *Progress Update for ${name}*\n\n`;
  msg += `*Today*\n`;
  msg += `  Tasks: ${doneTasks}/${totalTasks} complete\n`;
  msg += `  Pomodoros: ${totalPomsDone}/${totalPomsTarget}\n`;
  msg += `  🔥 Streak: ${streak} day${streak !== 1 ? 's' : ''}\n`;

  if (goal) {
    const pct = goal.estimated_sessions_current > 0
      ? Math.round((goal.sessions_completed / goal.estimated_sessions_current) * 100)
      : 0;
    msg += `\n*Long-Term Goal*\n`;
    msg += `  📎 ${goal.title}\n`;
    msg += `  Progress: ${pct}% (${goal.sessions_completed}/${goal.estimated_sessions_current} sessions)\n`;
  }

  const motivators = [
    'Keep going! 🚀',
    'You\'re building something great! 💪',
    'Consistency is key — you\'ve got this! 🎯',
    'Every session counts! ⭐',
  ];
  msg += `\n${motivators[Math.floor(Math.random() * motivators.length)]}`;

  await sendTextMessage(phone, msg);
}

// ── Journal entry (multi-step flow) ──
// Step 1: User says "add journal entry" → we prompt and set pending state.
// Step 2: User sends the actual entry → handleSaveJournalEntry saves it.
async function handleAddJournalPrompt(userId: string, phone: string, name: string) {
  // Set pending flow so the NEXT message from this user is saved as a journal
  // entry. TTL is enforced server-side by Redis (10 min) — no manual sweep.
  await setPendingFlow(phone, { type: 'journal', userId });

  await sendTextMessage(
    phone,
    `📓 Ready to add your journal entry for today, ${name || 'friend'}.\n\nPlease send your journal entry now — I'll save it as-is. You have 10 minutes.`,
  );
}

async function handleSaveJournalEntry(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  journalText: string,
) {
  try {
    const tz = await getUserTimezone(supabase, userId);
    const todayKey = todayKeyInTz(tz);

    // Check if an entry already exists for today
    const { data: existing } = await supabase
      .from('journal_entries')
      .select('id, content')
      .eq('user_id', userId)
      .eq('date', todayKey)
      .maybeSingle();

    if (existing) {
      // Append to existing entry with a separator
      const updated = existing.content
        ? `${existing.content}\n\n---\n\n${journalText}`
        : journalText;

      const { error } = await supabase
        .from('journal_entries')
        .update({ content: updated })
        .eq('id', existing.id);

      if (error) throw error;

      await sendTextMessage(
        phone,
        `📓 Appended to today's journal entry. You now have ${updated.split('\n').length} lines total.`,
      );
    } else {
      // Create new entry
      const { error } = await supabase
        .from('journal_entries')
        .insert({
          user_id: userId,
          date: todayKey,
          content: journalText,
        });

      if (error) throw error;

      await sendTextMessage(
        phone,
        `📓 Journal entry saved for today. Keep reflecting — it adds up!`,
      );
    }
  } catch (err) {
    console.error('[WhatsApp] Journal save error:', err);
    await sendTextMessage(phone, '❌ Failed to save your journal entry. Please try again.');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Other To-Dos (errands) — quarantined from the daily Pomodoro flow.
// Stored in the `other_todos` table; never appear in morning/afternoon
// nudges, never start a Pomodoro. The nightly recap mentions only the
// COUNT of open errands. See migration 019_other_todos.sql + docstring on
// src/lib/other-todos.ts for the full design rationale.
// ────────────────────────────────────────────────────────────────────────────

function formatErrandMinutes(mins: number | null | undefined): string {
  if (mins == null) return '';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

async function handleAddOtherTodos(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  todos: Array<{ title: string; estimated_minutes?: number | null }>,
) {
  if (!todos || todos.length === 0) {
    await sendTextMessage(phone, '🤔 What errands should I add? Try: "remind me to grab groceries and call mom".');
    return;
  }

  // Allowlist + clamp the inputs the AI gives us. We never trust the AI
  // payload to be in-range — defensive validation here keeps the DB CHECK
  // constraint from rejecting the whole batch over one malformed row.
  const rows = todos.slice(0, 10).map((t) => {
    const title = (t.title || '').trim().slice(0, 200);
    let mins = t.estimated_minutes;
    if (typeof mins !== 'number' || !Number.isFinite(mins) || mins <= 0) {
      mins = null;
    } else {
      mins = Math.min(1440, Math.max(1, Math.round(mins)));
    }
    return { user_id: userId, title, estimated_minutes: mins };
  }).filter(r => r.title.length > 0);

  if (rows.length === 0) {
    await sendTextMessage(phone, '🤔 Couldn\'t parse any errands from that. Try: "remind me to grab groceries".');
    return;
  }

  const { error, data } = await supabase.from('other_todos').insert(rows).select('id, title, estimated_minutes');
  if (error) {
    console.error('[WhatsApp] Failed to insert other_todos:', JSON.stringify(error));
    await sendTextMessage(phone, '❌ Something went wrong saving that. Try again?');
    return;
  }

  const lines = (data as Array<{ title: string; estimated_minutes: number | null }> | null || rows).map((r) => {
    const time = formatErrandMinutes(r.estimated_minutes);
    return `  • ${r.title}${time ? ` — ${time}` : ''}`;
  }).join('\n');

  await sendTextMessage(
    phone,
    `🗒 Added to your side list:\n\n${lines}\n\n_These won't start a Pomodoro — say "my errands" to see the full list._`,
  );
}

async function handleListOtherTodos(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  name: string,
) {
  const { data: todos } = await supabase
    .from('other_todos')
    .select('id, title, estimated_minutes, completed')
    .eq('user_id', userId)
    .eq('completed', false)
    .order('sort_order', { ascending: false });

  if (!todos || todos.length === 0) {
    await sendTextMessage(
      phone,
      `🗒 Your side list is empty${name ? `, ${name}` : ''}.\n\nAdd errands like: "remind me to grab groceries" or "pick Susan up at 4pm — 30 min".`,
    );
    return;
  }

  const lines = (todos as Array<{ title: string; estimated_minutes: number | null }>).map((t, i) => {
    const time = formatErrandMinutes(t.estimated_minutes);
    return `${i + 1}. ${t.title}${time ? ` _(${time})_` : ''}`;
  }).join('\n');

  const totalMins = (todos as Array<{ estimated_minutes: number | null }>).reduce(
    (s, t) => s + (t.estimated_minutes || 0),
    0,
  );
  const totalLine = totalMins > 0
    ? `\n\n⏱ Estimated total: ${formatErrandMinutes(totalMins)}`
    : '';

  // Cache the displayed errand IDs + mark this phone's last list as
  // ERRANDS so a numbered reply ("3") resolves to errand #3 rather than
  // task #3. Same TTL as the task list cache.
  await setErrandList(phone, (todos as Array<{ id: string }>).map(t => t.id));
  await setLastListType(phone, 'errands');

  await sendTextMessage(
    phone,
    `🗒 *Your side list* (${todos.length} errand${todos.length === 1 ? '' : 's'})\n\n${lines}${totalLine}\n\n💡 _Reply with a number to mark one done, or say "got the groceries"._`,
  );
}

async function handleCompleteOtherTodo(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  query: string,
) {
  const q = fuzzyTitleQuery(query || '');
  if (!q) {
    await sendTextMessage(phone, '🤔 Which errand did you finish? Try: "got the groceries".');
    return;
  }

  const { data: todos } = await supabase
    .from('other_todos')
    .select('id, title')
    .eq('user_id', userId)
    .eq('completed', false);

  if (!todos || todos.length === 0) {
    await sendTextMessage(phone, '🎉 No open errands to complete — your side list is clear!');
    return;
  }

  const match = (todos as Array<{ id: string; title: string }>).find(t =>
    normalizeForMatch(t.title).includes(q),
  );

  if (!match) {
    const list = (todos as Array<{ title: string }>).map((t, i) => `${i + 1}. ${t.title}`).join('\n');
    await sendTextMessage(
      phone,
      `🤔 Couldn't find an errand matching "${query}".\n\nYour open errands:\n${list}\n\nTry the number, or be more specific.`,
    );
    return;
  }

  await supabase
    .from('other_todos')
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq('id', match.id);

  await sendTextMessage(phone, `✅ *${match.title}* — done. One less thing on the side list. 🙌`);
}

async function handleDeleteOtherTodo(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  query: string,
) {
  const q = (query || '').trim().toLowerCase();
  if (!q) {
    await sendTextMessage(phone, '🤔 Which errand should I drop? Try: "drop the dentist errand".');
    return;
  }

  const { data: todos } = await supabase
    .from('other_todos')
    .select('id, title')
    .eq('user_id', userId)
    .eq('completed', false);

  if (!todos || todos.length === 0) {
    await sendTextMessage(phone, '🗒 Your side list is already empty.');
    return;
  }

  const qNorm = fuzzyTitleQuery(q);
  const match = (todos as Array<{ id: string; title: string }>).find(t =>
    normalizeForMatch(t.title).includes(qNorm),
  );

  if (!match) {
    await sendTextMessage(phone, `🤔 Couldn't find an errand matching "${query}".`);
    return;
  }

  await supabase.from('other_todos').delete().eq('id', match.id);
  await sendTextMessage(phone, `🗑 Dropped *${match.title}* from your side list.`);
}

async function sendHelpMessage(phone: string, name: string) {
  await sendTextMessage(
    phone,
    `👋 Hey ${name}! Here's the cheat sheet.\n\n` +
    `━━━ 📝 *DAILY TASKS* (focused work) ━━━\n` +
    `*Add:* "Study React 2 poms, review PRs, write spec 3 poms"\n` +
    `*See:* "tasks" or "what's my plan"\n` +
    `*Done:* reply with the *number* (e.g. "1") — or "done React"\n` +
    `*Edit:* "change React to 3 poms"  •  "rename React to Vue"\n` +
    `*Delete:* "delete React"\n\n` +
    `━━━ 🗒 *ERRANDS* (side list, no timer) ━━━\n` +
    `*Add:* "remind me to grab groceries"  •  "errand: pick Susan up at 4 — 30 min"\n` +
    `*See:* "my errands" or "side list"\n` +
    `*Done:* reply with the *number* — or "got the groceries"\n` +
    `*Drop:* "drop the dentist errand"\n\n` +
    `━━━ 📊 *STATUS* ━━━\n` +
    `"progress" / "how am I doing"  •  "time today"  •  "streak"\n\n` +
    `━━━ 📅 *PLANNING* ━━━\n` +
    `"plan tomorrow"  •  "carry all" (move incomplete to tomorrow)\n` +
    `"add journal entry"\n\n` +
    `━━━ ⚙️ *OTHER* ━━━\n` +
    `🎤 Voice notes work — just send one, I'll transcribe.\n` +
    `🤫 "shh" pauses coaching nudges for 24h.\n\n` +
    `💡 *Tip:* whenever you see a numbered list, just reply with the number to mark it done.`,
  );
}

async function handlePauseCoaching(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  name: string,
) {
  // Pause coaching nudges for 24 hours
  const pauseUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('profiles')
    .update({ coaching_paused_until: pauseUntil })
    .eq('id', userId);

  if (error) {
    console.error('[WhatsApp] Failed to pause coaching:', error);
    await sendTextMessage(phone, '❌ Something went wrong. Try again?');
    return;
  }

  await sendTextMessage(
    phone,
    `🤫 Got it, ${name}. Coaching paused for 24 hours. I won't send any nudges until tomorrow.\n\nText me anytime to manage tasks — I'm still here for that!`,
  );
}

async function handlePlanTomorrow(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  name: string,
) {
  // Get today's stats for context
  const tz = await getUserTimezone(supabase, userId);
  const todayKey = todayKeyInTz(tz);

  const { data: tasks } = await supabase
    .from('daily_tasks')
    .select('title, completed, pomodoros_target, pomodoros_done')
    .eq('user_id', userId)
    .eq('date', todayKey);

  const totalTasks = tasks?.length || 0;
  const completedTasks = tasks?.filter((t: { completed: boolean }) => t.completed).length || 0;

  // Check if there are incomplete tasks that might carry over
  const incomplete = tasks
    ?.filter((t: { completed: boolean }) => !t.completed)
    ?.map((t: { title: string }) => t.title) || [];

  let msg = `📅 Let's plan tomorrow, ${name}!\n\n`;

  if (totalTasks > 0) {
    msg += `Today you finished ${completedTasks}/${totalTasks} tasks. `;
    if (incomplete.length > 0) {
      msg += `\n\nCarry over from today?\n${incomplete.map((t: string) => `  • ${t}`).join('\n')}\n\n`;
    } else {
      msg += 'Clean slate!\n\n';
    }
  }

  msg += `Just text me tomorrow's tasks like:\n"Review docs 2 pomodoros, team meeting prep, design mockups 3 poms"\n\nThey'll be saved for tomorrow automatically.`;

  // Set a flag so the next add_tasks message gets filed under tomorrow
  // We do this via a simple state flag in the coach_log
  await supabase.from('coach_log').insert({
    user_id: userId,
    nudge_type: 'plan_tomorrow',
    message_sent: msg,
    delivered: true,
    context_json: { planning_for: 'tomorrow', initiated_by: 'user' },
  });

  await sendTextMessage(phone, msg);
}

async function handleButtonReply(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  buttonId: string,
) {
  // Button IDs follow format: "action:data"
  if (buttonId.startsWith('complete:')) {
    const taskId = buttonId.replace('complete:', '');
    await supabase
      .from('daily_tasks')
      .update({ completed: true })
      .eq('id', taskId)
      .eq('user_id', userId);
    await sendTextMessage(phone, '✅ Task marked complete! 🔥');
  }
  // EOD carry-forward button
  if (buttonId === 'carry_all') {
    await handleCarryAllForward(supabase, userId, phone);
  }
}

// ── Voice note handler ──
async function handleVoiceNote(
  supabase: SupabaseClient,
  profile: UserProfile,
  phone: string,
  audioId: string,
) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    await sendTextMessage(phone, '🎤 Voice notes aren\'t enabled yet — please type your message instead.');
    return;
  }

  await sendTextMessage(phone, '🎤 Got your voice note — transcribing...');

  try {
    const audioBuffer = await downloadWhatsAppMedia(audioId);
    if (!audioBuffer) {
      await sendTextMessage(phone, '❌ Couldn\'t download the voice note. Try again?');
      return;
    }

    // Send to OpenAI Whisper API
    const formData = new FormData();
    const uint8 = new Uint8Array(audioBuffer);
    const blob = new Blob([uint8], { type: 'audio/ogg' });
    formData.append('file', blob, 'voice.ogg');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      console.error('[WhatsApp] Whisper API error:', await whisperRes.text());
      await sendTextMessage(phone, '❌ Couldn\'t transcribe the voice note. Try typing instead.');
      return;
    }

    const whisperData = await whisperRes.json() as { text?: string };
    const transcript = whisperData.text?.trim();
    if (!transcript) {
      await sendTextMessage(phone, '🤔 I couldn\'t make out any words. Try again or type it out.');
      return;
    }

    // Feed transcript through the normal AI parser
    const intent = await parseWhatsAppMessage(transcript);
    await executeIntent(supabase, profile, phone, intent);
  } catch (err) {
    console.error('[WhatsApp] Voice note processing error:', err);
    await sendTextMessage(phone, '❌ Something went wrong processing your voice note.');
  }
}

// ── Complete task by ID (for numbered replies) ──
async function handleCompleteTaskById(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  taskId: string,
) {
  const { data: task } = await supabase
    .from('daily_tasks')
    .select('title, completed')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (!task) {
    await sendTextMessage(phone, '❌ Task not found.');
    return;
  }
  if (task.completed) {
    await sendTextMessage(phone, `"${task.title}" is already done ✅`);
    return;
  }

  await supabase
    .from('daily_tasks')
    .update({ completed: true })
    .eq('id', taskId);

  await sendTextMessage(phone, `✅ "${task.title}" — done! Nice work 🔥`);
}

// ── Complete errand by ID (for numbered replies against the side list) ──
// Mirror of handleCompleteTaskById but writes to other_todos. Stamping
// completed_at matches the schema convention used by handleCompleteOtherTodo
// (the text/AI path) so analytics over completed errands stays consistent
// regardless of how the user marked it done.
async function handleCompleteOtherTodoById(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  todoId: string,
) {
  const { data: todo } = await supabase
    .from('other_todos')
    .select('title, completed')
    .eq('id', todoId)
    .eq('user_id', userId)
    .single();

  if (!todo) {
    await sendTextMessage(phone, '❌ Errand not found.');
    return;
  }
  if (todo.completed) {
    await sendTextMessage(phone, `"${todo.title}" is already done ✅`);
    return;
  }

  await supabase
    .from('other_todos')
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq('id', todoId);

  await sendTextMessage(phone, `✅ *${todo.title}* — done. One less thing on the side list. 🙌`);
}

// ── Edit task (change pomodoros or rename) ──
async function handleEditTask(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  query: string,
  newPomodoros?: number,
  newTitle?: string,
) {
  const tz = await getUserTimezone(supabase, userId);
  const todayKey = todayKeyInTz(tz);

  const { data: tasks } = await supabase
    .from('daily_tasks')
    .select('id, title, pomodoros_target')
    .eq('user_id', userId)
    .eq('date', todayKey)
    .eq('completed', false);

  if (!tasks || tasks.length === 0) {
    await sendTextMessage(phone, '📋 No tasks to edit today.');
    return;
  }

  // Fuzzy match — normalize quotes/dashes so curly-quote replies still match,
  // and strip any leading list number from the query.
  const q = fuzzyTitleQuery(query);
  const match = tasks.find((t: { title: string }) => normalizeForMatch(t.title).includes(q));
  if (!match) {
    await sendTextMessage(phone, `🤔 Couldn't find a task matching "${query}".`);
    return;
  }

  const updates: Record<string, unknown> = {};
  const changes: string[] = [];

  if (newPomodoros && newPomodoros > 0 && newPomodoros <= 10) {
    updates.pomodoros_target = newPomodoros;
    changes.push(`pomodoros → ${newPomodoros}`);
  }
  if (newTitle) {
    updates.title = newTitle.slice(0, 60);
    changes.push(`renamed to "${newTitle.slice(0, 60)}"`);
  }

  if (Object.keys(updates).length === 0) {
    await sendTextMessage(phone, '🤔 Not sure what to change. Try "change X to 3 pomodoros" or "rename X to Y".');
    return;
  }

  await supabase
    .from('daily_tasks')
    .update(updates)
    .eq('id', match.id);

  await sendTextMessage(phone, `✏️ "${match.title}" updated: ${changes.join(', ')}`);
}

// ── Delete task ──
async function handleDeleteTask(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  query: string,
) {
  const tz = await getUserTimezone(supabase, userId);
  const todayKey = todayKeyInTz(tz);

  const { data: tasks } = await supabase
    .from('daily_tasks')
    .select('id, title')
    .eq('user_id', userId)
    .eq('date', todayKey);

  if (!tasks || tasks.length === 0) {
    await sendTextMessage(phone, '📋 No tasks to delete.');
    return;
  }

  const q = fuzzyTitleQuery(query);
  const match = tasks.find((t: { title: string }) => normalizeForMatch(t.title).includes(q));
  if (!match) {
    await sendTextMessage(phone, `🤔 Couldn't find a task matching "${query}".`);
    return;
  }

  await supabase.from('daily_tasks').delete().eq('id', match.id);
  await sendTextMessage(phone, `🗑 "${match.title}" deleted.`);
}

// ── Time today — how much focused work ──
async function handleTimeToday(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  name: string,
) {
  const tz = await getUserTimezone(supabase, userId);
  const todayKey = todayKeyInTz(tz);

  const { data: sessions } = await supabase
    .from('sessions')
    .select('duration')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .gte('created_at', `${todayKey}T00:00:00`)
    .lte('created_at', `${todayKey}T23:59:59`);

  const sessionCount = sessions?.length ?? 0;
  const totalSec = (sessions ?? []).reduce((s: number, r: { duration: number }) => s + (r.duration || 0), 0);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.round((totalSec % 3600) / 60);

  const { data: tasks } = await supabase
    .from('daily_tasks')
    .select('pomodoros_target, pomodoros_done')
    .eq('user_id', userId)
    .eq('date', todayKey);

  const totalPomsTarget = (tasks ?? []).reduce((s: number, t: { pomodoros_target: number }) => s + t.pomodoros_target, 0);
  const totalPomsDone = (tasks ?? []).reduce((s: number, t: { pomodoros_done: number }) => s + t.pomodoros_done, 0);
  const pomsRemaining = Math.max(0, totalPomsTarget - totalPomsDone);

  const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  await sendTextMessage(
    phone,
    `⏱ *Today's Focus Time*\n\n` +
    `Sessions: ${sessionCount}\n` +
    `Total: ${timeStr}\n` +
    `Pomodoros: ${totalPomsDone}/${totalPomsTarget}` +
    (pomsRemaining > 0 ? ` (${pomsRemaining} remaining)` : ' — all done! 🎉'),
  );
}

// ── Carry all incomplete tasks forward (EOD button handler) ──
async function handleCarryAllForward(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
) {
  const tz = await getUserTimezone(supabase, userId);
  const todayKey = todayKeyInTz(tz);

  // Get tomorrow's date key
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = dateKeyInTz(tz, tomorrow);

  const { data: incomplete } = await supabase
    .from('daily_tasks')
    .select('title, pomodoros_target, tag')
    .eq('user_id', userId)
    .eq('date', todayKey)
    .eq('completed', false);

  if (!incomplete || incomplete.length === 0) {
    await sendTextMessage(phone, '✅ Nothing to carry forward — all done!');
    return;
  }

  const now = new Date();
  const baseSortOrder = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  const rows = incomplete.map((t: { title: string; pomodoros_target: number; tag: string }, i: number) => ({
    user_id: userId,
    title: t.title,
    pomodoros_target: t.pomodoros_target,
    pomodoros_done: 0,
    completed: false,
    date: tomorrowKey,
    tag: t.tag || 'job',
    sort_order: baseSortOrder + i,
    scheduled_from: todayKey,
  }));

  await supabase.from('daily_tasks').insert(rows);
  await sendTextMessage(
    phone,
    `📅 Carried ${incomplete.length} task${incomplete.length !== 1 ? 's' : ''} to tomorrow. Fresh start incoming!`,
  );
}
