import type { DesktopPetConfig, PetFeedback } from '../contracts/desktop-bridge';

export type PetFeedbackDecision = {
  showBubble: boolean;
  playSound: boolean;
};

export function resolvePetFeedback(config: DesktopPetConfig, feedback: PetFeedback, now: number): PetFeedbackDecision {
  const important = feedback.state === 'attention' || feedback.state === 'error' || feedback.state === 'celebrate';
  const categoryEnabled = (feedback.state !== 'celebrate' || config.completionFeedback !== false)
    && (feedback.state !== 'error' || config.errorFeedback !== false)
    && (feedback.state !== 'attention' || feedback.kind === 'task_reminder' || config.approvalFeedback !== false);
  const focused = typeof config.mutedUntil === 'number' && config.mutedUntil > now;
  const showBubble = !focused
    && config.feedbackMode !== 'hidden'
    && categoryEnabled
    && (config.feedbackMode !== 'important' || important);
  const playSound = !focused && config.feedbackMode !== 'hidden' && categoryEnabled && important && config.soundEnabled === true;
  return { showBubble, playSound };
}

export type PetFeedbackPresentation = {
  feedback: PetFeedback | null;
  initialReadyShown: boolean;
  lastRoutineFeedbackAt?: number;
};

export const INITIAL_PET_FEEDBACK_PRESENTATION: PetFeedbackPresentation = {
  feedback: null,
  initialReadyShown: false,
};

const ROUTINE_FEEDBACK_COALESCE_MS = 800;

export function presentPetFeedback(current: PetFeedbackPresentation, incoming: PetFeedback, now = Date.now()): PetFeedbackPresentation {
  if (incoming.state === 'idle') {
    if (current.initialReadyShown) return { ...current, feedback: null };
    return { feedback: incoming, initialReadyShown: true };
  }
  const routine = incoming.state === 'thinking' || incoming.state === 'working';
  if (routine
    && (current.feedback?.state === 'thinking' || current.feedback?.state === 'working')
    && current.feedback.runId
    && current.feedback.runId === incoming.runId
    && current.lastRoutineFeedbackAt !== undefined
    && now - current.lastRoutineFeedbackAt < ROUTINE_FEEDBACK_COALESCE_MS) return current;
  return {
    feedback: incoming,
    initialReadyShown: true,
    ...(routine ? { lastRoutineFeedbackAt: now } : {}),
  };
}
