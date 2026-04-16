'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { X, Bell, Volume2, Clock, Palette, Check, CreditCard, AlertTriangle, Mail, Globe, MessageCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import * as storage from '@/lib/storage';
import { DISPLAY_PRICE_PER_MONTH } from '@/lib/pricing';

const THEMES = [
  {
    id: 'dark',
    name: 'Dark',
    bg: '#0B0F14',
    accent: '#22d3ee',
    card: 'rgba(255,255,255,0.03)',
    preview: 'from-[#0B0F14] to-[#131820]',
  },
  {
    id: 'neon',
    name: 'Neon',
    bg: '#0a0015',
    accent: '#c026d3',
    card: 'rgba(192,38,211,0.05)',
    preview: 'from-[#0a0015] to-[#1a0030]',
  },
  {
    id: 'light',
    name: 'Light',
    bg: '#f8fafc',
    accent: '#0891b2',
    card: 'rgba(0,0,0,0.03)',
    preview: 'from-[#f8fafc] to-[#e2e8f0]',
  },
  {
    id: 'night',
    name: 'Night',
    bg: '#0c1222',
    accent: '#6366f1',
    card: 'rgba(99,102,241,0.04)',
    preview: 'from-[#0c1222] to-[#1e1b4b]',
  },
  {
    id: 'day',
    name: 'Day',
    bg: '#fffbeb',
    accent: '#d97706',
    card: 'rgba(217,119,6,0.04)',
    preview: 'from-[#fffbeb] to-[#fef3c7]',
  },
  {
    id: 'landscape',
    name: 'Landscape',
    bg: '#0f1f13',
    accent: '#22c55e',
    card: 'rgba(34,197,94,0.04)',
    preview: 'from-[#0f1f13] to-[#14532d]',
  },
  {
    id: 'gallery',
    name: 'Gallery',
    bg: '#1c1017',
    accent: '#f43f5e',
    card: 'rgba(244,63,94,0.04)',
    preview: 'from-[#1c1017] to-[#2d1520]',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    bg: '#0a1628',
    accent: '#0ea5e9',
    card: 'rgba(14,165,233,0.04)',
    preview: 'from-[#0a1628] to-[#0c4a6e]',
  },
] as const;

export type ThemeId = typeof THEMES[number]['id'];

export function getTheme(id: string) {
  return THEMES.find(t => t.id === id) || THEMES[0];
}

export function applyTheme(themeId: string) {
  const theme = getTheme(themeId);
  const root = document.documentElement;
  root.style.setProperty('--background', theme.bg);
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--card-bg', theme.card);
  document.body.style.background = theme.bg;

  // Set text color based on light/dark
  const isLight = themeId === 'light' || themeId === 'day';
  root.style.setProperty('--foreground', isLight ? '#1a1a2e' : '#ffffff');
  root.style.setProperty('--text-primary', isLight ? '#1a1a2e' : '#ffffff');
  root.style.setProperty('--text-secondary', isLight ? 'rgba(26,26,46,0.6)' : 'rgba(255,255,255,0.6)');
  root.style.setProperty('--text-muted', isLight ? 'rgba(26,26,46,0.4)' : 'rgba(255,255,255,0.4)');
  root.style.setProperty('--border', isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)');

  // Store in localStorage
  localStorage.setItem('effortos_theme', themeId);
}

export function getStoredTheme(): string {
  if (typeof window === 'undefined') return 'dark';
  return localStorage.getItem('effortos_theme') || 'dark';
}

export function SettingsModal() {
  const showSettings = useStore(s => s.showSettings);
  const setShowSettings = useStore(s => s.setShowSettings);
  const user = useStore(s => s.user);
  const updateSettings = useStore(s => s.updateSettings);
  const requestNotificationPermission = useStore(s => s.requestNotificationPermission);
  const subscription = useStore(s => s.subscription);
  const subscriptionLoading = useStore(s => s.subscriptionLoading);
  const cancelSubscription = useStore(s => s.cancelSubscription);

  const [focusMin, setFocusMin] = useState(
    Math.round((user?.settings?.focus_duration || 1500) / 60)
  );
  const [breakMin, setBreakMin] = useState(
    Math.round((user?.settings?.break_duration || 300) / 60)
  );
  const [notifications, setNotifications] = useState(user?.settings?.notifications_enabled ?? true);
  const [sound, setSound] = useState(user?.settings?.sound_enabled ?? true);
  const [activeTheme, setActiveTheme] = useState(getStoredTheme());

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');

  // Close on Escape
  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showSettings) setShowSettings(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showSettings, setShowSettings]);

  if (!user) return null;

  const handleSave = () => {
    updateSettings({
      focus_duration: focusMin * 60,
      break_duration: breakMin * 60,
      notifications_enabled: notifications,
      sound_enabled: sound,
    });
    applyTheme(activeTheme);
    if (notifications) requestNotificationPermission();
    setShowSettings(false);
  };

  const handleThemeSelect = (themeId: string) => {
    setActiveTheme(themeId);
    applyTheme(themeId);
  };

  const handleResetAccount = async () => {
    if (!resetPassword) return;
    setResetLoading(true);
    setResetError('');

    try {
      const supabase = createClient();

      // Verify password by attempting to sign in with current email
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: resetPassword,
      });

      if (authError) {
        setResetError('Incorrect password');
        setResetLoading(false);
        return;
      }

      // Get current user
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        setResetError('Authentication failed');
        setResetLoading(false);
        return;
      }

      // Delete all user data from Supabase tables
      // Order matters due to foreign keys: feedback_entries -> sessions -> milestones -> goals -> daily_tasks -> repeating_templates
      await supabase.from('feedback_entries').delete().eq('user_id', authUser.id);
      await supabase.from('sessions').delete().eq('user_id', authUser.id);
      await supabase.from('milestones').delete().eq('user_id', authUser.id);
      await supabase.from('goals').delete().eq('user_id', authUser.id);
      await supabase.from('daily_tasks').delete().eq('user_id', authUser.id);
      await supabase.from('repeating_templates').delete().eq('user_id', authUser.id);

      // Reset profile
      await supabase.from('profiles').update({ onboarding_completed: false }).eq('id', authUser.id);

      // Clear localStorage
      storage.clearAllData();

      // Reset store and go to onboarding
      useStore.setState({
        goals: [],
        activeGoal: null,
        dashboardStats: null,
        dailyTasks: [],
        repeatingTemplates: [],
        timerState: 'idle',
        timeRemaining: 25 * 60,
        currentSessionId: null,
        showSettings: false,
        currentView: 'onboarding',
        onboardingStep: 0,
        onboardingData: {},
        user: { ...user, onboarding_completed: false },
      });

    } catch (err) {
      setResetError('Something went wrong. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {showSettings && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && setShowSettings(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="w-full max-w-md bg-[#131820] border border-white/10 rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 pb-4 border-b border-white/[0.06]">
              <h3 className="text-lg font-semibold text-white">Settings</h3>
              <button
                onClick={() => setShowSettings(false)}
                className="text-white/30 hover:text-white/60 transition-colors p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Timer settings */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-cyan-400" />
                  <h4 className="text-sm font-medium text-white/70">Timer Duration</h4>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-white/40 mb-1 block">Focus (min)</label>
                    <input
                      type="number"
                      min="5"
                      max="90"
                      value={focusMin}
                      onChange={(e) => setFocusMin(parseInt(e.target.value) || 25)}
                      className="w-full h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 mb-1 block">Break (min)</label>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={breakMin}
                      onChange={(e) => setBreakMin(parseInt(e.target.value) || 5)}
                      className="w-full h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                    />
                  </div>
                </div>
              </div>

              {/* Notifications */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Bell className="w-4 h-4 text-cyan-400" />
                  <h4 className="text-sm font-medium text-white/70">Notifications</h4>
                </div>
                <div className="space-y-3">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-white/60">Browser notifications</span>
                    <button
                      onClick={() => setNotifications(!notifications)}
                      className={`w-10 h-6 rounded-full transition-colors ${
                        notifications ? 'bg-cyan-500' : 'bg-white/10'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform mx-1 ${
                        notifications ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </button>
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-white/60">Sound effects</span>
                    <button
                      onClick={() => setSound(!sound)}
                      className={`w-10 h-6 rounded-full transition-colors ${
                        sound ? 'bg-cyan-500' : 'bg-white/10'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform mx-1 ${
                        sound ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </button>
                  </label>
                </div>
              </div>

              {/* Theme */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Palette className="w-4 h-4 text-cyan-400" />
                  <h4 className="text-sm font-medium text-white/70">Theme</h4>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => handleThemeSelect(theme.id)}
                      className={`relative flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all ${
                        activeTheme === theme.id
                          ? 'border-cyan-500/50 bg-cyan-500/5'
                          : 'border-white/[0.06] hover:border-white/10'
                      }`}
                    >
                      <div
                        className={`w-full h-8 rounded-lg bg-gradient-to-br ${theme.preview} border border-white/10`}
                        style={{ position: 'relative' }}
                      >
                        <div
                          className="absolute bottom-1 right-1 w-2 h-2 rounded-full"
                          style={{ backgroundColor: theme.accent }}
                        />
                      </div>
                      <span className="text-[10px] text-white/50">{theme.name}</span>
                      {activeTheme === theme.id && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-cyan-500 rounded-full flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* User info + timezone */}
              <div className="pt-4 border-t border-white/[0.06]">
                <p className="text-xs text-white/30">
                  Signed in as {user.name} ({user.email})
                </p>
                <TimezonePicker currentTimezone={user.timezone} />
              </div>

              {/* Subscription */}
              <div className="pt-4 border-t border-white/[0.06]">
                <div className="flex items-center gap-2 mb-3">
                  <CreditCard className="w-4 h-4 text-cyan-400" />
                  <h4 className="text-sm font-medium text-white/70">Subscription</h4>
                </div>
                {subscriptionLoading ? (
                  <p className="text-xs text-white/30">Loading...</p>
                ) : subscription.status === 'active' ? (
                  <div className="space-y-2">
                    <p className="text-xs text-green-400/70">Active subscription — {DISPLAY_PRICE_PER_MONTH}</p>
                    {subscription.current_period_end && (
                      <p className="text-[11px] text-white/25">
                        Next billing: {new Date(subscription.current_period_end).toLocaleDateString()}
                      </p>
                    )}
                    <button
                      onClick={() => {
                        if (confirm('Are you sure you want to cancel? You will retain access until the end of your billing period.')) {
                          cancelSubscription();
                          setShowSettings(false);
                        }
                      }}
                      className="text-xs text-red-400/50 hover:text-red-400 transition-colors"
                    >
                      Cancel subscription
                    </button>
                  </div>
                ) : subscription.status === 'trialing' ? (
                  <div className="space-y-2">
                    <p className="text-xs text-cyan-400/70">Free trial active</p>
                    {subscription.trial_ends_at && (
                      <p className="text-[11px] text-white/25">
                        Trial ends: {new Date(subscription.trial_ends_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ) : subscription.status === 'cancelled' ? (
                  <div className="space-y-2">
                    <p className="text-xs text-yellow-400/70">Subscription cancelled</p>
                    {subscription.current_period_end && (
                      <p className="text-[11px] text-white/25">
                        Access until: {new Date(subscription.current_period_end).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-white/30">No active subscription</p>
                )}
              </div>

              {/* Email preferences */}
              <EmailPreferences />

              {/* WhatsApp linking */}
              <WhatsAppLinking />

              {/* Danger Zone */}
              <div className="pt-4 border-t border-red-500/10">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <h4 className="text-sm font-medium text-red-400/70">Danger Zone</h4>
                </div>

                {!showResetConfirm ? (
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="text-xs text-red-400/50 hover:text-red-400 transition-colors px-3 py-2 rounded-lg border border-red-500/10 hover:border-red-500/20 hover:bg-red-500/5"
                  >
                    Reset to Day 1
                  </button>
                ) : (
                  <div className="space-y-3 p-3 rounded-xl bg-red-500/5 border border-red-500/10">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-red-400 font-medium">This will permanently delete:</p>
                        <ul className="text-[11px] text-red-400/60 mt-1 space-y-0.5">
                          <li>• All your goals and progress</li>
                          <li>• All session history and streaks</li>
                          <li>• All daily tasks and plans</li>
                          <li>• All AI coach data</li>
                        </ul>
                        <p className="text-[11px] text-red-400/60 mt-2">
                          Your account (email & password) will be preserved. You'll start fresh from onboarding.
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] text-white/30 block mb-1">Enter your password to confirm</label>
                      <input
                        type="password"
                        value={resetPassword}
                        onChange={(e) => { setResetPassword(e.target.value); setResetError(''); }}
                        placeholder="Your password"
                        className="w-full h-9 rounded-lg border border-red-500/20 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-red-500/30"
                      />
                      {resetError && (
                        <p className="text-[10px] text-red-400 mt-1">{resetError}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setShowResetConfirm(false); setResetPassword(''); setResetError(''); }}
                        className="flex-1 px-3 py-2 rounded-lg text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleResetAccount}
                        disabled={!resetPassword || resetLoading}
                        className="flex-1 px-3 py-2 rounded-lg text-xs text-white font-medium bg-red-500/80 hover:bg-red-500 transition-all disabled:opacity-40"
                      >
                        {resetLoading ? 'Resetting...' : 'Reset Everything'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 pt-0">
              <Button variant="glow" className="w-full" onClick={handleSave}>
                Save Settings
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Timezone Picker ──────────────────────────────────────────────

/** Common timezones grouped by region. */
const TIMEZONE_GROUPS: { label: string; zones: { value: string; label: string }[] }[] = [
  {
    label: 'India',
    zones: [
      { value: 'Asia/Kolkata', label: 'India (IST, UTC+5:30)' },
    ],
  },
  {
    label: 'Americas',
    zones: [
      { value: 'America/New_York', label: 'Eastern (ET, UTC-5)' },
      { value: 'America/Chicago', label: 'Central (CT, UTC-6)' },
      { value: 'America/Denver', label: 'Mountain (MT, UTC-7)' },
      { value: 'America/Los_Angeles', label: 'Pacific (PT, UTC-8)' },
      { value: 'America/Sao_Paulo', label: 'Brasilia (BRT, UTC-3)' },
    ],
  },
  {
    label: 'Europe',
    zones: [
      { value: 'Europe/London', label: 'London (GMT/BST)' },
      { value: 'Europe/Berlin', label: 'Berlin (CET, UTC+1)' },
      { value: 'Europe/Moscow', label: 'Moscow (MSK, UTC+3)' },
    ],
  },
  {
    label: 'Asia & Pacific',
    zones: [
      { value: 'Asia/Dubai', label: 'Dubai (GST, UTC+4)' },
      { value: 'Asia/Singapore', label: 'Singapore (SGT, UTC+8)' },
      { value: 'Asia/Tokyo', label: 'Tokyo (JST, UTC+9)' },
      { value: 'Asia/Shanghai', label: 'China (CST, UTC+8)' },
      { value: 'Australia/Sydney', label: 'Sydney (AEST, UTC+10)' },
      { value: 'Pacific/Auckland', label: 'Auckland (NZST, UTC+12)' },
    ],
  },
];

function TimezonePicker({ currentTimezone }: { currentTimezone: string }) {
  const [tz, setTz] = React.useState(currentTimezone || 'Asia/Kolkata');
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const detectedTz = React.useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; }
  }, []);

  const showDetectButton = detectedTz && detectedTz !== tz;

  async function saveTz(newTz: string) {
    setTz(newTz);
    setSaving(true);
    setSaved(false);

    // Update profiles table
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('profiles').update({ timezone: newTz }).eq('id', user.id);
    }
    // Also update email_preferences timezone
    await fetch('/api/email-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: newTz }),
    });

    // Update local store
    const currentUser = useStore.getState().user;
    if (currentUser) {
      useStore.setState({ user: { ...currentUser, timezone: newTz } });
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 mb-1.5">
        <Globe className="w-3.5 h-3.5 text-white/30" />
        <span className="text-xs text-white/40">Timezone</span>
        {saving && <span className="text-[10px] text-cyan-400/60">saving...</span>}
        {saved && <span className="text-[10px] text-green-400/60">saved</span>}
      </div>
      <select
        value={tz}
        onChange={e => saveTz(e.target.value)}
        className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded-lg text-xs text-white/70 focus:outline-none focus:border-cyan-500/30 appearance-none cursor-pointer"
      >
        {TIMEZONE_GROUPS.map(g => (
          <optgroup key={g.label} label={g.label}>
            {g.zones.map(z => (
              <option key={z.value} value={z.value}>{z.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {showDetectButton && (
        <button
          onClick={() => saveTz(detectedTz)}
          className="mt-1.5 text-[11px] text-cyan-400/60 hover:text-cyan-400 transition-colors"
        >
          Detect from browser → {detectedTz}
        </button>
      )}
      <p className="text-[10px] text-white/20 mt-1">
        Controls when morning (8 AM), afternoon (2 PM), and nightly (9 PM) emails arrive.
      </p>
    </div>
  );
}

// ── Email Preferences Sub-component ──────────────────────────────

function EmailPreferences() {
  const [prefs, setPrefs] = React.useState<{
    morning_email: boolean;
    afternoon_email: boolean;
    nightly_email: boolean;
    admin_emails: boolean;
    unsubscribed_all: boolean;
  } | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    fetch('/api/email-preferences')
      .then(r => r.json())
      .then(d => { setPrefs(d); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  async function toggle(key: keyof NonNullable<typeof prefs>) {
    if (!prefs) return;
    const newVal = !prefs[key];
    const updated = { ...prefs, [key]: newVal };

    // If unsubscribing all, disable everything
    if (key === 'unsubscribed_all' && newVal) {
      updated.morning_email = false;
      updated.afternoon_email = false;
      updated.nightly_email = false;
      updated.admin_emails = false;
    }
    // If re-enabling any, turn off unsubscribed_all
    if (key !== 'unsubscribed_all' && newVal) {
      updated.unsubscribed_all = false;
    }

    setPrefs(updated);
    setSaving(true);
    await fetch('/api/email-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    setSaving(false);
  }

  if (!loaded) return null;

  const items = [
    { key: 'morning_email' as const, label: 'Morning plan', desc: '8 AM — recap + plan your day' },
    { key: 'afternoon_email' as const, label: 'Afternoon check-in', desc: '2 PM — progress + reminder' },
    { key: 'nightly_email' as const, label: 'Nightly recap', desc: '9 PM — day summary + plan tomorrow' },
    { key: 'admin_emails' as const, label: 'Product updates', desc: 'Announcements from EffortOS' },
  ];

  return (
    <div className="pt-4 border-t border-white/[0.06]">
      <div className="flex items-center gap-2 mb-3">
        <Mail className="w-4 h-4 text-cyan-400" />
        <h4 className="text-sm font-medium text-white/70">Email notifications</h4>
        {saving && <span className="text-[10px] text-cyan-400/60">saving...</span>}
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <label key={item.key} className="flex items-center justify-between py-1.5 cursor-pointer group">
            <div>
              <p className="text-xs text-white/70 group-hover:text-white/90 transition-colors">{item.label}</p>
              <p className="text-[10px] text-white/30">{item.desc}</p>
            </div>
            <button
              onClick={() => toggle(item.key)}
              className={`w-8 h-4.5 rounded-full transition-colors relative ${
                prefs?.[item.key] ? 'bg-cyan-500' : 'bg-white/10'
              }`}
              style={{ minWidth: 32, height: 18 }}
            >
              <span
                className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                  prefs?.[item.key] ? 'translate-x-[16px]' : 'translate-x-[2px]'
                }`}
              />
            </button>
          </label>
        ))}

        <label className="flex items-center justify-between py-1.5 cursor-pointer group mt-2 pt-2 border-t border-white/[0.04]">
          <div>
            <p className="text-xs text-red-400/70">Unsubscribe from all</p>
          </div>
          <button
            onClick={() => toggle('unsubscribed_all')}
            className={`w-8 h-4.5 rounded-full transition-colors relative ${
              prefs?.unsubscribed_all ? 'bg-red-500' : 'bg-white/10'
            }`}
            style={{ minWidth: 32, height: 18 }}
          >
            <span
              className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                prefs?.unsubscribed_all ? 'translate-x-[16px]' : 'translate-x-[2px]'
              }`}
            />
          </button>
        </label>
      </div>
    </div>
  );
}

// ── WhatsApp Linking Sub-component (OTP verified) ───────────────

function WhatsAppLinking() {
  const user = useStore(s => s.user);
  const [phone, setPhone] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [step, setStep] = React.useState<'input' | 'verify'>('input');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [countdown, setCountdown] = React.useState(0);
  const isLinked = !!user?.phone_number && !!user?.whatsapp_linked;

  // Countdown timer for resend
  React.useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  async function handleSendOTP() {
    const cleaned = phone.replace(/\s/g, '');
    if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
      setError('Enter a valid number with country code (e.g. +919876543210)');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/whatsapp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', phone: cleaned }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to send code');
        setLoading(false);
        return;
      }

      setStep('verify');
      setCountdown(60);
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOTP() {
    if (otp.length !== 6) {
      setError('Enter the 6-digit code');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const cleaned = phone.replace(/\s/g, '');
      const res = await fetch('/api/whatsapp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', phone: cleaned, code: otp }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Verification failed');
        setLoading(false);
        return;
      }

      // Success — update local store
      const currentUser = useStore.getState().user;
      if (currentUser) {
        useStore.setState({
          user: { ...currentUser, phone_number: cleaned, whatsapp_linked: true },
        });
      }
      setStep('input');
      setOtp('');
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlink() {
    setLoading(true);
    setError('');
    try {
      const supabase = createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;

      await supabase
        .from('profiles')
        .update({ phone_number: null, whatsapp_linked: false })
        .eq('id', authUser.id);

      const currentUser = useStore.getState().user;
      if (currentUser) {
        useStore.setState({
          user: { ...currentUser, phone_number: '', whatsapp_linked: false },
        });
      }
      setPhone('');
    } catch {
      setError('Failed to unlink');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pt-4 border-t border-white/[0.06]">
      <div className="flex items-center gap-2 mb-3">
        <MessageCircle className="w-4 h-4 text-green-400" />
        <h4 className="text-sm font-medium text-white/70">WhatsApp Bot</h4>
      </div>

      {isLinked ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/5 border border-green-500/10">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-400/80">{user?.phone_number}</span>
            <span className="text-[10px] text-green-400/50 ml-auto">Verified</span>
          </div>
          <p className="text-[10px] text-white/30">
            Send a message to the EffortOS WhatsApp bot to add tasks, check progress, and more.
          </p>
          <button
            onClick={handleUnlink}
            disabled={loading}
            className="text-[11px] text-red-400/50 hover:text-red-400 transition-colors"
          >
            Unlink WhatsApp
          </button>
        </div>
      ) : step === 'input' ? (
        <div className="space-y-2">
          <p className="text-[10px] text-white/40 mb-2">
            Link your WhatsApp to manage tasks via chat. We&apos;ll send a verification code to confirm it&apos;s your number.
          </p>
          <div className="flex gap-2">
            <input
              type="tel"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setError(''); }}
              placeholder="+919876543210"
              className="flex-1 h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-green-500/30"
            />
            <button
              onClick={handleSendOTP}
              disabled={loading || !phone.trim()}
              className="px-4 h-9 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-all disabled:opacity-40"
            >
              {loading ? '...' : 'Send Code'}
            </button>
          </div>
          {error && <p className="text-[10px] text-red-400">{error}</p>}
          <p className="text-[10px] text-white/20">
            Include country code (e.g. +91 for India, +1 for US)
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] text-white/40 mb-2">
            Enter the 6-digit code sent to <span className="text-white/70">{phone}</span> on WhatsApp.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '')); setError(''); }}
              placeholder="000000"
              className="flex-1 h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white text-center tracking-[0.3em] font-mono placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-green-500/30"
            />
            <button
              onClick={handleVerifyOTP}
              disabled={loading || otp.length !== 6}
              className="px-4 h-9 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-all disabled:opacity-40"
            >
              {loading ? '...' : 'Verify'}
            </button>
          </div>
          {error && <p className="text-[10px] text-red-400">{error}</p>}
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setStep('input'); setOtp(''); setError(''); }}
              className="text-[11px] text-white/30 hover:text-white/50 transition-colors"
            >
              Change number
            </button>
            {countdown > 0 ? (
              <span className="text-[10px] text-white/20">Resend in {countdown}s</span>
            ) : (
              <button
                onClick={handleSendOTP}
                disabled={loading}
                className="text-[11px] text-cyan-400/60 hover:text-cyan-400 transition-colors"
              >
                Resend code
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
