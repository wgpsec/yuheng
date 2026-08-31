import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateTaskInput, DesktopBridge, Task, TaskAsset, TaskBoard, TaskEvent, TaskType, UpdateTaskInput } from '../../contracts/desktop-bridge';

export type TaskOpenRequest = { boardId: string; taskId?: string; action?: 'today' | 'quick_record' };

export function useTaskWorkspace(bridge: DesktopBridge | undefined, onOpenRequest: (request: TaskOpenRequest) => void) {
  const [boards, setBoards] = useState<TaskBoard[]>([]);
  const [activeBoardId, setActiveBoardIdState] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [types, setTypes] = useState<TaskType[]>([]);
  const [loading, setLoading] = useState(Boolean(bridge));
  const [error, setError] = useState<string | null>(null);
  const boardRef = useRef(activeBoardId);
  const openRequestRef = useRef(onOpenRequest);
  const loadVersionRef = useRef(0);
  boardRef.current = activeBoardId;
  openRequestRef.current = onOpenRequest;

  const fail = useCallback((reason: unknown, fallback: string) => setError(reason instanceof Error ? reason.message : fallback), []);
  const setActiveBoardId = useCallback((boardId: string) => { boardRef.current = boardId; setActiveBoardIdState(boardId); }, []);
  const refreshBoards = useCallback(async () => {
    if (!bridge) return [];
    try {
      const next = await bridge.tasks.boards.list();
      setBoards(next);
      setActiveBoardIdState((current) => {
        const selected = next.some((board) => board.id === current) ? current : (next[0]?.id ?? '');
        boardRef.current = selected;
        return selected;
      });
      return next;
    } catch (reason) { fail(reason, '加载任务看板失败。'); return []; }
  }, [bridge, fail]);

  useEffect(() => { void refreshBoards(); }, [refreshBoards]);
  useEffect(() => {
    if (!bridge || !activeBoardId) { setTasks([]); setTypes([]); setLoading(false); return; }
    const version = ++loadVersionRef.current;
    setLoading(true); setTasks([]); setTypes([]); setError(null);
    void Promise.all([bridge.tasks.list(activeBoardId), bridge.tasks.types.list(activeBoardId)]).then(([nextTasks, nextTypes]) => {
      if (version !== loadVersionRef.current || boardRef.current !== activeBoardId) return;
      setTasks(nextTasks); setTypes(nextTypes); setLoading(false);
    }).catch((reason) => { if (version === loadVersionRef.current && boardRef.current === activeBoardId) { setLoading(false); fail(reason, '加载任务看板失败。'); } });
    return () => { loadVersionRef.current += 1; };
  }, [activeBoardId, bridge, fail]);

  useEffect(() => {
    if (!bridge) return;
    let disposed = false;
    const handle = (event: TaskEvent) => {
      if (disposed) return;
      if (event.type === 'changed') {
        if (event.task.boardId === boardRef.current) setTasks((current) => [event.task, ...current.filter((task) => task.id !== event.task.id)]);
      } else if (event.type === 'types_changed') {
        if (event.boardId === boardRef.current) void bridge.tasks.types.list(event.boardId).then((next) => { if (!disposed && boardRef.current === event.boardId) setTypes(next); }).catch((reason) => fail(reason, '加载任务类型失败。'));
      } else if (event.type === 'boards_changed') {
        void refreshBoards();
      } else if (event.type === 'open_today' || event.type === 'quick_record') {
        setActiveBoardId(event.boardId); openRequestRef.current({ boardId: event.boardId, action: event.type === 'open_today' ? 'today' : 'quick_record' });
      } else {
        setActiveBoardId(event.boardId); openRequestRef.current({ boardId: event.boardId, taskId: event.taskId });
      }
    };
    const unsubscribe = bridge.tasks.onEvent(handle);
    void bridge.tasks.takeOpenRequest().then((request) => { if (request) handle({ type: 'open', ...request }); }).catch((reason) => fail(reason, '打开提醒任务失败。'));
    return () => { disposed = true; unsubscribe(); };
  }, [bridge, fail, refreshBoards, setActiveBoardId]);

  const create = useCallback(async (input: CreateTaskInput) => {
    if (!bridge || !boardRef.current) throw new Error('任务服务不可用。');
    const created = await bridge.tasks.create(boardRef.current, input); setTasks((current) => [created, ...current]); return created;
  }, [bridge]);
  const update = useCallback(async (id: string, patch: UpdateTaskInput) => {
    if (!bridge) throw new Error('任务服务不可用。');
    const updated = await bridge.tasks.update(id, patch); setTasks((current) => current.map((task) => task.id === id ? updated : task)); return updated;
  }, [bridge]);
  const remove = useCallback(async (id: string) => { if (!bridge) return; await bridge.tasks.delete(id); setTasks((current) => current.filter((task) => task.id !== id)); }, [bridge]);
  const reorder = useCallback(async (id: string, targetId: string) => { if (!bridge) return; setTasks(await bridge.tasks.reorder(id, targetId)); }, [bridge]);
  const moveToBoard = useCallback(async (id: string, boardId: string) => { if (!bridge) throw new Error('任务服务不可用。'); const moved = await bridge.tasks.moveToBoard(id, boardId); setTasks((current) => current.filter((task) => task.id !== id)); return moved; }, [bridge]);
  const copyToBoard = useCallback(async (id: string, boardId: string) => { if (!bridge) throw new Error('任务服务不可用。'); return bridge.tasks.copyToBoard(id, boardId); }, [bridge]);
  const createType = useCallback(async (name: string) => { if (!bridge || !boardRef.current) throw new Error('任务服务不可用。'); const created = await bridge.tasks.types.create(boardRef.current, name); setTypes((current) => [...current, created]); return created; }, [bridge]);
  const renameType = useCallback(async (id: string, name: string) => { if (!bridge) throw new Error('任务服务不可用。'); const updated = await bridge.tasks.types.rename(id, name); setTypes((current) => current.map((type) => type.id === id ? updated : type)); return updated; }, [bridge]);
  const deleteType = useCallback(async (id: string) => { if (!bridge) return; await bridge.tasks.types.delete(id); setTypes((current) => current.filter((type) => type.id !== id)); }, [bridge]);
  const createBoard = useCallback(async (name: string) => { if (!bridge) return null; const created = await bridge.tasks.boards.create(name); setBoards((current) => [...current, created]); setActiveBoardId(created.id); return created; }, [bridge, setActiveBoardId]);
  const renameBoard = useCallback(async (id: string, name: string) => { if (!bridge) return; const updated = await bridge.tasks.boards.rename(id, name); setBoards((current) => current.map((board) => board.id === id ? updated : board)); }, [bridge]);
  const reorderBoard = useCallback(async (id: string, targetId: string) => { if (!bridge) return; setBoards(await bridge.tasks.boards.reorder(id, targetId)); }, [bridge]);
  const deleteBoard = useCallback(async (id: string) => { if (!bridge) return; await bridge.tasks.boards.delete(id); const next = boards.filter((board) => board.id !== id); setBoards(next); if (boardRef.current === id) setActiveBoardId(next[0]?.id ?? ''); }, [boards, bridge, setActiveBoardId]);
  const importAsset = useCallback(async (file: File): Promise<TaskAsset> => { if (!bridge) throw new Error('附件服务不可用。'); return bridge.tasks.assets.import({ name: file.name, mimeType: file.type || 'application/octet-stream', data: await file.arrayBuffer() }); }, [bridge]);
  const pickAssets = useCallback(async (): Promise<TaskAsset[]> => bridge?.tasks.assets.pick() ?? [], [bridge]);
  const openAsset = useCallback(async (url: string): Promise<void> => { if (bridge) await bridge.tasks.assets.open(url); }, [bridge]);

  return { boards, activeBoardId, setActiveBoardId, tasks, types, loading, error, clearError: () => setError(null), refreshBoards, create, update, remove, reorder, moveToBoard, copyToBoard, createType, renameType, deleteType, createBoard, renameBoard, reorderBoard, deleteBoard, importAsset, pickAssets, openAsset };
}
