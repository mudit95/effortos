'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Sparkles, X, Shield, Zap, Brain, BarChart3, Clock, Ticket, MessageCircle, Check } from 'lucide-react';
import { STARTER_PRICE, PRO_PRICE } from '@/lib/pricing';
import type { PlanTier } from '@/types';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

const STARTER_FEATURES = [
  { icon: Brain, label: 'AI Goal Estimation' },
  { icon: Zap, label: 'Pomodoro Focus Timer' },
  { icon: BarChart3, label: 'Reports & Streaks' },
  { icon: Clock, label: 'Daily Task Management' },
  { icon: MessageCircle, label: 'WhatsApp Bot (reactive)' },
];

const PRO_FEATURES = [
  { icon: Sparkles, label: 'Everything in Starter' },
  { icon: MessageCircle, label: 'Proactive AI Coach on WhatsApp' },
  { icon: Zap, label: 'Morning, Midday & Evening Check-ins' },
  { icon: BarChart3, label: 'Weekly AI Recap & Pace Alerts' },
  { icon: Clock, label: 'Streak Saver & Idle Nudges' },
];

export function PaywallModal() {
  const showPaywall = useStore(s => s.showPaywall);
  const setShowPaywall = useStore(s => s.setShowPaywall);
  const startTrial = useStore(s => s.startTrial);
  const subscription = useStore(s => s.subscription);
  const [loading, setLoading] = useState(false);
  const [selectedTier, setSelectedTier] = useState<PlanTier>('starter');
  const [couponCode, setCouponCode] = useState('');
  const [couponMsg, setCouponMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; coupon_id: string; razorpay_offer_id: string | null; percent: number } | null>(null);

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
        setAppliedCoupon({
          code: couponCode.trim().toUpperCase(),
          coupon_id: data.coupon_id,
          razorpay_offer_id: data.razorpay_offer_id,
          percent: data.percent,
        });
        setCouponMsg({
          type: data.razorpay_offer_id ? 'ok' : 'err',
          text: data.razorpay_offer_id
            ? `${data.percent}% off will apply at checkout.`
            : `Code valid, but discount isn't configured at the processor yet.`,
        });
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
  const isCurrentlyStarter = subscription.plan_tier === 'starter' && (subscription.status === 'trialing' || subscription.status === 'active');

  const handleStartTrial = async () => {
    setLoading(true);
    await startTrial({
      tier: selectedTier,
      ...(appliedCoupon && appliedCoupon.razorpay_offer_id ? {
        couponCode: appliedCoupon.code,
        couponId: appliedCoupon.coupon_id,
        offerId: appliedCoupon.razorpay_offer_id,
      } : {}),
    });
    setLoading(false);
  };

  if (!showPaywall) return null;

  const features = selectedTier === 'pro' ? PRO_FEATURES : STARTER_FEATURES;
  const price = selectedTier === 'pro' ? PRO_PRICE : STARTER_PRICE;

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
          className="relative bg-[#0d1117] border border-white/[0.08] rounded-2xl max-w-lg w-full overflow-hidden"
        >
          {/* Header */}
          <div className="relative px-6 pt-8 pb-4 text-center bg-gradient-to-b from-cyan-500/[0.08] to-transparent">
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
              {trialEnded ? 'Your trial has ended' : isCurrentlyStarter ? 'Upgrade to Pro' : 'Choose Your Plan'}
            </h2>
            <p className="text-sm text-white/40">
              {trialEnded
                ? 'Subscribe to keep tracking your goals'
                : isCurrentlyStarter
                  ? 'Get a proactive AI coach on WhatsApp'
                  : 'Start your 3-day free trial. Cancel anytime.'}
            </p>
          </div>

          {/* Tier selector */}
          <div className="px-6 pb-3">
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedTier('starter')}
                className={`flex-1 py-3 px-3 rounded-xl border text-sm font-medium transition-all ${
                  selectedTier === 'starter'
                    ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400'
                    : 'border-white/[0.08] bg-white/[0.02] text-white/40 hover:border-white/[0.15]'
                }`}
              >
                <div className="text-center">
                  <div className="font-bold">Starter</div>
                  <div className="text-xs mt-0.5 opacity-70">{STARTER_PRICE}/mo</div>
                </div>
              </button>
              <button
                onClick={() => setSelectedTier('pro')}
                className={`flex-1 py-3 px-3 rounded-xl border text-sm font-medium transition-all relative ${
                  selectedTier === 'pro'
                    ? 'border-purple-500/50 bg-purple-500/10 text-purple-400'
                    : 'border-white/[0.08] bg-white/[0.02] text-white/40 hover:border-white/[0.15]'
                }`}
              >
                <div className="absolute -top-2 right-2 px-1.5 py-0.5 bg-purple-500 text-[9px] font-bold text-white rounded-full">
                  AI COACH
                </div>
                <div className="text-center">
                  <div className="font-bold">Pro</div>
                  <div className="text-xs mt-0.5 opacity-70">{PRO_PRICE}/mo</div>
                </div>
              </button>
            </div>
          </div>

          {/* Features */}
          <div className="px-6 pb-4 space-y-2.5">
            {features.map((f, i) => (
              <motion.div
                key={`${selectedTier}-${f.label}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.05 + i * 0.04 }}
                className="flex items-center gap-3"
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  selectedTier === 'pro' ? 'bg-purple-500/10' : 'bg-white/[0.04]'
                }`}>
                  <Check className={`w-3.5 h-3.5 ${selectedTier === 'pro' ? 'text-purple-400' : 'text-cyan-400'}`} />
                </div>
                <p className="text-sm text-white/60">{f.label}</p>
              </motion.div>
            ))}
          </div>

          {/* Pricing + CTA */}
          <div className="px-6 py-5 border-t border-white/[0.06]">
            <div className="text-center mb-4">
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-3xl font-bold text-white">{price}</span>
                <span className="text-sm text-white/30">/month</span>
              </div>
              <p className="text-xs text-white/25 mt-1">
                {trialEnded ? 'Billed monthly. Cancel anytime.'
                  : isCurrentlyStarter && selectedTier === 'pro' ? 'Upgrade now. Billed monthly.'
                  : `3 days free, then ${price}/month. Cancel anytime.`}
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
              className={`w-full gap-2 h-12 text-base ${
                selectedTier === 'pro' ? 'bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400' : ''
              }`}
            >
              {loading ? (
                'Opening checkout...'
              ) : trialEnded ? (
                <>Subscribe Now</>
              ) : isCurrentlyStarter && selectedTier === 'pro' ? (
                <>
                  <Sparkles className="w-4 h-4" />
                  Upgrade to Pro
                </>
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
