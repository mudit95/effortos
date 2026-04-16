import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { extractIncomingMessage, sendTextMessage } from '@/lib/whatsapp';
import { parseWhatsAppMessage, type WAIntent } from '@/lib/whatsapp-ai';

// ── Webhook signature verification ──
// Meta signs every webhook POST with X-Hub-Signature-256 using your app secret.
// Verifying this prevents spoofed requests from third parties.
function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    // If secret isn't configured, skip verification (dev mode)
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

// ── Simple in-memory rate limiter ──
// Max 20 AI-parsed messages per user per hour.
// This prevents users from treating the bot as a free ChatGPT.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

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

    const { from, text, buttonReplyId } = msg;

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

    // ── 2. Handle button replies directly (no AI cost) ──
    if (buttonReplyId) {
      await handleButtonReply(supabase, profile.id, from, buttonReplyId);
      return NextResponse.json({ status: 'ok' });
    }

    // ── 3. Rate limit check before calling AI ──
    if (!checkRateLimit(profile.id)) {
      await sendTextMessage(
        from,
        '⏳ You\'ve sent a lot of messages this hour. Take a break and try again in a bit!\n\nTip: You can manage tasks directly in the EffortOS app too.',
      );
      return NextResponse.json({ status: 'ok' });
    }

    // ── 4. Quick-match common phrases without AI (saves tokens) ──
    const lowerText = text.trim().toLowerCase();
    let intent: WAIntent;

    // Help / greeting
    if (/^(help|\/help|hi|hello|hey|\/start|menu|commands)$/i.test(lowerText)) {
      intent = { type: 'help' };
    }
    // List tasks — exact or contains keywords
    else if (
      /^(tasks|my tasks|list|plan|show tasks|today)$/i.test(lowerText) ||
      /what.?s (on my plate|my plan|my tasks|today)/i.test(lowerText) ||
      /show.*(tasks|plan)/i.test(lowerText)
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
    case 'help':
      await sendHelpMessage(phone, profile.name);
      break;
    case 'off_topic':
      await sendTextMessage(
        phone,
        `🎯 I'm your EffortOS task assistant — I only handle daily tasks and focus sessions.\n\nTry:\n• *Add tasks*: "Study math 2 pomodoros"\n• *My tasks*: "What's my plan?"\n• *Done*: "Finished with math"\n• *Progress*: "How am I doing?"`,
      );
      break;
    case 'unknown':
    default:
      await sendTextMessage(
        phone,
        `🤔 I'm not sure what you mean. Try:\n\n• *Add tasks*: "Study math 2 pomodoros and review notes"\n• *My tasks*: "What's on my plate?"\n• *Complete*: "Done with math"\n• *Progress*: "How am I doing?"\n• *Help*: "Help"`,
      );
  }
}

async function handleAddTasks(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  tasks: Array<{ title: string; pomodoros: number; tag?: string }>,
) {
  const todayKey = new Date().toISOString().split('T')[0];

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
  const todayKey = new Date().toISOString().split('T')[0];

  const { data: tasks } = await supabase
    .from('daily_tasks')
    .select('title, pomodoros_target, pomodoros_done, completed, tag')
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

  const lines = tasks.map((t: { title: string; pomodoros_done: number; pomodoros_target: number; completed: boolean }) => {
    const check = t.completed ? '✅' : '⬜';
    const progress = `${t.pomodoros_done}/${t.pomodoros_target}`;
    return `${check} ${t.title} (${progress})`;
  });

  const done = tasks.filter((t: { completed: boolean }) => t.completed).length;
  const totalDone = tasks.reduce((s: number, t: { pomodoros_done: number }) => s + t.pomodoros_done, 0);
  const totalTarget = tasks.reduce((s: number, t: { pomodoros_target: number }) => s + t.pomodoros_target, 0);

  await sendTextMessage(
    phone,
    `📋 *Today's Tasks* (${done}/${tasks.length} complete)\n\n${lines.join('\n')}\n\n⏱ ${totalDone}/${totalTarget} pomodoros done`,
  );
}

async function handleCompleteTask(
  supabase: SupabaseClient,
  userId: string,
  phone: string,
  query: string,
) {
  const todayKey = new Date().toISOString().split('T')[0];

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

  // Fuzzy match: find task whose title contains the query (case-insensitive)
  const q = query.toLowerCase();
  const match = tasks.find((t: { title: string }) =>
    t.title.toLowerCase().includes(q),
  );

  if (!match) {
    const taskList = tasks
      .map((t: { title: string }, i: number) => `${i + 1}. ${t.title}`)
      .join('\n');
    await sendTextMessage(
      phone,
      `🤔 Couldn't find a task matching "${query}".\n\nYour open tasks:\n${taskList}\n\nTry: "Done with [task name]"`,
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
  const todayKey = new Date().toISOString().split('T')[0];

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

  // Streak (count consecutive days with at least 1 session)
  let streak = 0;
  const checkDate = new Date();
  for (let i = 0; i < 365; i++) {
    const dateStr = checkDate.toISOString().split('T')[0];
    const { count } = await supabase
      .from('daily_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('date', dateStr);
    if ((count || 0) > 0) {
      streak++;
    } else if (i > 0) {
      break; // Allow today to have 0 (streak counts from yesterday)
    }
    checkDate.setDate(checkDate.getDate() - 1);
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

async function sendHelpMessage(phone: string, name: string) {
  await sendTextMessage(
    phone,
    `👋 Hey ${name}! Here's what I can do:\n\n` +
    `📝 *Add tasks*\n"Study React for 2 pomodoros and review PRs"\n"Write blog post, design mockups 3 poms"\n\n` +
    `📋 *See today's tasks*\n"What's my plan?" or "Show tasks"\n\n` +
    `✅ *Complete a task*\n"Done with React" or "Finished the blog post"\n\n` +
    `📊 *Check progress*\n"How am I doing?" or "Stats"\n\n` +
    `Just type naturally — I'll figure it out! 🧠`,
  );
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
}
