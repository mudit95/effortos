'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore } from '@/store/useStore';
import { createClient } from '@/lib/supabase/client';
import { Mail, ArrowRight, Sparkles, Zap, Eye, EyeOff, LogIn, UserPlus, Loader2 } from 'lucide-react';

type AuthMode = 'landing' | 'signup' | 'signin';

export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('landing');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const loginAsDemo = useStore(s => s.loginAsDemo);
  const initializeApp = useStore(s => s.initializeApp);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) return setError('Please enter your name');
    if (!email.trim() || !emailRegex.test(email)) return setError('Please enter a valid email');
    if (password.length < 6) return setError('Password must be at least 6 characters');

    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name.trim(),
            full_name: name.trim(),
          },
        },
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      // If email confirmation is required
      if (data.user && !data.session) {
        setConfirmationSent(true);
        return;
      }

      // If auto-confirmed (e.g., in development), reload the app state
      if (data.session) {
        initializeApp();
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !emailRegex.test(email)) return setError('Please enter a valid email');
    if (!password) return setError('Please enter your password');

    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        if (authError.message.includes('Invalid login')) {
          setError('Incorrect email or password');
        } else {
          setError(authError.message);
        }
        return;
      }

      if (data.session) {
        initializeApp();
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  if (confirmationSent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md text-center"
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mx-auto mb-6">
            <Mail className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Check your email</h2>
          <p className="text-white/50 text-sm mb-6">
            We sent a confirmation link to <span className="text-white/70">{email}</span>. Click it to activate your account.
          </p>
          <Button
            variant="ghost"
            onClick={() => { setConfirmationSent(false); setMode('signin'); }}
          >
            Back to sign in
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="inline-flex items-center gap-2 mb-6"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-2xl font-bold text-white tracking-tight">EffortOS</span>
          </motion.div>
          <p className="text-white/50 text-sm">
            AI-powered effort tracking. Know exactly how long things take.
          </p>
        </div>

        <AnimatePresence mode="wait">
          {mode === 'landing' && (
            <motion.div
              key="landing"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3"
            >
              {/* Demo mode */}
              <Button
                variant="glow"
                size="lg"
                className="w-full justify-center gap-3 h-13"
                onClick={loginAsDemo}
              >
                <Zap className="w-5 h-5" />
                Try a free Pomodoro session
              </Button>

              <p className="text-center text-xs text-white/25 py-1">
                No account needed. Jump right in.
              </p>

              <div className="flex items-center gap-4 py-1">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs text-white/30">or</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              {/* Sign Up */}
              <Button
                variant="outline"
                size="lg"
                className="w-full justify-center gap-3 h-12"
                onClick={() => setMode('signup')}
              >
                <UserPlus className="w-4 h-4" />
                Create an account
              </Button>

              {/* Sign In */}
              <Button
                variant="ghost"
                size="lg"
                className="w-full justify-center gap-3 h-12"
                onClick={() => setMode('signin')}
              >
                <LogIn className="w-4 h-4" />
                I already have an account
              </Button>
            </motion.div>
          )}

          {mode === 'signup' && (
            <motion.form
              key="signup"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              onSubmit={handleSignUp}
              className="space-y-4"
            >
              <h3 className="text-lg font-semibold text-white text-center mb-2">Create your account</h3>

              <Input
                label="Your name"
                placeholder="e.g., Mudit"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(''); }}
                autoFocus
              />
              <Input
                label="Email address"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
              />
              <div className="relative">
                <Input
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-[34px] text-white/30 hover:text-white/60 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {error && (
                <p className="text-red-400 text-xs text-center">{error}</p>
              )}

              <Button
                type="submit"
                variant="glow"
                size="lg"
                className="w-full justify-center gap-2 h-12"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Create account
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>

              <div className="flex items-center gap-2 justify-center">
                <span className="text-xs text-white/30">Already have an account?</span>
                <button
                  type="button"
                  onClick={() => { setMode('signin'); setError(''); }}
                  className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  Sign in
                </button>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setMode('landing'); setError(''); }}
                className="w-full"
              >
                Back
              </Button>
            </motion.form>
          )}

          {mode === 'signin' && (
            <motion.form
              key="signin"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              onSubmit={handleSignIn}
              className="space-y-4"
            >
              <h3 className="text-lg font-semibold text-white text-center mb-2">Welcome back</h3>

              <Input
                label="Email address"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                autoFocus
              />
              <div className="relative">
                <Input
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-[34px] text-white/30 hover:text-white/60 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {error && (
                <p className="text-red-400 text-xs text-center">{error}</p>
              )}

              <Button
                type="submit"
                variant="glow"
                size="lg"
                className="w-full justify-center gap-2 h-12"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>

              <div className="flex items-center gap-2 justify-center">
                <span className="text-xs text-white/30">Don't have an account?</span>
                <button
                  type="button"
                  onClick={() => { setMode('signup'); setError(''); }}
                  className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  Sign up
                </button>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setMode('landing'); setError(''); }}
                className="w-full"
              >
                Back
              </Button>
            </motion.form>
          )}
        </AnimatePresence>

        <p className="text-center text-xs text-white/20 mt-8">
          {mode === 'landing'
            ? 'Demo data stays on this device. Create an account to sync across devices.'
            : 'Your data is encrypted and stored securely.'
          }
        </p>
      </motion.div>
    </div>
  );
}
