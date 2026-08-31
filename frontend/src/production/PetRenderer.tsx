import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CodexPetManifest, DesktopPetConfig, PetFeedback, PetState } from '../contracts/desktop-bridge';
import { animationForState, idleAnimationDelay, nextCodexPetFrame } from './pet-animation';
import { INITIAL_PET_FEEDBACK_PRESENTATION, presentPetFeedback, resolvePetFeedback } from './pet-feedback-presentation';

function playPetFeedbackSound(state: PetState): void {
  const AudioContextConstructor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return;
  try {
    const context = new AudioContextConstructor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startedAt = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.value = state === 'error' ? 280 : state === 'attention' ? 520 : 660;
    gain.gain.setValueAtTime(0.0001, startedAt);
    gain.gain.exponentialRampToValueAtTime(0.07, startedAt + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.addEventListener('ended', () => { void context.close(); }, { once: true });
    oscillator.start(startedAt);
    oscillator.stop(startedAt + 0.19);
  } catch {
    // Audio feedback is optional and must never interrupt the Pet runtime.
  }
}

/** A deliberately self-contained pet surface so the floating window works offline. */
export function PetRenderer() {
  const bridge = typeof window !== 'undefined' ? window.desktopBridge : undefined;
  const [state, setState] = useState<PetState>('idle');
  const [feedbackPresentation, setFeedbackPresentation] = useState(INITIAL_PET_FEEDBACK_PRESENTATION);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [codexPet, setCodexPet] = useState<{ manifest: CodexPetManifest; dataUrl: string } | null>(null);
  const [spriteFrame, setSpriteFrame] = useState(0);
  const [petScale, setPetScale] = useState(1);
  const [petLocked, setPetLocked] = useState(false);
  const petConfigRef = useRef<DesktopPetConfig>({ enabled: true });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!bridge) return undefined;
    return bridge.pet.onState(setState);
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return undefined;
    return bridge.pet.onFeedback((next) => {
      const now = Date.now();
      const decision = resolvePetFeedback(petConfigRef.current, next, now);
      if (decision.playSound && document.visibilityState === 'visible') playPetFeedbackSound(next.state);
      if (!decision.showBubble) {
        setFeedbackPresentation((current) => ({ ...current, feedback: null }));
        return;
      }
      setFeedbackPresentation((current) => presentPetFeedback(current, next, now));
    });
  }, [bridge]);

  useEffect(() => {
    let cancelled = false;
    if (!bridge) return undefined;
    const load = async (requested?: DesktopPetConfig) => {
      try {
        const config = requested ?? await bridge.pet.get();
        petConfigRef.current = config;
        setPetScale(typeof config.scale === 'number' ? Math.min(1.4, Math.max(0.8, config.scale)) : 1);
        setPetLocked(config.locked === true);
        setFeedbackPresentation((current) => current.feedback && !resolvePetFeedback(config, current.feedback, Date.now()).showBubble
          ? { ...current, feedback: null }
          : current);
        const manifests = await bridge.pet.list();
        const selected = config.petId ? manifests.find((item) => item.id === config.petId) : undefined;
        if (!cancelled) setCodexPet(selected ? await bridge.pet.asset(selected.id) : null);
      } catch { if (!cancelled) setCodexPet(null); }
    };
    void load();
    const stopConfig = bridge.pet.onConfig((config) => { void load(config); });
    return () => { cancelled = true; stopConfig(); };
  }, [bridge]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibilityChange = () => setIsDocumentVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    onVisibilityChange();
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', onChange);
    onChange();
    return () => preference.removeEventListener('change', onChange);
  }, []);

  useEffect(() => { setSpriteFrame(0); }, [codexPet, state]);

  useEffect(() => {
    const feedback = feedbackPresentation.feedback;
    if (!feedback || feedback.state === 'thinking' || feedback.state === 'working' || feedback.state === 'attention') return undefined;
    const timeout = window.setTimeout(() => setFeedbackPresentation((current) => ({ ...current, feedback: null })), feedback.state === 'celebrate' ? 1_800 : feedback.state === 'error' ? 4_200 : 1_600);
    return () => window.clearTimeout(timeout);
  }, [feedbackPresentation.feedback]);

  useEffect(() => {
    if (!codexPet || !isDocumentVisible || reducedMotion) return undefined;
    const animation = animationForState(state, codexPet.manifest.animations);
    const frameDuration = animation.durations[spriteFrame] ?? animation.durations[0];
    const delay = state === 'idle' ? idleAnimationDelay(spriteFrame, animation.durations.length - 1, frameDuration) : frameDuration;
    const timer = window.setTimeout(() => setSpriteFrame((frame) => nextCodexPetFrame(state, frame, codexPet.manifest.animations)), delay);
    return () => window.clearTimeout(timer);
  }, [codexPet, isDocumentVisible, reducedMotion, spriteFrame, state]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (petLocked) return;
    suppressClickRef.current = false;
    dragRef.current = { pointerId: event.pointerId, startX: event.screenX, startY: event.screenY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    bridge?.pet.beginDrag(event.screenX, event.screenY);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) < 4) return;
    drag.moved = true;
    bridge?.pet.dragTo(event.screenX, event.screenY);
  };
  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    bridge?.pet.endDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.moved) { suppressClickRef.current = true; void bridge?.pet.focusMain(visibleFeedback?.openTarget); }
  };
  const handleClick = () => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    void bridge?.pet.focusMain(visibleFeedback?.openTarget);
  };
  const animation = animationForState(state, codexPet?.manifest.animations);
  const visibleSpriteFrame = spriteFrame % animation.durations.length;
  const feedback: PetFeedback | null = feedbackPresentation.feedback;
  const visibleFeedback = feedback;

  return (
    <main
      className={`desktop-pet desktop-pet-${state} ${isDocumentVisible ? '' : 'desktop-pet-paused'}`}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onClick={handleClick}
      onDragStart={(event) => event.preventDefault()}
    >
      <div className="desktop-pet-button" title="拖动玉衡宠物" style={{ transform: `scale(${petScale})` }}>
        <span
          className="desktop-pet-click-target"
          role="button"
          tabIndex={0}
          aria-label="打开玉衡"
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              void bridge?.pet.focusMain(visibleFeedback?.openTarget);
            }
          }}
        >
          <span className="desktop-pet-aura" aria-hidden="true" />
          <span className={`desktop-pet-character ${codexPet ? 'desktop-pet-codex' : ''}`} aria-hidden="true">
            {codexPet ? <span
              className="desktop-pet-sprite"
              style={{
                backgroundImage: `url(${codexPet.dataUrl})`,
                backgroundSize: `${codexPet.manifest.columns * codexPet.manifest.cellWidth}px ${codexPet.manifest.rows * codexPet.manifest.cellHeight}px`,
                backgroundPosition: `-${visibleSpriteFrame * codexPet.manifest.cellWidth}px -${animation.row * codexPet.manifest.cellHeight}px`,
              }}
            /> : <svg viewBox="0 0 120 120" role="presentation">
              <path className="pet-body" d="M60 15c-20 0-35 14-35 34v27c0 17 13 29 35 29s35-12 35-29V49c0-20-15-34-35-34Z" />
              <path className="pet-ear" d="M34 35 20 22c-3-3-8 0-7 4l5 20m68-11 14-13c3-3 8 0 7 4l-5 20" />
              <path className="pet-face" d="M35 61c0-15 11-25 25-25s25 10 25 25v10c0 14-11 24-25 24S35 85 35 71V61Z" />
              <circle className="pet-eye" cx="48" cy="64" r="4" />
              <circle className="pet-eye" cx="72" cy="64" r="4" />
              <path className="pet-mouth" d="M54 77c4 4 8 4 12 0" />
              <path className="pet-scarf" d="M29 85c9 7 19 10 31 10s22-3 31-10v13c-9 7-19 10-31 10s-22-3-31-10V85Z" />
              <circle className="pet-badge" cx="60" cy="101" r="5" />
            </svg>}
          </span>
          {visibleFeedback && <div className={`desktop-pet-feedback desktop-pet-feedback-${visibleFeedback.state}`} role="status" aria-live="polite">
            <strong>{visibleFeedback.label}</strong>
            {visibleFeedback.detail && <small>{visibleFeedback.detail}</small>}
            {visibleFeedback.conversationId && <span>点击打开相关会话</span>}
          </div>}
          {state === 'working' && <span className="desktop-pet-status" aria-label="玉衡正在工作"><i /><i /><i /></span>}
          {state === 'celebrate' && <span className="desktop-pet-sparkles" aria-hidden="true"><i /><i /><i /><i /></span>}
        </span>
      </div>
    </main>
  );
}
