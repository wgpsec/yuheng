import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type PetState = 'idle' | 'working' | 'celebrate';

/** A deliberately self-contained pet surface so the floating window works offline. */
export function PetRenderer() {
  const bridge = typeof window !== 'undefined' ? window.desktopBridge : undefined;
  const [state, setState] = useState<PetState>('idle');
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!bridge) return undefined;
    return bridge.pet.onState(setState);
  }, [bridge]);

  useEffect(() => {
    if (state !== 'celebrate') return undefined;
    const timer = window.setTimeout(() => setState('idle'), 1400);
    return () => window.clearTimeout(timer);
  }, [state]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
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
  };

  return (
    <main
      className={`desktop-pet desktop-pet-${state}`}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onDragStart={(event) => event.preventDefault()}
    >
      <div className="desktop-pet-button" title="拖动玉衡宠物">
        <span
          className="desktop-pet-click-target"
          role="button"
          tabIndex={0}
          aria-label="打开玉衡"
          onClick={(event) => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              event.preventDefault();
              return;
            }
            void bridge?.pet.focusMain();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              void bridge?.pet.focusMain();
            }
          }}
        >
          <span className="desktop-pet-aura" aria-hidden="true" />
          <span className="desktop-pet-character" aria-hidden="true">
            <svg viewBox="0 0 120 120" role="presentation">
              <path className="pet-body" d="M60 15c-20 0-35 14-35 34v27c0 17 13 29 35 29s35-12 35-29V49c0-20-15-34-35-34Z" />
              <path className="pet-ear" d="M34 35 20 22c-3-3-8 0-7 4l5 20m68-11 14-13c3-3 8 0 7 4l-5 20" />
              <path className="pet-face" d="M35 61c0-15 11-25 25-25s25 10 25 25v10c0 14-11 24-25 24S35 85 35 71V61Z" />
              <circle className="pet-eye" cx="48" cy="64" r="4" />
              <circle className="pet-eye" cx="72" cy="64" r="4" />
              <path className="pet-mouth" d="M54 77c4 4 8 4 12 0" />
              <path className="pet-scarf" d="M29 85c9 7 19 10 31 10s22-3 31-10v13c-9 7-19 10-31 10s-22-3-31-10V85Z" />
              <circle className="pet-badge" cx="60" cy="101" r="5" />
            </svg>
          </span>
          {state === 'working' && <span className="desktop-pet-status" aria-label="玉衡正在工作"><i /><i /><i /></span>}
          {state === 'celebrate' && <span className="desktop-pet-sparkles" aria-hidden="true"><i /><i /><i /><i /></span>}
        </span>
      </div>
    </main>
  );
}
