export type PetRect = { x: number; y: number; width: number; height: number };
export type PetPoint = { x: number; y: number };
export type PetDisplay = { id: string; bounds: PetRect; workArea: PetRect; primary?: boolean };
export type PetSize = { width: number; height: number };
export type StoredPetPositions = {
  version: 1;
  lastDisplayId?: string;
  byDisplay: Record<string, PetPoint>;
} | PetPoint;

function containsPoint(rect: PetRect, point: PetPoint): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

function primaryDisplay(displays: PetDisplay[]): PetDisplay {
  return displays.find((display) => display.primary) ?? displays[0];
}

export function clampPetPosition(position: PetPoint, display: PetDisplay, size: PetSize): PetPoint {
  const maxX = display.workArea.x + Math.max(0, display.workArea.width - size.width);
  const maxY = display.workArea.y + Math.max(0, display.workArea.height - size.height);
  return {
    x: Math.min(Math.max(Math.round(position.x), display.workArea.x), maxX),
    y: Math.min(Math.max(Math.round(position.y), display.workArea.y), maxY),
  };
}

export function restorePetPosition(saved: StoredPetPositions | undefined, displays: PetDisplay[], size: PetSize): { display: PetDisplay; position: PetPoint } {
  if (displays.length === 0) throw new Error('至少需要一个显示器。');
  const primary = primaryDisplay(displays);
  const state = saved && 'version' in saved && saved.version === 1 ? saved : undefined;
  const legacy = saved && !('version' in saved) ? saved : undefined;
  const rememberedDisplay = state?.lastDisplayId ? displays.find((display) => display.id === state.lastDisplayId) : undefined;
  const rememberedPosition = rememberedDisplay && state?.byDisplay[rememberedDisplay.id];
  const legacyDisplay = legacy ? displays.find((display) => containsPoint(display.bounds, legacy)) : undefined;
  const storedDisplay = state ? displays.find((display) => state.byDisplay[display.id] !== undefined) : undefined;
  const display = rememberedDisplay ?? legacyDisplay ?? storedDisplay ?? primary;
  const rememberedFallback = state?.lastDisplayId ? state.byDisplay[state.lastDisplayId] : undefined;
  const position = rememberedPosition ?? legacy ?? state?.byDisplay[display.id] ?? rememberedFallback ?? {
    x: display.workArea.x + display.workArea.width - size.width - 28,
    y: display.workArea.y + display.workArea.height - size.height - 28,
  };
  return { display, position: clampPetPosition(position, display, size) };
}

export function snapPetPosition(position: PetPoint, display: PetDisplay, size: PetSize, threshold = 18): PetPoint {
  const clamped = clampPetPosition(position, display, size);
  const right = display.workArea.x + display.workArea.width - size.width;
  const bottom = display.workArea.y + display.workArea.height - size.height;
  return {
    x: Math.abs(clamped.x - display.workArea.x) <= threshold ? display.workArea.x : Math.abs(clamped.x - right) <= threshold ? right : clamped.x,
    y: Math.abs(clamped.y - display.workArea.y) <= threshold ? display.workArea.y : Math.abs(clamped.y - bottom) <= threshold ? bottom : clamped.y,
  };
}

export type PetInertiaOptions = { friction?: number; bounce?: boolean; restitution?: number };
export type PetInertiaStep = { position: PetPoint; velocity: PetPoint; done: boolean };

export function stepPetInertia(position: PetPoint, velocity: PetPoint, display: PetDisplay, size: PetSize, options: PetInertiaOptions = {}): PetInertiaStep {
  const friction = Math.min(0.98, Math.max(0.05, options.friction ?? 0.82));
  const restitution = Math.min(0.8, Math.max(0.05, options.restitution ?? 0.35));
  const raw = { x: position.x + velocity.x, y: position.y + velocity.y };
  const next = clampPetPosition(raw, display, size);
  let nextVelocity = { x: velocity.x * friction, y: velocity.y * friction };
  if (options.bounce) {
    if (next.x !== Math.round(raw.x)) nextVelocity = { ...nextVelocity, x: -Math.abs(nextVelocity.x) * restitution * Math.sign(velocity.x || 1) };
    if (next.y !== Math.round(raw.y)) nextVelocity = { ...nextVelocity, y: -Math.abs(nextVelocity.y) * restitution * Math.sign(velocity.y || 1) };
  } else {
    if (next.x !== Math.round(raw.x)) nextVelocity = { ...nextVelocity, x: 0 };
    if (next.y !== Math.round(raw.y)) nextVelocity = { ...nextVelocity, y: 0 };
  }
  const done = Math.hypot(nextVelocity.x, nextVelocity.y) < 0.05;
  return { position: next, velocity: done ? { x: 0, y: 0 } : nextVelocity, done };
}
