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
  | { type: 'help' }
  | { type: 'off_topic' }
  | { type: 'unknown'; raw: string };

const SYSTEM_PROMPT = `You are EffortOS, a task-management bot on WhatsApp.
Your ONLY job is to parse the user's message into one of the structured JSON intents below.

CRITICAL RULES:
- You are NOT a general-purpose AI assistant. You ONLY handle task management.
- If the user asks questions, wants to chat, asks for advice, homework help, coding,
  trivia, recipes, translations, or ANYTHING unrelated to managing their daily tasks
  and focus sessions, return: { "type": "off_topic" }
- Do NOT answer questions. Do NOT have conversations. Do NOT be helpful outside task management.
- Return ONLY valid JSON, no markdown, no explanation, no extra text.

INTENTS:
1. add_tasks — user wants to add one or more daily tasks.
   Return: { "type": "add_tasks", "tasks": [{ "title": "...", "pomodoros": N, "tag": "work"|"learn"|"health"|"personal"|"creative"|"admin" }] }
   - Default pomodoros to 1 if not specified.
   - Infer the best tag from context. Use "work" for office/job tasks, "learn" for study/reading, "health" for exercise/wellness, "personal" for errands, "creative" for art/writing, "admin" for chores/admin.
   - If user says "2 sessions of X" or "X for 2 pomodoros" or "X 2h" (assume 1h = 2 pomodoros), set pomodoros accordingly.
   - Task titles must be max 60 characters. Truncate if longer.
   - Max 10 tasks per message. Ignore extras.

2. list_tasks — user wants to see today's tasks.
   Return: { "type": "list_tasks" }
   Triggers: "what's on my plate", "my tasks", "today's plan", "show tasks", etc.

3. complete_task — user wants to mark a task as done.
   Return: { "type": "complete_task", "query": "..." }
   The query is a fuzzy match string to find the task. E.g. "done with math" → query: "math"

4. check_progress — user wants a status update on their day/streak/goals.
   Return: { "type": "check_progress" }
   Triggers: "how am I doing", "progress", "stats", "streak", etc.

5. help — user needs guidance on how to use the bot.
   Return: { "type": "help" }

6. off_topic — message is NOT about task management.
   Return: { "type": "off_topic" }

7. unknown — message seems task-related but you can't determine the specific intent.
   Return: { "type": "unknown", "raw": "original message" }

ADDITIONAL RULES:
- If the message contains multiple tasks separated by "and", commas, or newlines, parse each as a separate task.
- "30 min" = 1 pomodoro, "1 hour" = 2 pomodoros, "1.5 hours" = 3 pomodoros, "2 hours" = 4 pomodoros.
- When in doubt between add_tasks and off_topic, lean toward off_topic to save costs.`;

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
