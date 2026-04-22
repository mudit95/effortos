/**
 * Sends the Pro tier welcome message when a user upgrades.
 * Called from the subscription verify endpoint after successful Pro upgrade.
 */
import { createServiceClient } from '@/lib/supabase/service';
import { sendTextMessage } from '@/lib/whatsapp';
import { generateCoachMessage } from '@/lib/coach-ai';
import type { UserContext } from '@/lib/coach-engine';
import { todayKeyInTz } from '@/lib/user-date';

export async function sendProWelcome(userId: string): Promise<void> {
  const supabase = createServiceClient();

  // Get user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, phone_number, timezone, whatsapp_linked')
    .eq('id', userId)
    .single();

  if (!profile || !profile.whatsapp_linked || !profile.phone_number) {
    console.log('[Coach Welcome] User not eligible for welcome (no WhatsApp linked):', userId);
    return;
  }

  const tz = profile.timezone || 'Asia/Kolkata';
  const todayKey = todayKeyInTz(tz);

  // Check if already sent welcome
  const { count } = await supabase
    .from('coach_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('nudge_type', 'welcome');

  if ((count ?? 0) > 0) {
    console.log('[Coach Welcome] Already sent welcome to:', userId);
    return;
  }

  // Build minimal context for the welcome message
  const ctx: UserContext = {
    userId: profile.id,
    name: profile.name || 'there',
    phone: profile.phone_number,
    timezone: tz,
    localHour: 12,
    localDayOfWeek: new Date().getDay(),
    intensity: 'balanced',
    totalTasks: 0,
    completedTasks: 0,
    totalPomsDone: 0,
    totalPomsTarget: 0,
    taskTitles: [],
    incompleteTasks: [],
    currentStreak: 0,
    hadSessionToday: false,
    hoursSinceLastSession: 0,
    consecutiveInactiveDays: 0,
  };

  const message = await generateCoachMessage('welcome', ctx);
  const phone = profile.phone_number.replace(/^\+/, '');
  const delivered = await sendTextMessage(phone, message);

  // Log
  await supabase.from('coach_log').insert({
    user_id: userId,
    nudge_type: 'welcome',
    message_sent: message,
    delivered,
    context_json: { event: 'pro_upgrade' },
  });

  console.log(`[Coach Welcome] Sent to ${profile.name} (${delivered ? 'ok' : 'failed'})`);
}
