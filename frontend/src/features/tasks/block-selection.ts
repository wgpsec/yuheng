export type BlockPointerRange = {
  from: number;
  to: number;
  top: number;
  bottom: number;
};

export type BlockSelectionRange = {
  anchor: number;
  from: number;
  to: number;
};

export function canStartBlockSelection(input: {
  button: number;
  inGutter: boolean;
  inEditableContent: boolean;
}): boolean {
  return input.button === 0 && input.inGutter && !input.inEditableContent;
}

export function blockAtPointerY<T extends BlockPointerRange>(blocks: T[], pointerY: number): T | null {
  if (blocks.length === 0) return null;
  if (pointerY <= blocks[0].top) return blocks[0];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (pointerY <= block.bottom) return block;
    const next = blocks[index + 1];
    if (next && pointerY < next.top) return pointerY < (block.bottom + next.top) / 2 ? block : next;
  }

  return blocks[blocks.length - 1];
}

export function blockAtSelectionStartY<T extends BlockPointerRange>(blocks: T[], pointerY: number): T | null {
  if (blocks.length === 0 || pointerY < blocks[0].top || pointerY > blocks[blocks.length - 1].bottom) return null;
  return blockAtPointerY(blocks, pointerY);
}

export function blockSelectionRange(anchor: BlockPointerRange, current: BlockPointerRange): BlockSelectionRange {
  return {
    anchor: anchor.from,
    from: Math.min(anchor.from, current.from),
    to: Math.max(anchor.to, current.to),
  };
}

export function autoScrollDelta(pointerY: number, viewport: { top: number; bottom: number }, edge = 56, maximum = 18): number {
  if (pointerY < viewport.top + edge) {
    return -Math.min(maximum, Math.max(0, ((viewport.top + edge - pointerY) / edge) * maximum));
  }
  if (pointerY > viewport.bottom - edge) {
    return Math.min(maximum, Math.max(0, ((pointerY - (viewport.bottom - edge)) / edge) * maximum));
  }
  return 0;
}

export function frameAdjustedScrollDelta(deltaAt60Hz: number, elapsedMs: number): number {
  return deltaAt60Hz * Math.min(32, Math.max(0, elapsedMs)) / (1000 / 60);
}
