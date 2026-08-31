import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopBridge } from '../../contracts/desktop-bridge';

const ACTIVE_NOTE_KEY = 'yuheng-active-note';

export function useNoteWorkspace(bridge: DesktopBridge | undefined) {
  const [activeNoteId, setActiveNoteIdState] = useState<string | null>(() => typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_NOTE_KEY) : null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    if (!bridge) return;
    const version = ++requestVersionRef.current;
    void bridge.notes.list(true).then((items) => { if (version === requestVersionRef.current) setTitles(Object.fromEntries(items.map((note) => [note.id, note.title]))); }).catch(() => undefined);
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
  const notifyChanged = useCallback(() => setRevision((value) => value + 1), []);
  return { activeNoteId, setActiveNoteId, titles, revision, notifyChanged };
}
