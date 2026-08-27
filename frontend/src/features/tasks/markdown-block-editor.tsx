import { Markdown } from '@tiptap/markdown';
import ImageExtension from '@tiptap/extension-image';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Braces, CheckSquare, Heading1, Heading2, Italic, Link, List, ListOrdered, Paperclip, Quote, Strikethrough, Text } from 'lucide-react';
import { useRef, useState } from 'react';
import type { TaskAsset } from '../../contracts/desktop-bridge';

type SlashState = { query: string; from: number; to: number; left: number; top: number };

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

export function MarkdownBlockEditor({ value, onChange, onImportAsset, onPickAssets, onOpenAsset }: {
  value: string;
  onChange: (markdown: string) => void;
  onImportAsset: (file: File) => Promise<TaskAsset>;
  onPickAssets: () => Promise<TaskAsset[]>;
  onOpenAsset: (url: string) => Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [, refreshToolbar] = useState(0);
  const [assetBusy, setAssetBusy] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const editor = useEditor({
    extensions: [
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
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0) return false;
        event.preventDefault();
        void importFiles(files);
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
        void onOpenAsset(href).catch((reason) => setAssetError(reason instanceof Error ? reason.message : '打开附件失败。'));
        return true;
      },
    },
    onSelectionUpdate: () => refreshToolbar((current) => current + 1),
    onUpdate: ({ editor: currentEditor }) => {
      onChange(currentEditor.getMarkdown());
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
      for (const file of files) imported.push(await onImportAsset(file));
      insertAssets(imported);
    } catch (reason) {
      setAssetError(reason instanceof Error ? reason.message : '保存附件失败。');
    } finally {
      setAssetBusy(false);
    }
  };

  const pickAssets = async () => {
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

  const setLink = () => {
    if (!editor) return;
    const existing = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('链接地址', existing ?? 'https://');
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  };

  const filteredSlashItems = slashItems.filter((item) => !slash?.query || `${item.label}${item.hint}${item.id}`.toLowerCase().includes(slash.query));

  return <div className="block-editor" ref={containerRef}>
    <div className="block-editor-toolbar" aria-label="文本格式">
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
      <button type="button" onClick={() => void pickAssets()} aria-label="添加图片或附件" title="添加图片或附件" disabled={assetBusy}><Paperclip size={14} /></button>
      {assetBusy && <span className="block-editor-uploading">保存中...</span>}
    </div>
    <EditorContent editor={editor} className="block-editor-content" />
    {assetError && <div className="block-editor-error" role="alert">{assetError}<button type="button" onClick={() => setAssetError(null)} aria-label="关闭附件错误">×</button></div>}
    {slash && <div className="block-editor-slash-menu" style={{ left: slash.left, top: slash.top }}>
      {filteredSlashItems.length > 0 ? filteredSlashItems.map((item) => <button type="button" key={item.id} onMouseDown={(event) => { event.preventDefault(); applySlashItem(item.id); }}><span><item.icon size={15} /></span><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>) : <p>没有匹配的内容块</p>}
    </div>}
  </div>;
}
