/**
 * WhatsApp conversational memory.
 *
 * Backed by the wa_conversation_context table (migration 032). Read +
 * write helpers used by the webhook to inject the last few turns into
 * the AI parser's system prompt — this is what stops the bot being
 * amnesic between messages.
 *
 * Design notes:
 *   - All writes go through the service-role client because the
 *     wa_conversation_context table has no INSERT policy by design
 *     (matches coach_log).
 *   - The hot read is "last 6 messages, newest first" — backed by the
 *     composite index in mig 032. We return them in chronological order
 *     (oldest first) so the prompt formatter can render them top-down.
 *   - We never read or write inside hot paths without try/catch —
 *     conversation memory is best-effort. A Supabase blip should
 *     degrade the bot to "amnesic" gracefully, not 500 the webhook.
 */

import { createServiceClient } from '@/lib/supabase/service';

export type ConversationRole = 'user' | 'bot';

export interface ConversationMessage {
  role: ConversationRole;
  content: string;
  intent_type?: string | null;
  created_at: string;
}

/**
 * Default size of the rolling window we inject into the parser. ~3
 * conversational turns (3 user + 3 bot). Bigger windows blow up Anthropic
 * token spend on every parse without commensurate accuracy wins; smaller
 * windows lose the "follow-up reference" use case ("yes, the second one").
 */
export const DEFAULT_CONTEXT_WINDOW = 6;

/**
 * Maximum content length we persist. WhatsApp's outbound text limit is
 * 4096; inbound can exceed but the parser already caps at 1500 before
 * the AI sees it, so storing more would waste row size.
 */
const MAX_CONTENT_CHARS = 1500;

/**
 * Append a message to the user's rolling conversation window.
 *
 * Best-effort: errors are logged and swallowed. The webhook never depends
 * on this succeeding to send the next message. If the table or column is
 * missing (e.g., before migration 032 has been applied), every call is a
 * silent no-op rather than a 500.
 */
export async function appendConversationMessage(
  userId: string,
  role: ConversationRole,
  content: string,
  intentType?: string | null,
): Promise<void> {
  if (!userId || !content) return;

  const truncated = content.length > MAX_CONTENT_CHARS
    ? content.slice(0, MAX_CONTENT_CHARS)
    : content;

  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from('wa_conversation_context')
      .insert({
        user_id: userId,
        role,
        content: truncated,
        intent_type: intentType ?? null,
      });
    if (error) {
      // 42P01 = relation does not exist (mig 032 not applied yet).
      // 42703 = column does not exist (partial schema).
      // Both are deployment-state issues; log once per process to surface
      // the misconfig but don't kill the webhook.
      if (error.code === '42P01' || error.code === '42703') {
        warnSchemaMissingOnce(error.message);
        return;
      }
      console.warn('[wa-conversation] append failed:', error);
    }
  } catch (err) {
    console.warn('[wa-conversation] append threw:', err);
  }
}

/**
 * Read the last N messages for this user, ordered chronologically (oldest
 * first) so the prompt formatter renders them top-down.
 *
 * Returns an empty array if the user has no history yet, if the table
 * isn't migrated, or on any DB error. Callers should treat an empty
 * array as "no conversational context" — never as a failure signal.
 */
export async function getRecentConversation(
  userId: string,
  limit: number = DEFAULT_CONTEXT_WINDOW,
): Promise<ConversationMessage[]> {
  if (!userId) return [];

  // Cap the window so a misbehaving caller can't pull thousands of rows
  // into the prompt. 20 ≈ 10 turns; well past the point where extra
  // context helps the parser.
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)));

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('wa_conversation_context')
      .select('role, content, intent_type, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(safeLimit);

    if (error) {
      if (error.code === '42P01' || error.code === '42703') {
        warnSchemaMissingOnce(error.message);
        return [];
      }
      console.warn('[wa-conversation] read failed:', error);
      return [];
    }

    // Reverse to chronological for prompt rendering.
    const rows = (data ?? []) as ConversationMessage[];
    return rows.slice().reverse();
  } catch (err) {
    console.warn('[wa-conversation] read threw:', err);
    return [];
  }
}

/**
 * Render conversation history as a compact prompt-injection block.
 *
 * Format mirrors the existing <USER_MESSAGE> tagging convention so the
 * model treats the history as data, not instructions. Each turn is one
 * line with its role prefix; we don't include the parser's intent
 * classification because:
 *   - it's noise to the model when classifying the *current* message
 *   - it could confuse the model into echoing past intents instead
 *     of classifying afresh.
 *
 * Returns an empty string when there's nothing to inject so callers can
 * safely concatenate without conditional checks.
 */
export function formatConversationForPrompt(
  messages: ConversationMessage[],
): string {
  if (!messages || messages.length === 0) return '';

  const lines = messages.map((m) => {
    // Compress whitespace and clip individual lines so a chatty bot
    // reply doesn't dominate the prompt.
    const compact = m.content
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400);
    const tag = m.role === 'user' ? 'USER' : 'BOT';
    return `${tag}: ${compact}`;
  });

  return [
    '<RECENT_CONVERSATION>',
    'These are the last few turns between the user and you, oldest to newest.',
    'Use them ONLY to disambiguate references in the current message ("the second one", "yes do that"). Do not classify based on past turns — classify the CURRENT user message.',
    ...lines,
    '</RECENT_CONVERSATION>',
  ].join('\n');
}

let _warnedSchemaMissing = false;
function warnSchemaMissingOnce(detail: string) {
  if (_warnedSchemaMissing) return;
  _warnedSchemaMissing = true;
  console.error(
    '[wa-conversation] wa_conversation_context table or column missing — apply migration 032 via the Supabase dashboard SQL editor. Conversation memory is disabled until then. Detail:',
    detail,
  );
}
