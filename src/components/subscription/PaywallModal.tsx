'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Sparkles, X, Shield, Zap, Brain, BarChart3, Clock, Ticket } from 'lucide-react';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

const FEATURES = [
  { icon: Brain, label: 'AI Coach', desc: 'Plan My Day, Session Debriefs, Weekly Insights' },
  { icon: Zap, label: 'Focus Timer', desc: 'Pomodoro timer with auto-breaks and focus mode' },
  { icon: BarChart3, label: 'Smart Reports', desc: 'Goal tracking, consistency analytics, patterns' },
  { icon: Clock, label: 'Adaptive Estimation', desc: 'AI learns your pace and recalibrates over time' },
];

export function PaywallModal() {
  const showPaywall = useStore(s => s.showPaywall);
  const setShowPaywall = useStore(s => s.setShowPaywall);
  const startTrial = useStore(s => s.startTrial);
  const subscription = useStore(s => s.subscription);
  const [loading, setLoading] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponMsg, setCouponMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [redeeming, setRedeeming] = useState(false);

  async function redeemCoupon() {
    if (!couponCode.trim()) return;
    setRedeeming(true);
    setCouponMsg(null);
    try {
      const res = await fetch('/api/coupons/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCouponMsg({ type: 'err', text: data.error || 'Invalid code' });
      } else if (data.applied === 'percent_off') {
        setCouponMsg({ type: 'ok', text: `${data.percent}% off will apply at checkout.` });
      } else if (data.applied === 'trial_extension') {
        setCouponMsg({ type: 'ok', text: `Trial extended by ${data.value} days.` });
        setTimeout(() => { useStore.getState().fetchSubscriptionStatus?.(); setShowPaywall(false); }, 1200);
      } else if (data.applied === 'free_months') {
        setCouponMsg({ type: 'ok', text: `${data.value} month(s) of premium granted.` });
        setTimeout(() => { useStore.getState().fetchSubscriptionStatus?.(); setShowPaywall(false); }, 1200);
      }
    } catch {
      setCouponMsg({ type: 'err', text: 'Network error. Try again.' });
    } finally {
      setRedeeming(false);
    }
  }

  const isExpired = subscription.status === 'expired';
  const trialEnded = isExpired && subscription.trial_ends_at;

  const handleStartTrial = async () => {
    setLoading(true);
    await startTrial();
    setLoading(false);
  };

  if (!showPaywall) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.95 }}
          transition={{ duration: 0.4, ease }}
          className="relative bg-[#0d1117] border border-white/[0.08] rounded-2xl max-w-md w-full overflow-hidden"
        >
          {/* Gradient header */}
          <div className="relative px-6 pt-8 pb-6 text-center bg-gradient-to-b from-cyan-500/[0.08] to-transparent">
            <button
              onClick={() => setShowPaywall(false)}
              className="absolute top-4 right-4 text-white/20 hover:text-white/50 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-cyan-500/20">
              <Sparkles className="w-7 h-7 text-white" />
            </div>

            <h2 className="text-xl font-bold text-white mb-1">
              {trialEnded ? 'Your trial has ended' : 'Unlock EffortOS'}
            </h2>
            <p className="text-sm text-white/40">
              {trialEnded
                ? 'Subscribe to keep tracking your goals with AI-powered insights'
                : 'Start your 3-day free trial. Cancel anytime.'}
            </p>
          </div>

          {/* Features */}
          <div className="px-6 pb-4 space-y-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.label}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                className="flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
                  <f.icon className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white/70">{f.label}</p>
                  <p className="text-xs text-white/30">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Pricing */}
          <div className="px-6 py-5 border-t border-white/[0.06]">
            <div className="text-center mb-4">
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-3xl font-bold text-white">$4.99</span>
                <span className="text-sm text-white/30">/month</span>
              </div>
              <p className="text-xs text-white/25 mt-1">
                {trialEnded ? 'Billed monthly. Cancel anytime.' : '3 days free, then $4.99/month. Cancel anytime.'}
              </p>
            </div>

            {/* Coupon code */}
            <div className="mb-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Ticket className="w-3.5 h-3.5 text-white/30 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={couponCode}
                    onChange={e => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="Coupon code"
                    className="w-full pl-8 pr-2 py-2 bg-white/[0.03] border border-white/[0.08] rounded-md text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/20 uppercase"
                  />
                </div>
                <button
                  type="button"
                  onClick={redeemCoupon}
                  disabled={redeeming || !couponCode.trim()}
                  className="px-3 text-xs rounded-md border border-white/[0.08] text-white/70 hover:border-white/20 hover:bg-white/[0.04] disabled:opacity-40"
                >
                  {redeeming ? '…' : 'Apply'}
                </button>
              </div>
              {couponMsg && (
                <p className={`text-[11px] mt-1.5 ${couponMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {couponMsg.text}
                </p>
              )}
            </div>

            <Button
              variant="glow"
              size="lg"
              onClick={handleStartTrial}
              disabled={loading}
              className="w-full gap-2 h-12 text-base"
            >
              {loading ? (
                'Opening checkout...'
              ) : trialEnded ? (
                <>Subscribe Now</>
              ) : (
                <>
                  <Shield className="w-4 h-4" />
                  Start Free Trial
                </>
              )}
            </Button>

            <div className="flex items-center justify-center gap-2 mt-3">
              <Shield className="w-3 h-3 text-white/15" />
              <p className="text-[10px] text-white/20">Secured by Razorpay. Cancel in settings anytime.</p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
