export type PetAnimationState = 'idle' | 'working' | 'celebrate';

export const CODEX_PET_ANIMATIONS: Record<PetAnimationState, { row: number; durations: readonly number[] }> = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  working: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  celebrate: { row: 3, durations: [140, 140, 140, 280] },
};

export function nextCodexPetFrame(state: PetAnimationState, frame: number): number {
  return (frame + 1) % CODEX_PET_ANIMATIONS[state].durations.length;
}
