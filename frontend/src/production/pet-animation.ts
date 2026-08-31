export type PetAnimationState = 'idle' | 'thinking' | 'working' | 'attention' | 'error' | 'celebrate';

// Keep this legacy export stable for callers that only know the original three states.
export const CODEX_PET_ANIMATIONS = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  working: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  celebrate: { row: 3, durations: [140, 140, 140, 280] },
} as const;

export const PET_ANIMATIONS: Record<PetAnimationState, { row: number; durations: readonly number[] }> = {
  ...CODEX_PET_ANIMATIONS,
  thinking: { row: 6, durations: [180, 130, 130, 180, 240] },
  attention: { row: 4, durations: [160, 160, 240, 240] },
  error: { row: 5, durations: [180, 180, 180, 300] },
};

export function animationForState(state: PetAnimationState, overrides?: Partial<Record<PetAnimationState, { row: number; durations: readonly number[] }>>) {
  return overrides?.[state] ?? PET_ANIMATIONS[state];
}

export function nextCodexPetFrame(
  state: PetAnimationState,
  frame: number,
  overrides?: Partial<Record<PetAnimationState, { row: number; durations: readonly number[] }>>,
): number {
  return (frame + 1) % animationForState(state, overrides).durations.length;
}

/** Add a bounded pause between idle loops so optional idle effects never run continuously. */
export function idleAnimationDelay(frame: number, lastFrame: number, duration: number, random: () => number = Math.random): number {
  if (frame !== lastFrame) return duration;
  const raw = random();
  const sample = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
  return duration + 1_200 + Math.round(sample * 2_000);
}
