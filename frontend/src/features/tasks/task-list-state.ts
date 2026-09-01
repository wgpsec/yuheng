import type { Task } from '../../contracts/desktop-bridge';

/**
 * Merge a task change into the active board without deriving order from
 * updatedAt. Same-column edits keep their existing position; moves and new
 * tasks are appended to the target column, matching the repository's
 * position semantics.
 */
export function mergeTaskChange(current: Task[], changed: Task, activeBoardId: string): Task[] {
  const existingIndex = current.findIndex((task) => task.id === changed.id);

  if (changed.boardId !== activeBoardId) {
    return existingIndex < 0 ? current : current.filter((task) => task.id !== changed.id);
  }

  if (existingIndex < 0) return [...current, changed];

  const existing = current[existingIndex];
  if (existing.status !== changed.status) {
    return [...current.slice(0, existingIndex), ...current.slice(existingIndex + 1), changed];
  }

  return current.map((task, index) => index === existingIndex ? changed : task);
}
