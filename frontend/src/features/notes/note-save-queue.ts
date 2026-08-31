import type { Note } from '../../contracts/desktop-bridge';

export type NoteSaveSnapshot = Pick<Note, 'title' | 'content' | 'icon' | 'cover' | 'properties'>;
export type NoteSaveStatus = 'saved' | 'saving' | 'failed';

export function noteSaveStatus(hasUnsavedChanges: boolean, failed: boolean): NoteSaveStatus {
  if (failed) return 'failed';
  return hasUnsavedChanges ? 'saving' : 'saved';
}

type PendingSave = { snapshot: NoteSaveSnapshot; version: number };

export type NoteSaveQueueOptions = {
  save: (noteId: string, snapshot: NoteSaveSnapshot) => Promise<Note>;
  onSaved?: (note: Note) => void;
  onError?: (noteId: string, error: unknown) => void;
};

/** Serializes note writes while allowing a newer edit to supersede an older response. */
export class NoteSaveQueue {
  private readonly pending = new Map<string, PendingSave>();
  private readonly active = new Map<string, Promise<void>>();
  private readonly versions = new Map<string, number>();

  constructor(private readonly options: NoteSaveQueueOptions) {}

  enqueue(noteId: string, snapshot: NoteSaveSnapshot): void {
    const version = (this.versions.get(noteId) ?? 0) + 1;
    this.versions.set(noteId, version);
    this.pending.set(noteId, { snapshot: { ...snapshot }, version });
    this.start(noteId);
  }

  retry(noteId: string): void {
    if (this.pending.has(noteId)) this.start(noteId);
  }

  hasPending(noteId?: string): boolean {
    return noteId ? this.pending.has(noteId) || this.active.has(noteId) : this.pending.size > 0 || this.active.size > 0;
  }

  async flush(noteId?: string): Promise<void> {
    while (true) {
      const ids = noteId ? [noteId] : [...new Set([...this.pending.keys(), ...this.active.keys()])];
      ids.forEach((id) => this.start(id));
      const active = ids.map((id) => this.active.get(id)).filter((value): value is Promise<void> => Boolean(value));
      if (active.length === 0) return;
      await Promise.all(active);
      // A newer version may have been started by the completed request's finally block.
      if (ids.some((id) => this.active.has(id))) continue;
      // A failed request stays pending for an explicit retry. Do not spin on it.
      return;
    }
  }

  private start(noteId: string): void {
    if (this.active.has(noteId)) return;
    const item = this.pending.get(noteId);
    if (!item) return;
    const request = this.options.save(noteId, item.snapshot)
      .then((saved) => {
        const current = this.pending.get(noteId);
        if (!current || current.version !== item.version) return;
        this.pending.delete(noteId);
        this.options.onSaved?.(saved);
      })
      .catch((error: unknown) => {
        const current = this.pending.get(noteId);
        if (current?.version === item.version) this.options.onError?.(noteId, error);
      })
      .finally(() => {
        this.active.delete(noteId);
        const current = this.pending.get(noteId);
        if (current && current.version !== item.version) this.start(noteId);
      });
    this.active.set(noteId, request);
  }
}

export const NOTE_DRAFT_KEY_PREFIX = 'yuheng-note-draft:';

export function noteDraftKey(noteId: string): string {
  return `${NOTE_DRAFT_KEY_PREFIX}${noteId}`;
}

export function saveNoteDraft(storage: Pick<Storage, 'setItem'> | undefined, noteId: string, snapshot: NoteSaveSnapshot): void {
  if (!storage) return;
  storage.setItem(noteDraftKey(noteId), JSON.stringify({ ...snapshot, savedAt: new Date().toISOString() }));
}

export function readNoteDraft(storage: Pick<Storage, 'getItem'> | undefined, noteId: string): NoteSaveSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(noteDraftKey(noteId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<NoteSaveSnapshot>;
    if (typeof value.title !== 'string' || typeof value.content !== 'string') return null;
    return { title: value.title, content: value.content, icon: typeof value.icon === 'string' ? value.icon : null, cover: typeof value.cover === 'string' ? value.cover : null, properties: value.properties && typeof value.properties === 'object' ? value.properties as Note['properties'] : { status: null, date: null, tags: [] } };
  } catch { return null; }
}

export function clearNoteDraft(storage: Pick<Storage, 'removeItem'> | undefined, noteId: string): void {
  storage?.removeItem(noteDraftKey(noteId));
}

export function noteSnapshotEqual(left: NoteSaveSnapshot, right: NoteSaveSnapshot): boolean {
  return left.title === right.title && left.content === right.content && left.icon === right.icon && left.cover === right.cover && JSON.stringify(left.properties) === JSON.stringify(right.properties);
}
