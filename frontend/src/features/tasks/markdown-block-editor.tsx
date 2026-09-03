import { Markdown } from '@tiptap/markdown';
import type { AnyExtension, Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Placeholder from '@tiptap/extension-placeholder';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { TableKit } from '@tiptap/extension-table';
import { AtSign, Bold, Braces, CalendarDays, Check, CheckSquare, Copy, GripVertical, Heading1, Heading2, Info, Italic, Link, List, ListOrdered, ListTodo, Minus, MoveRight, Paperclip, Plus, Quote, Redo2, Strikethrough, Table2, Text, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { TaskAsset } from '../../contracts/desktop-bridge';
import { Callout, calloutBlock, detailsBlock, EnhancedCodeBlock, ResizableImage } from './editor-blocks';
import { YuhengLink } from './internal-links';
import { blockRangeAt, contiguousBlockRange, copyBlockRangeToClipboard, deleteBlockRange, duplicateBlockRange, moveBlockRange, type EditorBlockRange } from './block-batch';
import { autoScrollDelta, blockAtPointerY, blockAtSelectionStartY, blockSelectionRange, canStartBlockSelection, frameAdjustedScrollDelta, type BlockPointerRange } from './block-selection';
import { BlockSelectionDecorations, updateBlockSelectionDecorations } from './block-selection-decoration';
import { parseRecentSlashCommands, rememberSlashCommand, slashCommandGroups, slashCommands, type SlashCommandId } from './slash-commands';
import { parseTaskMentionHref } from '../notes/note-mentions';

type SlashState = { query: string; from: number; to: number; left: number; top: number };
type BlockControlState = { left: number; top: number; position: number };
type BlockDragState = { from: number; to: number };
type BlockSelectionState = EditorBlockRange & { anchor: number };
type PointerBlock = BlockPointerRange & { element: HTMLElement };
type SelectionToolbarState = { left: number; top: number };
export type NoteLinkOption = { id: string; title: string; icon?: string | null };
type NoteLinkState = { query: string; from: number; to: number; label?: string; left: number; top: number };
export type MentionOption = { id: string; kind: 'note' | 'task' | 'date'; title: string; detail?: string; icon?: string | null; href?: string; value?: string };
type MentionState = { query: string; from: number; to: number; left: number; top: number };

export function shouldInterpretMarkdownPaste(value: string): boolean {
  return /(^|\n)\s{0,3}(?:[-*+]\s+\[[ xX]\]|[-*+]\s+|#{1,6}\s+|\d+[.)]\s+)/u.test(value)
    || /(^|\n)\s{0,3}(?:\*\*|__|```|>\s)/u.test(value)
    || /\[[^\]\n]+\]\(yuheng-note:\/\/[^\s)]+\)/u.test(value);
}

const RECENT_SLASH_COMMANDS_KEY = 'yuheng-recent-slash-commands';
const slashCommandIcons: Record<SlashCommandId, typeof Text> = { paragraph: Text, heading1: Heading1, heading2: Heading2, bulletList: List, orderedList: ListOrdered, taskList: CheckSquare, blockquote: Quote, callout: Info, details: List, horizontalRule: Minus, table: Table2, codeBlock: Braces, attachment: Paperclip };
const blockActionItems = slashCommands.filter((command) => command.id !== 'attachment').map((command) => ({ ...command, icon: slashCommandIcons[command.id] }));

export function MarkdownBlockEditor({ value, onChange, onImportAsset, onPickAssets, onOpenAsset, noteLinkOptions = [], noteLinkHref, onOpenNote, mentionOptions = [], onOpenTask, onMoveBlock, extensions = [], floatingToolbar = false, blockRangeSelection = false }: {
  value: string;
  onChange: (markdown: string) => void;
  onImportAsset?: (file: File) => Promise<TaskAsset>;
  onPickAssets?: () => Promise<TaskAsset[]>;
  onOpenAsset?: (url: string) => Promise<void>;
  noteLinkOptions?: NoteLinkOption[];
  noteLinkHref?: (noteId: string) => string;
  onOpenNote?: (noteId: string) => void;
  mentionOptions?: MentionOption[];
  onOpenTask?: (boardId: string, taskId: string) => void;
  onMoveBlock?: (targetNoteId: string, sourceContent: string, blockMarkdown: string) => Promise<void>;
  extensions?: AnyExtension[];
  floatingToolbar?: boolean;
  blockRangeSelection?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const noteLinkOptionsRef = useRef(noteLinkOptions);
  const onOpenNoteRef = useRef(onOpenNote);
  const mentionOptionsRef = useRef(mentionOptions);
  const onOpenTaskRef = useRef(onOpenTask);
  noteLinkOptionsRef.current = noteLinkOptions;
  onOpenNoteRef.current = onOpenNote;
  mentionOptionsRef.current = mentionOptions;
  onOpenTaskRef.current = onOpenTask;
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [recentSlashCommands, setRecentSlashCommands] = useState(() => parseRecentSlashCommands(typeof localStorage === 'undefined' ? null : localStorage.getItem(RECENT_SLASH_COMMANDS_KEY)));
  const [blockControl, setBlockControl] = useState<BlockControlState | null>(null);
  const [blockMenuOpen, setBlockMenuOpenState] = useState(false);
  const [blockMenuClosing, setBlockMenuClosing] = useState(false);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [blockMoveBusy, setBlockMoveBusy] = useState(false);
  const [draggedBlock, setDraggedBlock] = useState<BlockDragState | null>(null);
  const [selectedBlocks, setSelectedBlocks] = useState<BlockSelectionState | null>(null);
  const [selectedBlockCount, setSelectedBlockCount] = useState(0);
  const [blockCopyState, setBlockCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const [blockSelectionDragging, setBlockSelectionDragging] = useState(false);
  const [dropBlockTop, setDropBlockTop] = useState<number | null>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null);
  const [noteLink, setNoteLink] = useState<NoteLinkState | null>(null);
  const [noteLinkIndex, setNoteLinkIndex] = useState(0);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const draggedBlockElementsRef = useRef<HTMLElement[]>([]);
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  const pointerBlockSelectionRef = useRef<{
    pointerId: number;
    anchor: PointerBlock;
    latestY: number;
    scrollContainer: HTMLElement | null;
    animationFrame: number | null;
    lastFrameTime: number | null;
  } | null>(null);
  const [, refreshToolbar] = useState(0);
  const [assetBusy, setAssetBusy] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [editState, setEditState] = useState<'saved' | 'editing'>('saved');
  const editStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockControlHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateSelectionToolbar = (currentEditor: Editor) => {
    if (!floatingToolbar || !currentEditor.isFocused || currentEditor.state.selection.empty || !containerRef.current) return setSelectionToolbar(null);
    const { from, to } = currentEditor.state.selection;
    const start = currentEditor.view.coordsAtPos(from);
    const end = currentEditor.view.coordsAtPos(to);
    const bounds = containerRef.current.getBoundingClientRect();
    const left = (start.left + end.right) / 2 - bounds.left;
    const above = start.top - bounds.top - 46;
    setSelectionToolbar({ left, top: above >= 4 ? above : end.bottom - bounds.top + 8 });
  };
  const setBlockMenuOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(blockMenuOpen) : next;
    if (blockMenuCloseTimerRef.current !== null) clearTimeout(blockMenuCloseTimerRef.current);
    if (value) { setBlockMenuClosing(false); setBlockMenuOpenState(true); return; }
    if (!blockMenuOpen) return;
    setBlockMenuClosing(true);
    blockMenuCloseTimerRef.current = setTimeout(() => { setBlockMenuOpenState(false); setBlockMenuClosing(false); blockMenuCloseTimerRef.current = null; }, 125);
  };

  useEffect(() => () => {
    if (blockControlHideTimerRef.current !== null) clearTimeout(blockControlHideTimerRef.current);
    if (blockMenuCloseTimerRef.current !== null) clearTimeout(blockMenuCloseTimerRef.current);
    if (editStateTimerRef.current !== null) clearTimeout(editStateTimerRef.current);
    if (blockCopyTimerRef.current !== null) clearTimeout(blockCopyTimerRef.current);
    const activeBlockSelection = pointerBlockSelectionRef.current;
    if (activeBlockSelection?.animationFrame !== null && activeBlockSelection?.animationFrame !== undefined) cancelAnimationFrame(activeBlockSelection.animationFrame);
    dragPreviewRef.current?.remove();
  }, []);
  const editor = useEditor({
    extensions: [
      ...extensions,
      ...(blockRangeSelection ? [BlockSelectionDecorations] : []),
      StarterKit.configure({ codeBlock: false, link: false }),
      YuhengLink,
      EnhancedCodeBlock,
      Details.configure({ persist: true, renderToggleButton: ({ element, isOpen }) => { element.textContent = isOpen ? '▾' : '▸'; } }),
      DetailsSummary,
      DetailsContent,
      TableKit.configure({ table: { resizable: false }, tableCell: {}, tableHeader: {}, tableRow: {} }),
      Callout,
      TaskList,
      TaskItem.configure({ nested: true }),
      ResizableImage,
      Placeholder.configure({ placeholder: '输入内容，或键入 / 插入内容块...' }),
      Markdown,
    ],
    content: value,
    contentType: 'markdown',
    autofocus: 'end',
    editorProps: {
      attributes: { 'aria-label': '任务 Markdown 详情', spellcheck: 'true' },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length > 0) {
          event.preventDefault();
          void importFiles(files);
          return true;
        }
        const markdown = event.clipboardData?.getData('text/plain') ?? '';
        if (!markdown || !shouldInterpretMarkdownPaste(markdown)) return false;
        event.preventDefault();
        const { from, to } = view.state.selection;
        editor?.commands.insertContentAt({ from, to }, markdown, { contentType: 'markdown' });
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return false;
        event.preventDefault();
        void importFiles(files);
        return true;
      },
      handleClick: (_view, _position, event) => {
        const target = event.target instanceof Element ? event.target.closest('a') : null;
        const href = target?.getAttribute('href');
        if (!href) return false;
        if (href.startsWith('yuheng-note://')) {
          event.preventDefault();
          try {
            const noteId = decodeURIComponent(href.slice('yuheng-note://'.length));
            if (noteId) onOpenNoteRef.current?.(noteId);
          } catch {
            setAssetError('页面链接无效。');
          }
          return true;
        }
        const taskIdentity = parseTaskMentionHref(href);
        if (taskIdentity) {
          event.preventDefault();
          onOpenTaskRef.current?.(taskIdentity.boardId, taskIdentity.taskId);
          return true;
        }
        if (!href.startsWith('yuheng-task-asset://')) return false;
        event.preventDefault();
        if (onOpenAsset) void onOpenAsset(href).catch((reason) => setAssetError(reason instanceof Error ? reason.message : '打开附件失败。'));
        return true;
      },
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      refreshToolbar((current) => current + 1);
      updateSelectionToolbar(currentEditor);
    },
    onBlur: () => setSelectionToolbar(null),
    onUpdate: ({ editor: currentEditor }) => {
      setSelectedBlocks(null);
      setBlockMenuOpen(false);
      setMoveMenuOpen(false);
      onChange(currentEditor.getMarkdown());
      setEditState('editing');
      if (editStateTimerRef.current !== null) clearTimeout(editStateTimerRef.current);
      editStateTimerRef.current = setTimeout(() => { setEditState('saved'); editStateTimerRef.current = null; }, 700);
      const { $from } = currentEditor.state.selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
      const match = textBefore.match(/^\/([^\s/]*)$/u);
      const container = containerRef.current;
      const noteMatch = textBefore.match(/^\[\[([^\]\n]*)$/u);
      const mentionMatch = textBefore.match(/(?:^|\s)@([^\s@]*)$/u);
      if (!container) return;
      if (noteMatch && noteLinkOptionsRef.current.length > 0) {
        const cursor = currentEditor.view.coordsAtPos($from.pos);
        const bounds = container.getBoundingClientRect();
        setNoteLink({ query: noteMatch[1].toLowerCase(), from: $from.pos - noteMatch[1].length - 2, to: $from.pos, left: Math.max(8, cursor.left - bounds.left), top: cursor.bottom - bounds.top + 8 });
        setNoteLinkIndex(0);
      } else {
        setNoteLink(null);
        setNoteLinkIndex(0);
      }
      if (mentionMatch && mentionOptionsRef.current.length > 0) {
        const cursor = currentEditor.view.coordsAtPos($from.pos);
        const bounds = container.getBoundingClientRect();
        setMention({ query: mentionMatch[1].toLocaleLowerCase('zh-CN'), from: $from.pos - mentionMatch[1].length - 1, to: $from.pos, left: Math.max(8, cursor.left - bounds.left), top: cursor.bottom - bounds.top + 8 });
        setMentionIndex(0);
      } else {
        setMention(null);
        setMentionIndex(0);
      }
      if (!match || !container) return setSlash(null);
      const cursor = currentEditor.view.coordsAtPos($from.pos);
      const bounds = container.getBoundingClientRect();
      setSlash({ query: match[1].toLowerCase(), from: $from.start(), to: $from.pos, left: Math.max(8, cursor.left - bounds.left), top: cursor.bottom - bounds.top + 8 });
      setSlashIndex(0);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getMarkdown();
    if (current === value) return;
    editor.commands.setContent(value, { contentType: 'markdown' });
  }, [editor, value]);

  useEffect(() => {
    if (!editor || !blockRangeSelection) {
      setSelectedBlockCount(0);
      return;
    }
    let count = 0;
    editor.state.doc.forEach((node, offset) => {
      if (selectedBlocks && offset >= selectedBlocks.from && offset + node.nodeSize <= selectedBlocks.to) count += 1;
    });
    updateBlockSelectionDecorations(editor, selectedBlocks);
    setSelectedBlockCount(count);
  }, [blockRangeSelection, editor, selectedBlocks, value]);

  useEffect(() => {
    if (blockCopyTimerRef.current !== null) clearTimeout(blockCopyTimerRef.current);
    blockCopyTimerRef.current = null;
    setBlockCopyState('idle');
  }, [selectedBlocks?.from, selectedBlocks?.to]);

  const hasBlockSelection = selectedBlocks !== null;
  useEffect(() => {
    if (!hasBlockSelection) return;
    const clearWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSelectedBlocks(null);
      setBlockMenuOpen(false);
      setMoveMenuOpen(false);
    };
    const clearOutsideEditor = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      setSelectedBlocks(null);
      setBlockMenuOpen(false);
      setMoveMenuOpen(false);
    };
    window.addEventListener('keydown', clearWithEscape);
    document.addEventListener('pointerdown', clearOutsideEditor);
    return () => {
      window.removeEventListener('keydown', clearWithEscape);
      document.removeEventListener('pointerdown', clearOutsideEditor);
    };
  }, [hasBlockSelection]);

  const insertAssets = (assets: TaskAsset[]) => {
    if (!editor || assets.length === 0) return;
    const content = assets.flatMap((asset) => asset.mimeType.startsWith('image/')
      ? [{ type: 'image', attrs: { src: asset.url, alt: asset.name, title: asset.name } }, { type: 'paragraph' }]
      : [{ type: 'paragraph', content: [{ type: 'text', text: asset.name, marks: [{ type: 'link', attrs: { href: asset.url } }] }] }, { type: 'paragraph' }]);
    editor.chain().focus().insertContent(content).run();
  };

  const importFiles = async (files: File[]) => {
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (files.some((file) => file.size > 10 * 1024 * 1024)) return setAssetError('单个附件不能超过 10 MB。');
    if (totalBytes > 20 * 1024 * 1024) return setAssetError('单次添加的附件总大小不能超过 20 MB。');
    setAssetBusy(true);
    setAssetError(null);
    try {
      const imported: TaskAsset[] = [];
      if (!onImportAsset) return;
      for (const file of files) imported.push(await onImportAsset(file));
      insertAssets(imported);
    } catch (reason) {
      setAssetError(reason instanceof Error ? reason.message : '保存附件失败。');
    } finally {
      setAssetBusy(false);
    }
  };

  const pickAssets = async () => {
    if (!onPickAssets) return;
    setAssetBusy(true);
    setAssetError(null);
    try {
      insertAssets(await onPickAssets());
    } catch (reason) {
      setAssetError(reason instanceof Error ? reason.message : '选择附件失败。');
    } finally {
      setAssetBusy(false);
    }
  };

  const applySlashItem = (id: SlashCommandId) => {
    if (!editor || !slash) return;
    let chain = editor.chain().focus().deleteRange({ from: slash.from, to: slash.to });
    if (id === 'paragraph') chain = chain.setParagraph();
    if (id === 'heading1') chain = chain.toggleHeading({ level: 1 });
    if (id === 'heading2') chain = chain.toggleHeading({ level: 2 });
    if (id === 'bulletList') chain = chain.toggleBulletList();
    if (id === 'orderedList') chain = chain.toggleOrderedList();
    if (id === 'taskList') chain = chain.toggleTaskList();
    if (id === 'blockquote') chain = chain.toggleBlockquote();
    if (id === 'codeBlock') chain = chain.toggleCodeBlock();
    if (id === 'callout') chain = chain.insertContent(calloutBlock());
    if (id === 'details') chain = chain.insertContent(detailsBlock());
    if (id === 'horizontalRule') chain = chain.setHorizontalRule();
    if (id === 'table') chain = chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
    chain.run();
    setRecentSlashCommands((current) => {
      const next = rememberSlashCommand(current, id);
      if (typeof localStorage !== 'undefined') localStorage.setItem(RECENT_SLASH_COMMANDS_KEY, JSON.stringify(next));
      return next;
    });
    setSlash(null);
    if (id === 'attachment') void pickAssets();
  };

  const updateBlockControl = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (blockControlHideTimerRef.current !== null) {
      clearTimeout(blockControlHideTimerRef.current);
      blockControlHideTimerRef.current = null;
    }
    if (!editor) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.block-editor-block-controls')) return;
    const container = containerRef.current;
    if (!container) {
      setBlockControl(null);
      return;
    }
    const directBlock = target?.closest<HTMLElement>('.ProseMirror > *');
    const contentArea = target?.closest('.block-editor-content');
    const block = directBlock ?? (contentArea
      ? Array.from(container.querySelectorAll<HTMLElement>('.ProseMirror > *')).find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return event.clientY >= rect.top && event.clientY <= rect.bottom;
      })
      : null);
    if (!block) {
      if (!contentArea) setBlockControl(null);
      return;
    }
    const bounds = container.getBoundingClientRect();
    const rect = block.getBoundingClientRect();
    const nextControl = {
      left: Math.max(0, rect.left - bounds.left - 43),
      top: rect.top - bounds.top + 5,
      position: editor.view.posAtDOM(block, 0),
    };
    setBlockControl((current) => {
      if (current?.position !== nextControl.position) setBlockMenuOpen(false);
      return nextControl;
    });
  };

  const scheduleBlockControlHide = () => {
    if (blockControlHideTimerRef.current !== null) clearTimeout(blockControlHideTimerRef.current);
    blockControlHideTimerRef.current = setTimeout(() => {
      blockControlHideTimerRef.current = null;
      if (selectedBlocks) return;
      setBlockControl(null);
    }, 180);
  };

  const keepBlockControl = () => {
    if (blockControlHideTimerRef.current === null) return;
    clearTimeout(blockControlHideTimerRef.current);
    blockControlHideTimerRef.current = null;
  };

  const insertBlockAfter = () => {
    const range = blockRange();
    if (!editor || !range) return;
    editor.chain().focus().insertContentAt(range.to, { type: 'paragraph' }).run();
    setBlockControl(null);
    setBlockMenuOpen(false);
  };

  const controlledBlockRange = () => {
    if (!editor || !blockControl) return null;
    const range = blockRangeAt(editor.state.doc, blockControl.position);
    if (!range) return null;
    const node = editor.state.doc.nodeAt(range.from);
    return node ? { node, ...range } : null;
  };

  const blockRange = () => selectedBlocks ?? controlledBlockRange();

  const blockElementForDragEvent = (event: ReactDragEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const directBlock = target?.closest<HTMLElement>('.ProseMirror > *');
    if (directBlock) return directBlock;
    if (!target?.closest('.block-editor-content') || !containerRef.current) return null;
    return Array.from(containerRef.current.querySelectorAll<HTMLElement>('.ProseMirror > *')).find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY <= rect.bottom;
    }) ?? null;
  };

  const blockRangeForElement = (block: HTMLElement) => {
    if (!editor) return null;
    const position = editor.view.posAtDOM(block, 0);
    return blockRangeAt(editor.state.doc, position);
  };

  const pointerBlocks = (): PointerBlock[] => Array.from(containerRef.current?.querySelectorAll<HTMLElement>('.ProseMirror > *') ?? []).flatMap((element) => {
    const range = blockRangeForElement(element);
    if (!range) return [];
    const bounds = element.getBoundingClientRect();
    return [{ ...range, top: bounds.top, bottom: bounds.bottom, element }];
  });

  const updatePointerBlockSelection = (pointerY: number) => {
    const active = pointerBlockSelectionRef.current;
    if (!active) return;
    const current = blockAtPointerY(pointerBlocks(), pointerY);
    if (current) setSelectedBlocks(blockSelectionRange(active.anchor, current));
  };

  const stepBlockSelectionAutoScroll = (timestamp: number) => {
    const active = pointerBlockSelectionRef.current;
    if (!active) return;
    active.animationFrame = null;
    const viewport = active.scrollContainer;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const delta = autoScrollDelta(active.latestY, bounds);
    if (delta === 0) {
      active.lastFrameTime = null;
      return;
    }
    const elapsed = active.lastFrameTime === null ? 1000 / 60 : timestamp - active.lastFrameTime;
    active.lastFrameTime = timestamp;
    const previousTop = viewport.scrollTop;
    viewport.scrollTop += frameAdjustedScrollDelta(delta, elapsed);
    updatePointerBlockSelection(active.latestY);
    if (viewport.scrollTop !== previousTop) active.animationFrame = requestAnimationFrame(stepBlockSelectionAutoScroll);
  };

  const startBlockRangeSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!blockRangeSelection || !editor || !canStartBlockSelection({ button: event.button, inGutter: true, inEditableContent: false })) return;
    const anchor = blockAtSelectionStartY(pointerBlocks(), event.clientY);
    if (!anchor) {
      setSelectedBlocks(null);
      setBlockMenuOpen(false);
      setMoveMenuOpen(false);
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    editor.commands.blur();
    window.getSelection()?.removeAllRanges();
    setSelectionToolbar(null);
    setBlockMenuOpen(false);
    setMoveMenuOpen(false);
    setBlockControl(null);
    setBlockSelectionDragging(true);
    setSelectedBlocks(blockSelectionRange(anchor, anchor));
    pointerBlockSelectionRef.current = {
      pointerId: event.pointerId,
      anchor,
      latestY: event.clientY,
      scrollContainer: containerRef.current?.closest<HTMLElement>('.notes-editor') ?? null,
      animationFrame: null,
      lastFrameTime: null,
    };
  };

  const moveBlockRangeSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = pointerBlockSelectionRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    active.latestY = event.clientY;
    updatePointerBlockSelection(event.clientY);
    if (active.animationFrame === null) {
      active.lastFrameTime = null;
      active.animationFrame = requestAnimationFrame(stepBlockSelectionAutoScroll);
    }
  };

  const finishBlockRangeSelection = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const active = pointerBlockSelectionRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.animationFrame !== null) cancelAnimationFrame(active.animationFrame);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    pointerBlockSelectionRef.current = null;
    setBlockSelectionDragging(false);
    if (cancelled) setSelectedBlocks(null);
  };

  const handleBlockDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggedBlock) return;
    const block = blockElementForDragEvent(event);
    if (!block) return;
    const range = blockRangeForElement(block);
    if (!range || range.from === draggedBlock.from) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const bounds = containerRef.current?.getBoundingClientRect();
    if (bounds) setDropBlockTop(block.getBoundingClientRect().top - bounds.top);
  };

  const handleBlockDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggedBlock || !editor) return;
    const block = blockElementForDragEvent(event);
    const target = block ? blockRangeForElement(block) : null;
    if (!target || target.from === draggedBlock.from) return;
    event.preventDefault();
    moveBlockRange(editor, draggedBlock, target.from);
    draggedBlockElementsRef.current.forEach((element) => element.classList.remove('is-block-dragging'));
    draggedBlockElementsRef.current = [];
    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;
    setDraggedBlock(null);
    setDropBlockTop(null);
    setSelectedBlocks(null);
  };

  const clearDraggedBlock = () => {
    draggedBlockElementsRef.current.forEach((element) => element.classList.remove('is-block-dragging'));
    draggedBlockElementsRef.current = [];
    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;
    setDraggedBlock(null);
    setDropBlockTop(null);
  };

  const applyBlockAction = (id: SlashCommandId) => {
    const range = blockRange();
    if (!editor || !range) return;
    let chain = editor.chain().focus().setTextSelection({ from: Math.min(range.from + 1, editor.state.doc.content.size), to: Math.max(range.from + 1, Math.min(range.to - 1, editor.state.doc.content.size)) });
    if (id === 'paragraph') chain = chain.setParagraph();
    if (id === 'heading1') chain = chain.toggleHeading({ level: 1 });
    if (id === 'heading2') chain = chain.toggleHeading({ level: 2 });
    if (id === 'bulletList') chain = chain.toggleBulletList();
    if (id === 'orderedList') chain = chain.toggleOrderedList();
    if (id === 'taskList') chain = chain.toggleTaskList();
    if (id === 'blockquote') chain = chain.toggleBlockquote();
    if (id === 'codeBlock') chain = chain.toggleCodeBlock();
    if (id === 'callout') chain = chain.insertContent(calloutBlock());
    if (id === 'details') chain = chain.insertContent(detailsBlock());
    if (id === 'horizontalRule') chain = chain.setHorizontalRule();
    if (id === 'table') chain = chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
    chain.run();
    setBlockMenuOpen(false);
    setBlockControl(null);
    setSelectedBlocks(null);
  };

  const deleteBlock = () => {
    const range = blockRange();
    if (!editor || !range) return;
    deleteBlockRange(editor, range);
    setBlockMenuOpen(false);
    setBlockControl(null);
    setSelectedBlocks(null);
    setMoveMenuOpen(false);
  };

  const duplicateBlock = () => {
    const range = blockRange();
    if (!editor || !range) return;
    duplicateBlockRange(editor, range);
    setBlockMenuOpen(false);
    setBlockControl(null);
    setSelectedBlocks(null);
    setMoveMenuOpen(false);
  };

  const copySelectedBlocks = async () => {
    if (!editor || !selectedBlocks || blockCopyState === 'copying') return;
    if (!navigator.clipboard) {
      setBlockCopyState('error');
      setAssetError('无法访问系统剪贴板，请检查应用权限。');
      return;
    }
    setBlockCopyState('copying');
    try {
      await copyBlockRangeToClipboard(editor, selectedBlocks, navigator.clipboard);
      setAssetError(null);
      setBlockCopyState('copied');
      if (blockCopyTimerRef.current !== null) clearTimeout(blockCopyTimerRef.current);
      blockCopyTimerRef.current = setTimeout(() => {
        setBlockCopyState('idle');
        blockCopyTimerRef.current = null;
      }, 1200);
    } catch {
      setBlockCopyState('error');
      setAssetError('复制到系统剪贴板失败，请检查应用权限后重试。');
    }
  };

  const moveBlock = async (targetNoteId: string) => {
    const range = blockRange();
    if (!editor || !range || !editor.markdown || !onMoveBlock || blockMoveBusy) return;
    const blockMarkdown = editor.markdown.serialize({ type: 'doc', content: editor.state.doc.slice(range.from, range.to).content.toJSON() }).trim();
    const transaction = editor.state.tr.delete(range.from, range.to);
    const sourceContent = editor.markdown.serialize(transaction.doc.toJSON());
    setBlockMoveBusy(true);
    editor.setEditable(false);
    try {
      await onMoveBlock(targetNoteId, sourceContent, blockMarkdown);
      editor.view.dispatch(transaction);
      setBlockMenuOpen(false);
      setMoveMenuOpen(false);
      setBlockControl(null);
      setSelectedBlocks(null);
      setAssetError(null);
    } catch (reason) {
      setAssetError(reason instanceof Error ? reason.message : '移动内容块失败。');
    } finally {
      editor.setEditable(true);
      setBlockMoveBusy(false);
    }
  };

  const setLink = () => {
    if (!editor) return;
    const existing = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('链接地址', existing ?? 'https://');
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  };

  const visibleSlashGroups = slashCommandGroups(slash?.query ?? '', recentSlashCommands)
    .map((group) => ({ ...group, commands: group.commands.filter((command) => command.id !== 'attachment' || Boolean(onPickAssets)) }))
    .filter((group) => group.commands.length > 0);
  const filteredSlashItems = visibleSlashGroups.flatMap((group) => group.commands).map((command) => ({ ...command, icon: slashCommandIcons[command.id] }));
  const filteredNoteLinks = noteLinkOptions.filter((option) => !noteLink?.query || option.title.toLowerCase().includes(noteLink.query)).slice(0, 8);
  const filteredMentions = mentionOptions.filter((option) => !mention?.query || `${option.title} ${option.detail ?? ''}`.toLocaleLowerCase('zh-CN').includes(mention.query)).slice(0, 10);
  const insertNoteLink = (option: NoteLinkOption) => {
    if (!editor || !noteLink) return;
    if (!noteLinkHref) return;
    const label = noteLink.label || option.title;
    editor.chain().focus().deleteRange({ from: noteLink.from, to: noteLink.to }).insertContent({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href: noteLinkHref(option.id) } }] }).run();
    setNoteLink(null);
    setNoteLinkIndex(0);
  };

  const openNoteLinkPicker = () => {
    if (!editor || !noteLinkHref || noteLinkOptions.length === 0) return setLink();
    const { from, to } = editor.state.selection;
    if (from === to || !containerRef.current) return setLink();
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    const bounds = containerRef.current.getBoundingClientRect();
    setNoteLink({ query: '', from, to, label: editor.state.doc.textBetween(from, to, ' '), left: Math.max(8, (start.left + end.right) / 2 - bounds.left), top: end.bottom - bounds.top + 8 });
    setNoteLinkIndex(0);
  };

  const insertMention = (option: MentionOption) => {
    if (!editor || !mention) return;
    const content = option.href
      ? { type: 'text', text: option.title, marks: [{ type: 'link', attrs: { href: option.href } }] }
      : { type: 'text', text: option.value ?? option.title };
    editor.chain().focus().deleteRange({ from: mention.from, to: mention.to }).insertContent(content).run();
    setMention(null);
    setMentionIndex(0);
  };

  return <div className={`block-editor ${draggedBlock ? 'is-dragging-block' : ''} ${blockSelectionDragging ? 'is-selecting-blocks' : ''}`} ref={containerRef} onMouseDown={(event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.block-editor-block-controls, .block-editor-block-gutter, .block-editor-batch-toolbar')) {
      setSelectedBlocks(null);
      setMoveMenuOpen(false);
    }
  }} onKeyDown={(event) => {
    if (event.key === 'Escape' && selectedBlocks) { setSelectedBlocks(null); setBlockMenuOpen(false); return; }
    if (mention) {
      if (event.key === 'Escape') { event.preventDefault(); setMention(null); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (filteredMentions.length === 0) return;
        event.preventDefault();
        setMentionIndex((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + filteredMentions.length) % filteredMentions.length);
        return;
      }
      if (event.key === 'Enter' && filteredMentions[mentionIndex]) { event.preventDefault(); insertMention(filteredMentions[mentionIndex]); return; }
    }
    if (noteLink) {
      if (event.key === 'Escape') { event.preventDefault(); setNoteLink(null); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (filteredNoteLinks.length === 0) return;
        event.preventDefault();
        setNoteLinkIndex((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + filteredNoteLinks.length) % filteredNoteLinks.length);
        return;
      }
      if (event.key === 'Enter' && filteredNoteLinks[noteLinkIndex]) { event.preventDefault(); insertNoteLink(filteredNoteLinks[noteLinkIndex]); return; }
    }
    if (slash) {
      if (event.key === 'Escape') { event.preventDefault(); setSlash(null); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (filteredSlashItems.length === 0) return;
        event.preventDefault();
        setSlashIndex((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + filteredSlashItems.length) % filteredSlashItems.length);
        return;
      }
      if (event.key === 'Enter' && filteredSlashItems[slashIndex]) { event.preventDefault(); applySlashItem(filteredSlashItems[slashIndex].id); }
    }
  }} onMouseMove={updateBlockControl} onMouseLeave={scheduleBlockControlHide} onDragOver={handleBlockDragOver} onDrop={handleBlockDrop}>
    <div className={`block-editor-toolbar ${floatingToolbar ? `is-floating ${selectionToolbar && !selectedBlocks ? 'is-visible' : ''}` : ''}`} style={floatingToolbar && selectionToolbar ? { left: selectionToolbar.left, top: selectionToolbar.top } : undefined} onMouseDown={floatingToolbar ? (event) => event.preventDefault() : undefined} aria-label="文本格式">
      <button type="button" onClick={() => editor?.chain().focus().undo().run()} aria-label="撤销" title="撤销 (⌘Z)" disabled={!editor?.can().undo()}><Undo2 size={14} /></button>
      <button type="button" onClick={() => editor?.chain().focus().redo().run()} aria-label="重做" title="重做 (⌘⇧Z)" disabled={!editor?.can().redo()}><Redo2 size={14} /></button>
      <span className="block-editor-save-state" role="status" aria-live="polite">{editState === 'editing' ? '编辑中' : '已保存'}</span>
      <span className="block-editor-divider" />
      <button type="button" className={editor?.isActive('bold') ? 'is-active' : ''} onClick={() => editor?.chain().focus().toggleBold().run()} aria-label="粗体" title="粗体"><Bold size={14} /></button>
      <button type="button" className={editor?.isActive('italic') ? 'is-active' : ''} onClick={() => editor?.chain().focus().toggleItalic().run()} aria-label="斜体" title="斜体"><Italic size={14} /></button>
      <button type="button" className={editor?.isActive('strike') ? 'is-active' : ''} onClick={() => editor?.chain().focus().toggleStrike().run()} aria-label="删除线" title="删除线"><Strikethrough size={14} /></button>
      <span className="block-editor-divider" />
      <button type="button" className={editor?.isActive('heading', { level: 1 }) ? 'is-active' : ''} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} aria-label="一级标题" title="一级标题"><Heading1 size={15} /></button>
      <button type="button" className={editor?.isActive('heading', { level: 2 }) ? 'is-active' : ''} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} aria-label="二级标题" title="二级标题"><Heading2 size={15} /></button>
      <button type="button" className={editor?.isActive('bulletList') ? 'is-active' : ''} onClick={() => editor?.chain().focus().toggleBulletList().run()} aria-label="项目列表" title="项目列表"><List size={15} /></button>
      <button type="button" className={editor?.isActive('taskList') ? 'is-active' : ''} onClick={() => editor?.chain().focus().toggleTaskList().run()} aria-label="任务清单" title="任务清单"><CheckSquare size={14} /></button>
      <button type="button" className={editor?.isActive('blockquote') ? 'is-active' : ''} onClick={() => editor?.chain().focus().toggleBlockquote().run()} aria-label="引用" title="引用"><Quote size={14} /></button>
      <button type="button" className={editor?.isActive('link') ? 'is-active' : ''} onClick={noteLinkOptions.length > 0 ? openNoteLinkPicker : setLink} aria-label="链接" title="链接"><Link size={14} /></button>
      <span className="block-editor-divider" />
      {(onPickAssets || onImportAsset) && <button type="button" onClick={() => void pickAssets()} aria-label="添加图片或附件" title="添加图片或附件" disabled={assetBusy}><Paperclip size={14} /></button>}
      {assetBusy && <span className="block-editor-uploading">保存中...</span>}
    </div>
    <EditorContent editor={editor} className="block-editor-content" />
    {blockRangeSelection && <div className="block-editor-block-gutter" aria-hidden="true" onPointerDown={startBlockRangeSelection} onPointerMove={moveBlockRangeSelection} onPointerUp={(event) => finishBlockRangeSelection(event)} onPointerCancel={(event) => finishBlockRangeSelection(event, true)} />}
    {selectedBlocks && selectedBlockCount > 0 && !blockSelectionDragging && <div className="block-editor-batch-toolbar" role="toolbar" aria-label={`${selectedBlockCount} 个内容块的批量操作`} onMouseDown={(event) => event.preventDefault()}>
      <span role="status" aria-live="polite">{blockCopyState === 'copying' ? '正在复制...' : blockCopyState === 'copied' ? `已复制 ${selectedBlockCount} 个块` : blockCopyState === 'error' ? '复制失败' : `${selectedBlockCount} 个块`}</span>
      <button type="button" className={blockCopyState === 'copied' ? 'is-copied' : blockCopyState === 'error' ? 'is-error' : ''} onClick={() => void copySelectedBlocks()} aria-label={blockCopyState === 'copied' ? '已复制所选内容块到剪贴板' : blockCopyState === 'error' ? '重试复制所选内容块到剪贴板' : '复制所选内容块到剪贴板'} title={blockCopyState === 'copied' ? '已复制到剪贴板' : blockCopyState === 'error' ? '复制失败，点击重试' : '复制到剪贴板'} disabled={blockCopyState === 'copying'}>{blockCopyState === 'copied' ? <Check size={15} /> : <Copy size={15} />}</button>
      {onMoveBlock && noteLinkOptions.length > 0 && <div className="block-editor-batch-move"><button type="button" onClick={() => setMoveMenuOpen((current) => !current)} aria-label="移动所选内容块到其他页面" title="移动到页面" aria-expanded={moveMenuOpen}><MoveRight size={15} /></button>{moveMenuOpen && <div className="block-editor-batch-move-menu" role="menu" aria-label="移动到页面">{noteLinkOptions.map((option) => <button type="button" role="menuitem" key={option.id} onClick={() => void moveBlock(option.id)}><span>{option.icon ?? '▧'}</span><span>{option.title}</span></button>)}</div>}</div>}
      <button type="button" className="is-destructive" onClick={deleteBlock} aria-label="删除所选内容块" title="删除"><Trash2 size={15} /></button>
    </div>}
    {dropBlockTop !== null && <div className="block-editor-block-drop-indicator" style={{ top: dropBlockTop }} aria-hidden="true" />}
    {blockControl && <div className="block-editor-block-controls" style={{ left: blockControl.left, top: blockControl.top }} onMouseEnter={keepBlockControl} onMouseDown={(event) => { if (!(event.target as Element | null)?.closest('.block-editor-drag-handle')) event.preventDefault(); }}>
      <button type="button" onClick={insertBlockAfter} aria-label="在下方添加内容块" title="添加内容块"><Plus size={14} /></button>
      <button type="button" className="block-editor-drag-handle" draggable onDragStart={(event) => { const current = controlledBlockRange(); if (!current) return; const range = selectedBlocks && current.from >= selectedBlocks.from && current.to <= selectedBlocks.to ? selectedBlocks : current; const sources = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('.ProseMirror > *') ?? []).filter((candidate) => { const candidateRange = blockRangeForElement(candidate); return Boolean(candidateRange && candidateRange.from >= range.from && candidateRange.to <= range.to); }); draggedBlockElementsRef.current = sources; sources.forEach((source) => source.classList.add('is-block-dragging')); if (sources[0]) { const preview = document.createElement('div'); preview.className = 'block-editor-drag-preview'; preview.style.width = `${Math.min(sources[0].getBoundingClientRect().width, 560)}px`; sources.forEach((source) => preview.append(source.cloneNode(true))); document.body.append(preview); dragPreviewRef.current = preview; event.dataTransfer.setDragImage(preview, 18, 18); } event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/yuheng-block', String(range.from)); setDraggedBlock({ from: range.from, to: range.to }); setDropBlockTop(null); }} onDragEnd={clearDraggedBlock} onClick={(event) => { const current = controlledBlockRange(); if (!editor || !current) return; editor.commands.blur(); setSelectionToolbar(null); if (event.shiftKey && selectedBlocks) { const range = contiguousBlockRange(editor.state.doc, selectedBlocks.anchor, current.from); if (range) setSelectedBlocks({ anchor: selectedBlocks.anchor, ...range }); } else setSelectedBlocks({ anchor: current.from, from: current.from, to: current.to }); setBlockMenuOpen(true); }} aria-expanded={blockMenuOpen} aria-label="块操作和拖拽排序" title="拖拽排序或打开块操作"><GripVertical size={14} /></button>
      {(blockMenuOpen || blockMenuClosing) && <div className={`block-editor-block-menu ${blockMenuClosing ? 'is-closing' : ''}`} role="menu" aria-label="块操作菜单">
        {blockActionItems.map((item) => <button type="button" role="menuitem" key={item.id} onClick={() => applyBlockAction(item.id)}><item.icon size={14} /><span>{item.label}</span></button>)}
        <div className="block-editor-block-menu-separator" />
        <button type="button" role="menuitem" onClick={duplicateBlock}><Copy size={14} /><span>创建副本</span></button>
        {onMoveBlock && noteLinkOptions.length > 0 && <><button type="button" role="menuitem" onClick={() => setMoveMenuOpen((current) => !current)} disabled={blockMoveBusy}><MoveRight size={14} /><span>移动到页面</span></button>{moveMenuOpen && <div className="block-editor-move-menu">{noteLinkOptions.map((option) => <button type="button" key={option.id} onClick={() => void moveBlock(option.id)}><span>{option.icon ?? '▧'}</span><span>{option.title}</span></button>)}</div>}</>}
        <button type="button" role="menuitem" className="is-destructive" onClick={deleteBlock}><Trash2 size={14} /><span>删除块</span></button>
      </div>}
    </div>}
    {assetError && <div className="block-editor-error" role="alert">{assetError}<button type="button" onClick={() => setAssetError(null)} aria-label="关闭错误提示">×</button></div>}
    {slash && <div className="block-editor-slash-menu" style={{ left: slash.left, top: slash.top }} role="menu" aria-label="插入内容块">
      {filteredSlashItems.length > 0 ? visibleSlashGroups.map((group) => <div className="block-editor-slash-group" key={group.id}><div className="block-editor-slash-group-label">{group.label}</div>{group.commands.map((command) => { const index = filteredSlashItems.findIndex((item) => item.id === command.id); const Icon = slashCommandIcons[command.id]; return <button type="button" role="menuitem" className={index === slashIndex ? 'is-active' : ''} key={command.id} onMouseDown={(event) => { event.preventDefault(); applySlashItem(command.id); }}><span><Icon size={15} /></span><span><strong>{command.label}</strong><small>{command.hint}</small></span></button>; })}</div>) : <p>没有匹配的内容块</p>}
    </div>}
    {noteLink && <div className="block-editor-note-link-menu" style={{ left: noteLink.left, top: noteLink.top }} role="listbox" aria-label="选择知识库页面">
      {filteredNoteLinks.length > 0 ? filteredNoteLinks.map((option, index) => <button type="button" key={option.id} className={index === noteLinkIndex ? 'is-active' : ''} onMouseDown={(event) => { event.preventDefault(); insertNoteLink(option); }} role="option" aria-selected={index === noteLinkIndex}><span className="block-editor-note-link-icon">{option.icon ?? '▧'}</span><span>{option.title}</span></button>) : <p>没有匹配的知识库页面</p>}
      {noteLink.label && <button type="button" className="block-editor-note-link-external" onMouseDown={(event) => { event.preventDefault(); setNoteLink(null); setLink(); }} role="option"><span className="block-editor-note-link-icon"><Link size={14} /></span><span>添加外部链接</span></button>}
    </div>}
    {mention && <div className="block-editor-mention-menu" style={{ left: mention.left, top: mention.top }} role="listbox" aria-label="选择提及对象">
      {filteredMentions.length > 0 ? filteredMentions.map((option, index) => <button type="button" key={`${option.kind}:${option.id}`} className={index === mentionIndex ? 'is-active' : ''} onMouseDown={(event) => { event.preventDefault(); insertMention(option); }} role="option" aria-selected={index === mentionIndex}><span className="block-editor-mention-icon">{option.kind === 'date' ? <CalendarDays size={15} /> : option.kind === 'task' ? <ListTodo size={15} /> : option.icon ?? <AtSign size={15} />}</span><span><strong>{option.title}</strong>{option.detail && <small>{option.detail}</small>}</span></button>) : <p>没有匹配的页面、任务或日期</p>}
    </div>}
  </div>;
}
