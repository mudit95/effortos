'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Clock, AlertTriangle } from 'lucide-react';

export function TrialBanner() {
  const subscription = useStore(s => s.subscription);
  const subscriptionLoading = useStore(s => s.subscriptionLoading);
  const setShowPaywall = useStore(s => s.setShowPaywall);

  const trialInfo = useMemo(() => {
    if (subscription.status !== 'trialing' || !subscription.trial_ends_at) return null;

    const endsAt = new Date(subscription.trial_ends_at);
    const now = new Date();
    const hoursLeft = Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60)));
    const daysLeft = Math.ceil(hoursLeft / 24);
    const isUrgent = hoursLeft <= 24;

    return { daysLeft, hoursLeft, isUrgent };
  }, [subscription]);

  if (subscriptionLoading || !trialInfo) return null;

  return (
    <motion.button
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => setShowPaywall(true)}
      className={`w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium transition-colors cursor-pointer ${
        trialInfo.isUrgent
          ? 'bg-yellow-500/10 text-yellow-400/80 hover:bg-yellow-500/15'
          : 'bg-cyan-500/[0.06] text-cyan-400/60 hover:bg-cyan-500/10'
      }`}
    >
      {trialInfo.isUrgent ? (
        <AlertTriangle className="w-3.5 h-3.5" />
      ) : (
        <Clock className="w-3.5 h-3.5" />
      )}
      {trialInfo.isUrgent
        ? `Trial ends in ${trialInfo.hoursLeft}h — tap to subscribe`
        : `${trialInfo.daysLeft} day${trialInfo.daysLeft !== 1 ? 's' : ''} left in trial`}
    </motion.button>
  );
}
