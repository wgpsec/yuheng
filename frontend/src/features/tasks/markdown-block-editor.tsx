import { Markdown } from '@tiptap/markdown';
import type { AnyExtension } from '@tiptap/core';
import ImageExtension from '@tiptap/extension-image';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Braces, CheckSquare, GripVertical, Heading1, Heading2, Italic, Link, List, ListOrdered, Paperclip, Plus, Quote, Redo2, Strikethrough, Text, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { TaskAsset } from '../../contracts/desktop-bridge';

type SlashState = { query: string; from: number; to: number; left: number; top: number };
type BlockControlState = { left: number; top: number; position: number };
type BlockDragState = { from: number; to: number };

export function shouldInterpretMarkdownPaste(value: string): boolean {
  return /(^|\n)\s{0,3}(?:[-*+]\s+\[[ xX]\]|[-*+]\s+|#{1,6}\s+|\d+[.)]\s+)/u.test(value)
    || /(^|\n)\s{0,3}(?:\*\*|__|```|>\s)/u.test(value);
}

const slashItems = [
  { id: 'paragraph', label: '正文', hint: '普通文本块', icon: Text },
  { id: 'heading1', label: '一级标题', hint: '大标题', icon: Heading1 },
  { id: 'heading2', label: '二级标题', hint: '章节标题', icon: Heading2 },
  { id: 'bulletList', label: '项目列表', hint: '无序列表', icon: List },
  { id: 'orderedList', label: '编号列表', hint: '有序列表', icon: ListOrdered },
  { id: 'taskList', label: '任务清单', hint: '可勾选列表', icon: CheckSquare },
  { id: 'blockquote', label: '引用', hint: '突出引用内容', icon: Quote },
  { id: 'codeBlock', label: '代码块', hint: '等宽代码内容', icon: Braces },
] as const;

export function MarkdownBlockEditor({ value, onChange, onImportAsset, onPickAssets, onOpenAsset, extensions = [] }: {
  value: string;
  onChange: (markdown: string) => void;
  onImportAsset?: (file: File) => Promise<TaskAsset>;
  onPickAssets?: () => Promise<TaskAsset[]>;
  onOpenAsset?: (url: string) => Promise<void>;
  extensions?: AnyExtension[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [blockControl, setBlockControl] = useState<BlockControlState | null>(null);
  const [blockMenuOpen, setBlockMenuOpenState] = useState(false);
  const [blockMenuClosing, setBlockMenuClosing] = useState(false);
  const [draggedBlock, setDraggedBlock] = useState<BlockDragState | null>(null);
  const [dropBlockTop, setDropBlockTop] = useState<number | null>(null);
  const draggedBlockElementRef = useRef<HTMLElement | null>(null);
  const [, refreshToolbar] = useState(0);
  const [assetBusy, setAssetBusy] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [editState, setEditState] = useState<'saved' | 'editing'>('saved');
  const editStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockControlHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  }, []);
  const editor = useEditor({
    extensions: [
      ...extensions,
      StarterKit.configure({ link: { openOnClick: false, protocols: ['yuheng-task-asset'] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      ImageExtension.configure({ inline: false, allowBase64: false }),
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
        const target = event.target instanceof Element ? event.target.closest('a[href^="yuheng-task-asset://"]') : null;
        const href = target?.getAttribute('href');
        if (!href) return false;
        event.preventDefault();
        if (onOpenAsset) void onOpenAsset(href).catch((reason) => setAssetError(reason instanceof Error ? reason.message : '打开附件失败。'));
        return true;
      },
    },
    onSelectionUpdate: () => refreshToolbar((current) => current + 1),
    onUpdate: ({ editor: currentEditor }) => {
      onChange(currentEditor.getMarkdown());
      setEditState('editing');
      if (editStateTimerRef.current !== null) clearTimeout(editStateTimerRef.current);
      editStateTimerRef.current = setTimeout(() => { setEditState('saved'); editStateTimerRef.current = null; }, 700);
      const { $from } = currentEditor.state.selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
      const match = textBefore.match(/^\/([^\s/]*)$/u);
      const container = containerRef.current;
      if (!match || !container) return setSlash(null);
      const cursor = currentEditor.view.coordsAtPos($from.pos);
      const bounds = container.getBoundingClientRect();
      setSlash({ query: match[1].toLowerCase(), from: $from.start(), to: $from.pos, left: Math.max(8, cursor.left - bounds.left), top: cursor.bottom - bounds.top + 8 });
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getMarkdown();
    if (current === value) return;
    editor.commands.setContent(value, { contentType: 'markdown' });
  }, [editor, value]);

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

  const applySlashItem = (id: typeof slashItems[number]['id']) => {
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
    chain.run();
    setSlash(null);
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

  const blockRange = () => {
    if (!editor || !blockControl) return null;
    const resolved = editor.state.doc.resolve(blockControl.position);
    const depth = resolved.depth > 0 ? resolved.depth : 0;
    const node = depth > 0 ? resolved.node(depth) : resolved.nodeAfter;
    const from = depth > 0 ? resolved.before(depth) : resolved.pos;
    if (!node) return null;
    return { depth, node, from, to: from + node.nodeSize };
  };

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
    const resolved = editor.state.doc.resolve(position);
    const depth = resolved.depth > 0 ? resolved.depth : 0;
    const node = depth > 0 ? resolved.node(depth) : resolved.nodeAfter;
    const from = depth > 0 ? resolved.before(depth) : resolved.pos;
    return node ? { from, to: from + node.nodeSize } : null;
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
    const sourceNode = editor.state.doc.nodeAt(draggedBlock.from);
    if (!sourceNode) return;
    const insertAt = target.from > draggedBlock.from ? target.from - sourceNode.nodeSize : target.from;
    const transaction = editor.state.tr.delete(draggedBlock.from, draggedBlock.to).insert(insertAt, sourceNode);
    editor.view.dispatch(transaction);
    draggedBlockElementRef.current?.classList.remove('is-block-dragging');
    draggedBlockElementRef.current = null;
    setDraggedBlock(null);
    setDropBlockTop(null);
  };

  const clearDraggedBlock = () => {
    draggedBlockElementRef.current?.classList.remove('is-block-dragging');
    draggedBlockElementRef.current = null;
    setDraggedBlock(null);
    setDropBlockTop(null);
  };

  const applyBlockAction = (id: typeof slashItems[number]['id']) => {
    const range = blockRange();
    if (!editor || !range) return;
    let chain = editor.chain().focus().setTextSelection(Math.min(range.from + 1, editor.state.doc.content.size));
    if (id === 'paragraph') chain = chain.setParagraph();
    if (id === 'heading1') chain = chain.toggleHeading({ level: 1 });
    if (id === 'heading2') chain = chain.toggleHeading({ level: 2 });
    if (id === 'bulletList') chain = chain.toggleBulletList();
    if (id === 'orderedList') chain = chain.toggleOrderedList();
    if (id === 'taskList') chain = chain.toggleTaskList();
    if (id === 'blockquote') chain = chain.toggleBlockquote();
    if (id === 'codeBlock') chain = chain.toggleCodeBlock();
    chain.run();
    setBlockMenuOpen(false);
    setBlockControl(null);
  };

  const deleteBlock = () => {
    const range = blockRange();
    if (!editor || !range) return;
    editor.chain().focus().deleteRange({ from: range.from, to: range.to }).run();
    setBlockMenuOpen(false);
    setBlockControl(null);
  };

  const setLink = () => {
    if (!editor) return;
    const existing = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('链接地址', existing ?? 'https://');
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  };

  const filteredSlashItems = slashItems.filter((item) => !slash?.query || `${item.label}${item.hint}${item.id}`.toLowerCase().includes(slash.query));

  return <div className={`block-editor ${draggedBlock ? 'is-dragging-block' : ''}`} ref={containerRef} onMouseMove={updateBlockControl} onMouseLeave={scheduleBlockControlHide} onDragOver={handleBlockDragOver} onDrop={handleBlockDrop}>
    <div className="block-editor-toolbar" aria-label="文本格式">
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
      <button type="button" className={editor?.isActive('link') ? 'is-active' : ''} onClick={setLink} aria-label="链接" title="链接"><Link size={14} /></button>
      <span className="block-editor-divider" />
      {(onPickAssets || onImportAsset) && <button type="button" onClick={() => void pickAssets()} aria-label="添加图片或附件" title="添加图片或附件" disabled={assetBusy}><Paperclip size={14} /></button>}
      {assetBusy && <span className="block-editor-uploading">保存中...</span>}
    </div>
    <EditorContent editor={editor} className="block-editor-content" />
    {dropBlockTop !== null && <div className="block-editor-block-drop-indicator" style={{ top: dropBlockTop }} aria-hidden="true" />}
    {blockControl && <div className="block-editor-block-controls" style={{ left: blockControl.left, top: blockControl.top }} onMouseEnter={keepBlockControl} onMouseDown={(event) => { if (!(event.target as Element | null)?.closest('.block-editor-drag-handle')) event.preventDefault(); }}>
      <button type="button" onClick={insertBlockAfter} aria-label="在下方添加内容块" title="添加内容块"><Plus size={14} /></button>
      <button type="button" className="block-editor-drag-handle" draggable onDragStart={(event) => { const range = blockRange(); if (!range) return; const source = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('.ProseMirror > *') ?? []).find((candidate) => blockRangeForElement(candidate)?.from === range.from); draggedBlockElementRef.current = source ?? null; source?.classList.add('is-block-dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/yuheng-block', String(range.from)); setDraggedBlock({ from: range.from, to: range.to }); setDropBlockTop(null); }} onDragEnd={clearDraggedBlock} onClick={() => setBlockMenuOpen((current) => !current)} aria-expanded={blockMenuOpen} aria-label="块操作和拖拽排序" title="拖拽排序或打开块操作"><GripVertical size={14} /></button>
      {(blockMenuOpen || blockMenuClosing) && <div className={`block-editor-block-menu ${blockMenuClosing ? 'is-closing' : ''}`} role="menu" aria-label="块操作菜单">
        {slashItems.map((item) => <button type="button" role="menuitem" key={item.id} onClick={() => applyBlockAction(item.id)}><item.icon size={14} /><span>{item.label}</span></button>)}
        <div className="block-editor-block-menu-separator" />
        <button type="button" role="menuitem" className="is-destructive" onClick={deleteBlock}><Trash2 size={14} /><span>删除块</span></button>
      </div>}
    </div>}
    {assetError && <div className="block-editor-error" role="alert">{assetError}<button type="button" onClick={() => setAssetError(null)} aria-label="关闭附件错误">×</button></div>}
    {slash && <div className="block-editor-slash-menu" style={{ left: slash.left, top: slash.top }}>
      {filteredSlashItems.length > 0 ? filteredSlashItems.map((item) => <button type="button" key={item.id} onMouseDown={(event) => { event.preventDefault(); applySlashItem(item.id); }}><span><item.icon size={15} /></span><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>) : <p>没有匹配的内容块</p>}
    </div>}
  </div>;
}
