import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopBridge, KnowledgeBase } from '../../contracts/desktop-bridge';

const ACTIVE_NOTE_KEY = 'yuheng-active-note';
const ACTIVE_KNOWLEDGE_BASE_KEY = 'yuheng-active-knowledge-base';

export function useNoteWorkspace(bridge: DesktopBridge | undefined) {
  const [activeNoteId, setActiveNoteIdState] = useState<string | null>(() => typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_NOTE_KEY) : null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [activeKnowledgeBaseId, setActiveKnowledgeBaseIdState] = useState<string | null>(() => typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_KNOWLEDGE_BASE_KEY) : null);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    if (!bridge) return;
    const version = ++requestVersionRef.current;
    void Promise.all([bridge.notes.list(true), bridge.notes.knowledgeBases.list(), bridge.notes.knowledgeBases.getActiveId()]).then(([items, bases, persistedId]) => {
      if (version !== requestVersionRef.current) return;
      setTitles(Object.fromEntries(items.map((note) => [note.id, note.title])));
      setKnowledgeBases(bases);
      const stored = persistedId ?? activeKnowledgeBaseId;
      const next = stored && bases.some((base) => base.id === stored) ? stored : bases[0]?.id ?? null;
      setActiveKnowledgeBaseIdState(next);
      if (typeof localStorage !== 'undefined' && next) localStorage.setItem(ACTIVE_KNOWLEDGE_BASE_KEY, next);
      if (next && next !== persistedId) void bridge.notes.knowledgeBases.setActiveId(next).catch(() => undefined);
    }).catch(() => undefined);
    return () => { requestVersionRef.current += 1; };
  }, [bridge]);
  useEffect(() => {
    const handleTitleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; title?: string }>).detail;
      if (detail?.id && typeof detail.title === 'string') setTitles((current) => ({ ...current, [detail.id!]: detail.title! }));
    };
    window.addEventListener('yuheng-note-title-change', handleTitleChange);
    return () => window.removeEventListener('yuheng-note-title-change', handleTitleChange);
  }, []);

  const setActiveNoteId = useCallback((noteId: string | null) => {
    setActiveNoteIdState(noteId);
    if (typeof localStorage !== 'undefined') noteId ? localStorage.setItem(ACTIVE_NOTE_KEY, noteId) : localStorage.removeItem(ACTIVE_NOTE_KEY);
    if (noteId && bridge) {
      const version = ++requestVersionRef.current;
      void bridge.notes.get(noteId).then((note) => { if (note && version === requestVersionRef.current) setTitles((current) => ({ ...current, [note.id]: note.title })); }).catch(() => undefined);
    }
  }, [bridge]);
  const setActiveKnowledgeBaseId = useCallback((id: string | null) => {
    setActiveKnowledgeBaseIdState(id);
    if (typeof localStorage !== 'undefined') id ? localStorage.setItem(ACTIVE_KNOWLEDGE_BASE_KEY, id) : localStorage.removeItem(ACTIVE_KNOWLEDGE_BASE_KEY);
    if (id && bridge) void bridge.notes.knowledgeBases.setActiveId(id).catch(() => undefined);
  }, [bridge]);
  const notifyChanged = useCallback(() => setRevision((value) => value + 1), []);
  return { activeNoteId, setActiveNoteId, titles, revision, notifyChanged, knowledgeBases, activeKnowledgeBaseId, setActiveKnowledgeBaseId };
}
