import type { Note } from '../../contracts/desktop-bridge';

export type NoteTreeNode = Note & { children: NoteTreeNode[] };

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

export function getNotePath(notes: Note[], noteId: string): Note[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const path: Note[] = [];
  const visited = new Set<string>();
  let current = byId.get(noteId);
  while (current && !visited.has(current.id)) {
    path.unshift(current);
    visited.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function buildNoteTree(notes: Note[]): NoteTreeNode[] {
  const byId = new Map<string, NoteTreeNode>();
  for (const note of notes) byId.set(note.id, { ...note, children: [] });
  const roots: NoteTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (items: NoteTreeNode[]) => {
    items.sort((left, right) => Number(left.parentId !== null) - Number(right.parentId !== null) || left.position - right.position || left.id.localeCompare(right.id));
    items.forEach((item) => sort(item.children));
  };
  sort(roots);
  return roots;
}
