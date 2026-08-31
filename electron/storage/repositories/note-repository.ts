import crypto from 'node:crypto';
import type { CreateNoteInput, Note, NoteProperties, NoteVersion, UpdateNoteInput } from '../../store';
import { RepositoryBase } from './repository-base';

type Row = Record<string, unknown>;

const NOTE_COVER_ID_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;
const NOTE_COVER_URL_PATTERN = /^yuheng-note-cover:\/\/local\/[0-9a-f-]{36}\.(?:png|jpg|webp)$/i;

export type NoteRepositoryRow = Note;

export class NoteRepository extends RepositoryBase {

  list(includeArchived = false): Note[] {
    const query = includeArchived
      ? `SELECT id, parent_id AS parentId, title, content, icon, cover, properties_json AS propertiesJson, position, archived,
          favorite, last_opened_at AS lastOpenedAt, created_at AS createdAt, updated_at AS updatedAt FROM notes
          ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, parent_id, position, id`
      : `WITH RECURSIVE archived_tree(id) AS (
          SELECT id FROM notes WHERE archived = 1
          UNION ALL SELECT notes.id FROM notes JOIN archived_tree ON notes.parent_id = archived_tree.id
        )
        SELECT id, parent_id AS parentId, title, content, icon, cover, properties_json AS propertiesJson, position, archived,
          favorite, last_opened_at AS lastOpenedAt, created_at AS createdAt, updated_at AS updatedAt FROM notes
          WHERE archived = 0 AND id NOT IN (SELECT id FROM archived_tree)
          ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, parent_id, position, id`;
    return (this.db.prepare(query).all() as Row[]).map((row) => this.mapNote(row));
  }

  get(id: string): Note | null {
    const row = this.db.prepare(`SELECT id, parent_id AS parentId, title, content, icon, cover, properties_json AS propertiesJson,
      position, archived, favorite, last_opened_at AS lastOpenedAt, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE id = ?`).get(id) as Row | undefined;
    return row ? this.mapNote(row) : null;
  }

  create(input?: CreateNoteInput | string, parentId?: string | null): Note {
    const values = typeof input === 'string' ? { title: input, parentId } : { ...(input ?? {}), ...(parentId !== undefined ? { parentId } : {}) };
    const title = typeof values.title === 'string' && values.title.trim() ? values.title.trim() : '未命名笔记';
    const content = typeof values.content === 'string' ? values.content : '';
    const icon = typeof values.icon === 'string' ? values.icon.trim().slice(0, 32) || null : null;
    const normalizedParentId = values.parentId == null ? null : String(values.parentId);
    if (normalizedParentId && !this.db.prepare('SELECT 1 FROM notes WHERE id = ?').get(normalizedParentId)) throw new Error('Parent note not found.');
    const id = crypto.randomUUID();
    const position = Number((this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM notes WHERE parent_id IS ?').get(normalizedParentId) as Row).position);
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO notes (id, parent_id, title, content, icon, cover, properties_json, position, archived, favorite, last_opened_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, '{}', ?, 0, 0, NULL, ?, ?)")
      .run(id, normalizedParentId, title, content, icon, position, now, now);
    return this.get(id)!;
  }

  update(id: string, patch: UpdateNoteInput): Note {
    const current = this.get(id);
    if (!current) throw new Error('Note not found.');
    const title = patch.title === undefined ? current.title : patch.title.trim();
    if (!title) throw new Error('Note title is required.');
    const content = patch.content === undefined ? current.content : patch.content;
    const icon = patch.icon === undefined ? current.icon : patch.icon == null ? null : patch.icon.trim() || null;
    const cover = patch.cover === undefined ? current.cover : normalizeNoteCover(patch.cover);
    const archived = patch.archived === undefined ? current.archived : patch.archived === true;
    const favorite = patch.favorite === undefined ? current.favorite : patch.favorite === true;
    const properties = patch.properties === undefined ? current.properties : normalizeNoteProperties(patch.properties);
    const updatedAt = new Date().toISOString();
    const visibleChanged = title !== current.title || content !== current.content || icon !== current.icon || cover !== current.cover || JSON.stringify(properties) !== JSON.stringify(current.properties);
    this.transaction(() => {
      if (visibleChanged) this.recordVersion(current, updatedAt);
      this.db.prepare('UPDATE notes SET title = ?, content = ?, icon = ?, cover = ?, properties_json = ?, archived = ?, favorite = ?, updated_at = ? WHERE id = ?')
        .run(title, content, icon, cover, JSON.stringify(properties), archived ? 1 : 0, favorite ? 1 : 0, updatedAt, id);
    });
    return this.get(id)!;
  }

  listVersions(noteId: string): NoteVersion[] {
    if (!this.get(noteId)) throw new Error('Note not found.');
    return (this.db.prepare(`SELECT id, note_id AS noteId, title, content, icon, cover, properties_json AS propertiesJson, created_at AS createdAt
      FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, rowid DESC`).all(noteId) as Row[]).map((row) => ({
      id: String(row.id), noteId: String(row.noteId), title: String(row.title), content: String(row.content ?? ''),
      icon: row.icon == null ? null : String(row.icon), cover: normalizeNoteCover(row.cover), properties: normalizeNoteProperties(row.propertiesJson), createdAt: String(row.createdAt),
    }));
  }

  restoreVersion(noteId: string, versionId: string): Note {
    const current = this.get(noteId);
    if (!current) throw new Error('Note not found.');
    const row = this.db.prepare('SELECT id, note_id AS noteId, title, content, icon, cover, properties_json AS propertiesJson FROM note_versions WHERE id = ? AND note_id = ?').get(versionId, noteId) as Row | undefined;
    if (!row) throw new Error('Note version not found.');
    const updatedAt = new Date().toISOString();
    this.transaction(() => {
      this.recordVersion(current, updatedAt);
      this.db.prepare('UPDATE notes SET title = ?, content = ?, icon = ?, cover = ?, properties_json = ?, updated_at = ? WHERE id = ?')
        .run(String(row.title), String(row.content ?? ''), row.icon == null ? null : String(row.icon), normalizeNoteCover(row.cover), JSON.stringify(normalizeNoteProperties(row.propertiesJson)), updatedAt, noteId);
    });
    return this.get(noteId)!;
  }

  touch(id: string): Note {
    if (!this.get(id)) throw new Error('Note not found.');
    this.db.prepare('UPDATE notes SET last_opened_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    return this.get(id)!;
  }

  moveBlock(sourceId: string, targetId: string, sourceContent: string, blockMarkdown: string): { source: Note; target: Note } {
    if (sourceId === targetId) throw new Error('Target note must be different from source note.');
    const source = this.get(sourceId);
    const target = this.get(targetId);
    if (!source || !target) throw new Error('Note not found.');
    const block = blockMarkdown.trim();
    if (!block) throw new Error('Block content is required.');
    const nextTargetContent = target.content.trimEnd() ? `${target.content.trimEnd()}\n\n${block}` : block;
    const updatedAt = new Date().toISOString();
    this.transaction(() => {
      this.recordVersion(source, updatedAt);
      this.recordVersion(target, updatedAt);
      this.db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?').run(sourceContent, updatedAt, sourceId);
      this.db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?').run(nextTargetContent, updatedAt, targetId);
    });
    return { source: this.get(sourceId)!, target: this.get(targetId)! };
  }

  move(id: string, parentId: string | null = null, targetId?: string): Note {
    const note = this.get(id);
    if (!note) throw new Error('Note not found.');
    if (parentId === id) throw new Error('A note cannot be moved into itself.');
    if (parentId !== null && !this.get(parentId)) throw new Error('Parent note not found.');
    let ancestor = parentId;
    while (ancestor) {
      if (ancestor === id) throw new Error('A note cannot be moved into its descendant.');
      const row = this.db.prepare('SELECT parent_id AS parentId FROM notes WHERE id = ?').get(ancestor) as Row | undefined;
      ancestor = row?.parentId == null ? null : String(row.parentId);
    }
    if (targetId && targetId !== id) {
      const target = this.get(targetId);
      if (!target || target.parentId !== parentId) throw new Error('Target note not found.');
    }
    const siblings = this.list(true).filter((item) => item.parentId === parentId && item.id !== id);
    const targetIndex = targetId && targetId !== id ? siblings.findIndex((item) => item.id === targetId) : -1;
    siblings.splice(targetIndex < 0 ? siblings.length : targetIndex, 0, note);
    this.transaction(() => {
      this.db.prepare('UPDATE notes SET parent_id = ?, updated_at = ? WHERE id = ?').run(parentId, new Date().toISOString(), id);
      const update = this.db.prepare('UPDATE notes SET position = ? WHERE id = ?');
      siblings.forEach((item, position) => update.run(position, item.id));
    });
    return this.get(id)!;
  }

  delete(id: string): void {
    const note = this.get(id);
    if (!note) throw new Error('Note not found.');
    this.transaction(() => {
      const result = this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
      if (Number(result.changes) === 0) throw new Error('Note not found.');
      const siblings = this.db.prepare('SELECT id FROM notes WHERE parent_id IS ? ORDER BY position ASC, id ASC').all(note.parentId) as Row[];
      const update = this.db.prepare('UPDATE notes SET position = ? WHERE id = ?');
      siblings.forEach((row, position) => update.run(position, String(row.id)));
    });
  }

  private recordVersion(note: Pick<Note, 'id' | 'title' | 'content' | 'icon' | 'cover' | 'properties'>, createdAt: string): void {
    this.db.prepare('INSERT INTO note_versions (id, note_id, title, content, icon, cover, properties_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), note.id, note.title, note.content, note.icon, note.cover, JSON.stringify(note.properties), createdAt);
    this.db.prepare(`DELETE FROM note_versions WHERE id IN (
      SELECT id FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET 50
    )`).run(note.id);
  }

  private mapNote(row: Row): Note {
    return {
      id: String(row.id), parentId: row.parentId == null ? null : String(row.parentId), title: String(row.title), content: String(row.content ?? ''),
      icon: row.icon == null ? null : String(row.icon), cover: normalizeNoteCover(row.cover), position: Number(row.position ?? 0), archived: Number(row.archived) === 1,
      favorite: Number(row.favorite) === 1, lastOpenedAt: row.lastOpenedAt == null ? null : String(row.lastOpenedAt), createdAt: String(row.createdAt), updatedAt: String(row.updatedAt),
      properties: normalizeNoteProperties(row.propertiesJson),
    };
  }

}

export function normalizeNoteCover(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cover = value.trim();
  return NOTE_COVER_ID_PATTERN.test(cover) || NOTE_COVER_URL_PATTERN.test(cover) ? cover : null;
}

export function normalizeNoteProperties(value: unknown): NoteProperties {
  let source: Record<string, unknown> = {};
  try {
    source = typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value && typeof value === 'object' ? value as Record<string, unknown> : {};
  } catch { source = {}; }
  const status = typeof source.status === 'string' ? source.status.trim().slice(0, 80) || null : null;
  const date = typeof source.date === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(source.date) ? source.date : null;
  const tags = Array.isArray(source.tags) ? [...new Set(source.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim().slice(0, 40)).filter(Boolean))].slice(0, 20) : [];
  return { status, date, tags };
}
