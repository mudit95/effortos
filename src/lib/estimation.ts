// AI Effort Estimation Engine
// Hybrid estimation: AI base estimate * adjustment factors

import { EstimationInput, EstimationOutput, Milestone, RecalibrationResult, Goal, FeedbackEntry } from '@/types';
import { generateId, clampBias } from './utils';

// Goal complexity classification using keyword analysis
interface GoalClassification {
  category: string;
  baseSessions: number;
  difficulty: 'easy' | 'moderate' | 'hard' | 'expert';
  confidence: number;
}

const GOAL_PATTERNS: { pattern: RegExp; category: string; baseSessions: number; difficulty: GoalClassification['difficulty']; confidence: number }[] = [
  // Programming & Tech
  { pattern: /\b(build|create|develop)\b.*\b(app|application|website|platform|saas)\b/i, category: 'software_project', baseSessions: 120, difficulty: 'hard', confidence: 0.6 },
  { pattern: /\b(learn|study)\b.*\b(programming|coding|python|javascript|react|machine learning|ai|data science)\b/i, category: 'tech_learning', baseSessions: 80, difficulty: 'hard', confidence: 0.65 },
  { pattern: /\b(api|backend|frontend|database|deploy)\b/i, category: 'tech_task', baseSessions: 40, difficulty: 'moderate', confidence: 0.7 },

  // Creative
  { pattern: /\b(write|author)\b.*\b(book|novel|screenplay)\b/i, category: 'writing_major', baseSessions: 200, difficulty: 'hard', confidence: 0.5 },
  { pattern: /\b(write|create)\b.*\b(blog|article|essay|report)\b/i, category: 'writing_minor', baseSessions: 15, difficulty: 'easy', confidence: 0.75 },
  { pattern: /\b(design|redesign)\b/i, category: 'design', baseSessions: 30, difficulty: 'moderate', confidence: 0.65 },

  // Learning
  { pattern: /\b(learn|master|study)\b.*\b(language|spanish|french|german|japanese|chinese|korean)\b/i, category: 'language_learning', baseSessions: 300, difficulty: 'expert', confidence: 0.55 },
  { pattern: /\b(learn|study|prepare)\b.*\b(exam|certification|test|course)\b/i, category: 'exam_prep', baseSessions: 60, difficulty: 'moderate', confidence: 0.7 },
  { pattern: /\b(learn|study|understand)\b/i, category: 'general_learning', baseSessions: 40, difficulty: 'moderate', confidence: 0.65 },

  // Fitness & Health
  { pattern: /\b(run|marathon|5k|10k|half marathon)\b/i, category: 'running', baseSessions: 50, difficulty: 'moderate', confidence: 0.7 },
  { pattern: /\b(lose weight|fitness|workout|exercise|gym)\b/i, category: 'fitness', baseSessions: 80, difficulty: 'moderate', confidence: 0.6 },
  { pattern: /\b(meditat|mindful|yoga)\b/i, category: 'wellness', baseSessions: 30, difficulty: 'easy', confidence: 0.75 },

  // Business
  { pattern: /\b(launch|start)\b.*\b(business|startup|company|product)\b/i, category: 'business_launch', baseSessions: 150, difficulty: 'expert', confidence: 0.5 },
  { pattern: /\b(marketing|growth|sales|revenue)\b/i, category: 'business_growth', baseSessions: 40, difficulty: 'moderate', confidence: 0.6 },

  // Research
  { pattern: /\b(research|thesis|dissertation|paper)\b/i, category: 'research', baseSessions: 100, difficulty: 'hard', confidence: 0.55 },
];

function classifyGoal(goalText: string): GoalClassification {
  for (const p of GOAL_PATTERNS) {
    if (p.pattern.test(goalText)) {
      return {
        category: p.category,
        baseSessions: p.baseSessions,
        difficulty: p.difficulty,
        confidence: p.confidence,
      };
    }
  }
  // Default for unclassified goals
  const wordCount = goalText.split(/\s+/).length;
  const baseSessions = Math.max(10, Math.min(60, wordCount * 5));
  return {
    category: 'general',
    baseSessions,
    difficulty: 'moderate',
    confidence: 0.6,
  };
}

// Skill modifier: how experience affects effort
function getSkillModifier(level: 'beginner' | 'intermediate' | 'advanced'): number {
  switch (level) {
    case 'beginner': return 0.3;    // 30% more effort
    case 'intermediate': return 0;   // baseline
    case 'advanced': return -0.2;   // 20% less effort
  }
}

// Consistency modifier: how reliable the user is
function getConsistencyModifier(level: 'low' | 'medium' | 'high'): number {
  switch (level) {
    case 'low': return 0.15;    // Need more sessions (missed days)
    case 'medium': return 0;
    case 'high': return -0.05;  // Slightly fewer (strong momentum)
  }
}

// Calculate user time bias from their estimate vs AI estimate
export function calculateTimeBias(userEstimateHours: number | undefined, aiSessions: number): number {
  if (!userEstimateHours) return 0;
  const userSessions = Math.round(userEstimateHours * 60 / 25);
  const ratio = userSessions / aiSessions;

  if (ratio < 0.5) return -2;      // User thinks way less
  if (ratio < 0.75) return -1;     // User underestimates
  if (ratio < 1.25) return 0;      // Close enough
  if (ratio < 1.75) return 1;      // User overestimates
  return 2;                          // User thinks way more
}

// Generate milestones based on total sessions
function generateMilestones(totalSessions: number, goalTitle: string): Milestone[] {
  const milestones: Milestone[] = [];
  const milestoneCount = Math.min(5, Math.max(2, Math.floor(totalSessions / 10)));
  const interval = Math.floor(totalSessions / (milestoneCount + 1));

  const milestoneNames = [
    'Foundation laid',
    'Building momentum',
    'Halfway point',
    'Final stretch',
    'Almost there',
  ];

  for (let i = 0; i < milestoneCount; i++) {
    milestones.push({
      id: generateId(),
      title: milestoneNames[i] || `Checkpoint ${i + 1}`,
      session_target: interval * (i + 1),
      completed: false,
    });
  }

  return milestones;
}

// Main estimation function
export function estimateEffort(input: EstimationInput): EstimationOutput {
  const classification = classifyGoal(input.goal);

  // Calculate adjustment factor
  const skillMod = getSkillModifier(input.experience_level);
  const consistencyMod = getConsistencyModifier(input.consistency_level);
  const adjustmentFactor = 1.0 + skillMod + consistencyMod;

  // Apply hybrid estimation
  let estimatedSessions = Math.round(classification.baseSessions * adjustmentFactor);

  // Clamp to bounds
  estimatedSessions = Math.max(5, Math.min(500, estimatedSessions));

  // Calculate recommended sessions per day based on availability
  const maxSessionsPerDay = Math.floor(input.daily_availability * 60 / 30); // 25min + 5min break
  const recommendedPerDay = Math.max(1, Math.min(maxSessionsPerDay, Math.ceil(estimatedSessions / 30)));

  // Calculate estimated days
  let estimatedDays = Math.ceil(estimatedSessions / recommendedPerDay);

  // If deadline exists, adjust
  if (input.deadline) {
    const deadlineDate = new Date(input.deadline);
    const now = new Date();
    const daysAvailable = Math.max(1, Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    if (estimatedDays > daysAvailable) {
      // Need to increase daily sessions
      const needed = Math.ceil(estimatedSessions / daysAvailable);
      estimatedDays = daysAvailable;
    }
  }

  // Adjust confidence based on user time bias
  const timeBias = calculateTimeBias(input.user_time_estimate, estimatedSessions);
  let confidence = classification.confidence;
  if (Math.abs(timeBias) > 1) confidence -= 0.1;

  // Apply time bias to final estimate
  if (timeBias !== 0) {
    const biasAdjustment = 1 + (timeBias * 0.1); // ±10% per bias unit
    estimatedSessions = Math.round(estimatedSessions * biasAdjustment);
    estimatedSessions = Math.max(5, Math.min(500, estimatedSessions));
  }

  const milestones = generateMilestones(estimatedSessions, input.goal);

  return {
    goal: input.goal,
    estimated_sessions: estimatedSessions,
    confidence_score: Math.max(0.3, Math.min(0.95, confidence)),
    difficulty: classification.difficulty,
    recommended_sessions_per_day: recommendedPerDay,
    estimated_days: estimatedDays,
    milestones,
  };
}

// Adaptive Recalibration Engine
// Only applies meaningful recalibration after 5+ sessions
export function recalibrate(goal: Goal): RecalibrationResult {
  const {
    sessions_completed,
    estimated_sessions_current,
    estimated_sessions_initial,
    feedback_bias_log,
    recommended_sessions_per_day,
  } = goal;

  const remaining = estimated_sessions_current - sessions_completed;

  // Guard: don't recalibrate until we have enough data (5+ sessions)
  if (sessions_completed < 5) {
    const daysToComplete = Math.ceil(remaining / Math.max(1, recommended_sessions_per_day));
    const completionDate = new Date();
    completionDate.setDate(completionDate.getDate() + daysToComplete);
    return {
      remaining_sessions: remaining,
      completion_date: completionDate.toISOString(),
      daily_target: recommended_sessions_per_day,
      adaptive_factor: 1.0,
      status: 'on_track',
    };
  }

  // Performance factor: actual pace vs expected
  const daysSinceStart = Math.max(1,
    (Date.now() - new Date(goal.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );
  const actualPace = sessions_completed / daysSinceStart;
  const expectedPace = recommended_sessions_per_day;
  const performanceFactor = expectedPace > 0 ? actualPace / expectedPace : 1;

  // Rolling feedback bias (weighted average, recent entries count more)
  let rollingFeedbackBias = 0;
  if (feedback_bias_log.length > 0) {
    const recentEntries = feedback_bias_log.slice(-5);
    const totalWeight = recentEntries.reduce((sum, _, i) => sum + (i + 1), 0);
    rollingFeedbackBias = recentEntries.reduce((sum, entry, i) => {
      return sum + (entry.bias * (i + 1)) / totalWeight;
    }, 0);
  }

  // Trend adjustment: is user accelerating or decelerating?
  let trendAdjustment = 0;
  if (feedback_bias_log.length >= 2) {
    const recent = feedback_bias_log.slice(-3);
    const biases = recent.map(e => e.bias);
    const avgRecent = biases.reduce((a, b) => a + b, 0) / biases.length;
    if (avgRecent < -0.5) trendAdjustment = -0.1; // User consistently says less time
    if (avgRecent > 0.5) trendAdjustment = 0.1;   // User consistently says more time
  }

  // Combined adaptive factor
  let adaptiveFactor = 1.0;
  if (performanceFactor > 0) {
    adaptiveFactor = (1 / performanceFactor) + (rollingFeedbackBias * 0.1) + trendAdjustment;
  }

  // Guardrail: max 25% change per recalibration
  adaptiveFactor = Math.max(0.75, Math.min(1.25, adaptiveFactor));

  // New remaining sessions
  let newRemaining = Math.round(remaining * adaptiveFactor);

  // Floor/ceiling guards
  if (newRemaining < 1 && sessions_completed < estimated_sessions_initial) {
    newRemaining = 1;
  }
  // Cap at 2x initial estimate
  const maxTotal = estimated_sessions_initial * 2;
  if (sessions_completed + newRemaining > maxTotal) {
    newRemaining = maxTotal - sessions_completed;
  }
  // Minimum floor
  if (newRemaining < 0) newRemaining = 0;

  // Calculate new daily target
  const dailyTarget = Math.max(1, Math.min(
    Math.ceil(newRemaining / Math.max(1, Math.ceil(newRemaining / recommended_sessions_per_day))),
    recommended_sessions_per_day + 2
  ));

  // Calculate completion date
  const daysToComplete = Math.ceil(newRemaining / dailyTarget);
  const completionDate = new Date();
  completionDate.setDate(completionDate.getDate() + daysToComplete);

  // Determine pace status
  let status: RecalibrationResult['status'] = 'on_track';
  if (performanceFactor > 1.2) status = 'ahead';
  else if (performanceFactor < 0.6) status = 'behind';
  else if (Math.abs(adaptiveFactor - 1) > 0.1) status = 'adjusting';

  return {
    remaining_sessions: newRemaining,
    completion_date: completionDate.toISOString(),
    daily_target: dailyTarget,
    adaptive_factor: adaptiveFactor,
    status,
  };
}

// Check if feedback should be triggered
export function shouldTriggerFeedback(goal: Goal): boolean {
  const { sessions_completed, feedback_bias_log, milestones } = goal;

  // After 3 sessions (first time)
  if (sessions_completed === 3 && feedback_bias_log.length === 0) return true;

  // Every 10 sessions
  if (sessions_completed > 0 && sessions_completed % 10 === 0) return true;

  // After milestones
  const justCompletedMilestone = milestones.find(
    m => m.session_target === sessions_completed && !m.completed
  );
  if (justCompletedMilestone) return true;

  // If pace dropped significantly (no sessions in 3 days)
  // This would need session history check - simplified here

  return false;
}
