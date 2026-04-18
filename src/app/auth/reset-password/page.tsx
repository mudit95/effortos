'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import {
  Lock,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

/**
 * Password reset landing page.
 *
 * Flow:
 *   1. User clicks "Forgot password" in AuthScreen → we call
 *      `supabase.auth.resetPasswordForEmail(email, { redirectTo: this page })`.
 *   2. Supabase emails the user a PKCE link. When they click it they land
 *      here with `?code=…` in the URL.
 *   3. On mount we exchange the code for a short-lived recovery session,
 *      strip the code from the URL (so a refresh doesn't try to re-exchange
 *      it), then render a "choose a new password" form.
 *   4. On submit we call `auth.updateUser({ password })`, sign the user out,
 *      and bounce them to `/` so they sign in fresh with the new password.
 *
 * We also tolerate the legacy hash-based recovery link (`#access_token=…`)
 * — the browser client picks that up automatically before this effect
 * runs, so `getSession()` already returns a session and we skip straight
 * to the form.
 */
type Status = 'verifying' | 'ready' | 'updating' | 'success' | 'error';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('verifying');
  const [errorMsg, setErrorMsg] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const run = async () => {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setErrorMsg(
            'This reset link is invalid or has expired. Request a new one from the sign-in screen.'
          );
          setStatus('error');
          return;
        }
        // Remove the code from the URL so a refresh (or a browser
        // back-button) can't try to exchange the same one-time code twice.
        window.history.replaceState({}, '', '/auth/reset-password');
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setErrorMsg(
          'No active recovery session. The link may have expired — request a new one.'
        );
        setStatus('error');
        return;
      }
      setStatus('ready');
    };
    void run();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      setErrorMsg("Passwords don't match");
      return;
    }

    setStatus('updating');
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setErrorMsg(error.message);
      setStatus('ready');
      return;
    }

    setStatus('success');
    // Sign out the recovery session so the user has to authenticate
    // with their NEW password — avoids accidentally keeping them logged
    // in via the one-time recovery token.
    await supabase.auth.signOut();
    setTimeout(() => router.push('/'), 1500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#0B0F14]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center mx-auto mb-6">
          <Lock className="w-8 h-8 text-white" />
        </div>

        {status === 'verifying' && (
          <div className="text-center">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400 mx-auto mb-3" />
            <p className="text-sm text-white/60">Verifying your reset link…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-6 h-6 text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Reset link invalid</h2>
            <p className="text-sm text-white/50 mb-6">{errorMsg}</p>
            <Button onClick={() => router.push('/')} className="w-full">
              Back to sign-in
            </Button>
          </div>
        )}

        {status === 'success' && (
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-6 h-6 text-green-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Password updated</h2>
            <p className="text-sm text-white/50 mb-2">
              Sign in with your new password to continue.
            </p>
            <p className="text-xs text-white/30">Redirecting…</p>
          </div>
        )}

        {(status === 'ready' || status === 'updating') && (
          <>
            <h1 className="text-2xl font-bold text-white text-center mb-2">
              Choose a new password
            </h1>
            <p className="text-sm text-white/50 text-center mb-8">
              Pick something you haven&apos;t used before. At least 6 characters.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="New password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={status === 'updating'}
                  autoComplete="new-password"
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="Confirm new password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                disabled={status === 'updating'}
                autoComplete="new-password"
                required
              />

              {errorMsg && (
                <p className="text-xs text-red-400">{errorMsg}</p>
              )}

              <Button
                type="submit"
                variant="glow"
                size="lg"
                className="w-full"
                disabled={status === 'updating'}
              >
                {status === 'updating' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Updating…
                  </>
                ) : (
                  'Update password'
                )}
              </Button>

              <button
                type="button"
                onClick={() => router.push('/')}
                className="w-full text-xs text-white/40 hover:text-white/60 pt-2"
              >
                Cancel and go back
              </button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
}
