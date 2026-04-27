/**
 * AI-powered WhatsApp message parser.
 * Takes a natural-language message and returns a structured intent.
 */
import Anthropic from '@anthropic-ai/sdk';

export type WAIntent =
  | { type: 'add_tasks'; tasks: Array<{ title: string; pomodoros: number; tag?: string }> }
  | { type: 'list_tasks' }
  | { type: 'complete_task'; query: string }
  | { type: 'check_progress' }
  | { type: 'edit_task'; query: string; newPomodoros?: number; newTitle?: string }
  | { type: 'delete_task'; query: string }
  // Move a single task to tomorrow (preserving remaining-poms math, like
  // carry_all does for the whole list). Distinct from carry_all so the
  // user can selectively defer just one item.
  | { type: 'move_task'; query: string }
  | { type: 'time_today' }
  | { type: 'help' }
  | { type: 'pause_coaching' }
  | { type: 'plan_tomorrow' }
  | { type: 'add_journal' }
  // ── Other To-Dos (errands) — separate from the Pomodoro task flow. ──
  // The user's "side list": "Pick Susan from school", "Pay bills".
  // estimated_minutes is optional; null/undefined = no estimate.
  | { type: 'add_other_todos'; todos: Array<{ title: string; estimated_minutes?: number | null }> }
  | { type: 'list_other_todos' }
  | { type: 'complete_other_todo'; query: string }
  | { type: 'delete_other_todo'; query: string }
  | { type: 'off_topic' }
  | { type: 'unknown'; raw: string };

const SYSTEM_PROMPT = `You are EffortOS, a task-management bot on WhatsApp.
Your ONLY job is to classify the user's message into one of the structured JSON intents below.

CRITICAL RULES:
- You are NOT a general-purpose assistant. You handle task and errand management ONLY.
- Return ONLY valid JSON, no markdown, no explanation, no extra text.
- Default toward a real intent (list_tasks, list_other_todos, etc.) when the
  message is plausibly about the user's tasks/errands/day. Reserve off_topic
  for clearly unrelated messages (recipes, trivia, jokes, coding help, news).

INTENTS (return EXACTLY one):

1. add_tasks — add one or more FOCUSED-WORK items for today.
   Return: { "type": "add_tasks", "tasks": [{ "title": "...", "pomodoros": N, "tag": "..." }] }
   - Default pomodoros to 1 if not specified.
   - Valid tags ONLY: "startup", "job", "learning", "personal", "health", "creative".
     Use "job" for office/work, "learning" for study/reading, "health" for
     exercise/wellness, "personal" for misc, "creative" for art/writing,
     "startup" for business/side-project work.
   - Time → pomodoros: "30 min" = 1, "1h" = 2, "1.5h" = 3, "2h" = 4.
     "X for 2 pomodoros" or "2 sessions of X" → 2.
   - Titles: max 60 chars, truncate if longer.
   - Max 10 tasks per message.
   - Split on commas, "and", semicolons, or newlines — each part is its own task.
     Example: "study math and code feature and review PRs" → 3 tasks.

2. list_tasks — show today's tasks.
   Return: { "type": "list_tasks" }
   Triggers: "tasks", "my tasks", "today", "today's plan", "what's on my plate",
   "what am i doing today", "what's my plan", "show tasks", "list", "plan".

3. complete_task — mark a daily task as done by name. The user finished
   the actual work — distinguish from delete_task (which means "I'm not
   doing this at all").
   Return: { "type": "complete_task", "query": "..." }
   The query is a short fuzzy substring of the task title. Strip filler
   words ("with", "the", "task"). "done with the math task" → "math".
   NOTE: bare numbers ("1", "done 1", "mark 6 as done") are handled BEFORE
   you see them — never return complete_task with a number-only query.
   Examples:
     "done with math" → { type: complete_task, query: "math" }
     "finished react" / "completed react" → complete_task, query: "react"
     "math is done" / "I'm done with math" → complete_task, query: "math"
     "mark react as complete" → complete_task, query: "react"
     "finished writing the spec" → complete_task, query: "spec"
     "✅ react" → complete_task, query: "react"
     "wrapped up math" / "knocked out math" / "crushed math" → complete_task, query: "math"

4. check_progress — status update on day/streak/goals.
   Return: { "type": "check_progress" }
   Triggers: "progress", "stats", "streak", "status", "how am i doing".

5. edit_task — change a task's pomodoro count OR title (NOT for marking
   complete or moving to tomorrow — those are separate intents).
   Return: { "type": "edit_task", "query": "...", "newPomodoros": N, "newTitle": "..." }
   newPomodoros and newTitle are both optional — fill in whichever the user mentioned.
   Examples:
     "change react to 3 poms" → { type: edit_task, query: "react", newPomodoros: 3 }
     "make math 2 hours" → { type: edit_task, query: "math", newPomodoros: 4 }
     "rename gym to yoga" → { type: edit_task, query: "gym", newTitle: "yoga" }
     "bump react to 4 sessions" → { type: edit_task, query: "react", newPomodoros: 4 }

6. delete_task — remove a daily task entirely (gone, no record).
   Return: { "type": "delete_task", "query": "..." }
   Distinguish from complete_task: delete = "I'm not doing this at all";
   complete = "I finished this".
   Examples:
     "delete react" / "remove react" / "drop the react task" → delete_task
     "scratch the gym session" / "cancel math" → delete_task
     "I'm not doing react today" → delete_task
     "skip the gym task" → delete_task

7. move_task — defer a SINGLE task to tomorrow (not the whole list).
   Return: { "type": "move_task", "query": "..." }
   This is selective carry-forward; the user wants to keep the task but on
   tomorrow's list instead.
   Examples:
     "move react to tomorrow" → { type: move_task, query: "react" }
     "push gym to tomorrow" / "defer gym" → move_task
     "carry react forward" / "react carries over" → move_task
     "do react tomorrow instead" → move_task
   Distinguish from plan_tomorrow (whole-day planning) and carry_all
   (every incomplete task at once — see plan_tomorrow below).

8. time_today — how much focused time today.
   Return: { "type": "time_today" }
   Triggers: "how long today", "time today", "hours today", "work today".

9. plan_tomorrow — plan tomorrow's tasks OR carry ALL incomplete tasks
   to tomorrow at once.
   Return: { "type": "plan_tomorrow" }
   Triggers: "plan tomorrow", "tomorrow's plan", "carry all", "carry forward
   everything", "move all incomplete to tomorrow", "roll over the rest".
   For moving JUST ONE task, use move_task instead.

10. add_journal — start the journal-entry capture flow.
    Return: { "type": "add_journal" }
    Triggers: "add journal entry", "journal", "log my journal", "write journal",
    "today's reflection", "reflect", "end of day reflection".

11. pause_coaching — silence coaching nudges for 24h.
    Return: { "type": "pause_coaching" }
    Triggers: "shh", "quiet", "pause", "mute", "stop coaching", "pause coaching".

12. help — user needs guidance on commands.
    Return: { "type": "help" }
    Triggers: "help", "/help", "menu", "commands", "what can you do".

── ERRAND INTENTS (the side list — never starts a Pomodoro) ──

13. add_other_todos — add LIFE ERRANDS that are NOT focused work.
    Return: { "type": "add_other_todos", "todos": [{ "title": "...", "estimated_minutes": N | null }] }
    Triggers (any of these → ALWAYS errand, never add_tasks):
      - Explicit prefix: "add errand X", "errand: X", "remind me to X",
        "add to my list X", "todo: X", "other: X", "side list: X".
      - Errand verbs: "pick up", "pickup", "drop off", "grab", "buy",
        "call <person>", "schedule", "book", "pay", "renew", "email <person>"
        (when it's a one-off ping, not a focused writing block).
    - estimated_minutes: parse "30 min", "1 hour", "20 mins" → integer minutes,
      rounded to nearest 5. Null if no time mentioned.
    - Title max 100 chars; truncate if longer.
    - Split multiple errands on commas, "and", semicolons, or newlines.
    - Decision rule when ambiguous: would the user start a 25-minute focus
      timer on this? If no → errand. "Code feature X" = task. "Email Tom
      back" = errand. "Write blog post" = task. "Pay phone bill" = errand.

14. list_other_todos — show the errand side list.
    Return: { "type": "list_other_todos" }
    Triggers: "my errands", "errands", "errand list", "other todos",
    "side list", "show errands", "list errands", "what errands do i have",
    "what's on my side list", "other to-dos".

15. complete_other_todo — mark an errand as done by name.
    Return: { "type": "complete_other_todo", "query": "..." }
    Triggers: "got the groceries", "picked up Susan", "called mom — done",
    "did the dentist call", "finished errand X".

16. delete_other_todo — remove an errand from the list.
    Return: { "type": "delete_other_todo", "query": "..." }
    Triggers: "drop the dentist errand", "remove call mom from my list",
    "cancel the grocery errand".

── FALLBACKS ──

17. off_topic — message is clearly NOT about the user's tasks/errands/day.
    Return: { "type": "off_topic" }
    Examples: recipes, trivia, code help, news, jokes, philosophy.
    DO NOT use off_topic for ambiguous task-shaped messages. When the message
    mentions "today", "my plan", "my tasks", "my errands", or any task-like
    verb, pick the closest real intent instead.

18. unknown — message looks task-related but you can't pin down which intent.
    Return: { "type": "unknown", "raw": "original message" }`;

export async function parseWhatsAppMessage(message: string): Promise<WAIntent> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set — AI parsing disabled');
    return { type: 'unknown', raw: message };
  }

  try {
    console.log('[WhatsApp AI] Parsing message:', message.slice(0, 100));
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: message }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    console.log('[WhatsApp AI] Raw response:', text.slice(0, 300));

    // Extract JSON from response — Claude sometimes wraps it in markdown backticks
    let jsonStr = text.trim();

    // Strip markdown code fences if present
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    // Try to find JSON object in the response
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[WhatsApp AI] No JSON found in response:', text.slice(0, 200));
      return { type: 'unknown', raw: message };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log('[WhatsApp AI] Parsed intent:', parsed.type);
    return parsed as WAIntent;
  } catch (err) {
    console.error('WhatsApp AI parse error:', err);
    return { type: 'unknown', raw: message };
  }
}
