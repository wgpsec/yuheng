import type { Note } from '../../contracts/desktop-bridge';

export type NoteDropPlacement = 'before' | 'inside' | 'after';
export type NoteDropTarget = { parentId: string | null; targetId?: string };

export function noteDropPlacementFromPointer(pointerY: number, rowTop: number, rowHeight: number): NoteDropPlacement {
  const ratio = (pointerY - rowTop) / Math.max(1, rowHeight);
  if (ratio < 0.25) return 'before';
  if (ratio > 0.75) return 'after';
  return 'inside';
}

export function resolveNoteDrop(notes: Note[], draggedId: string, targetId: string, placement: NoteDropPlacement): NoteDropTarget | null {
  if (draggedId === targetId) return null;
  const dragged = notes.find((note) => note.id === draggedId);
  const target = notes.find((note) => note.id === targetId);
  if (!dragged || !target) return null;
  let ancestor: string | null = target.parentId;
  while (ancestor) {
    if (ancestor === draggedId) return null;
    ancestor = notes.find((note) => note.id === ancestor)?.parentId ?? null;
  }
  if (placement === 'inside') return { parentId: target.id };
  if (placement === 'before') return { parentId: target.parentId, targetId: target.id };
  const next = notes
    .filter((note) => note.parentId === target.parentId && note.id !== draggedId)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .find((note) => note.position > target.position);
  return next ? { parentId: target.parentId, targetId: next.id } : { parentId: target.parentId };
}
