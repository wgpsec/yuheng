import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Archive, LayoutDashboard, ListTodo, MessageSquare, Plus, Search, X } from 'lucide-react';
import type { SearchResult, SearchResultKind } from '../../contracts/desktop-bridge';

type SearchFilter = 'all' | 'conversation' | 'tasks';

const groupOrder: SearchResultKind[] = ['conversation', 'message', 'task', 'board'];
const groupLabels: Record<SearchResultKind, string> = {
  conversation: '会话',
  message: '消息',
  task: '任务',
  board: '看板',
};

function ResultIcon({ kind }: { kind: SearchResultKind }) {
  if (kind === 'task') return <ListTodo size={15} aria-hidden="true" />;
  if (kind === 'board') return <LayoutDashboard size={15} aria-hidden="true" />;
  return <MessageSquare size={15} aria-hidden="true" />;
}

function resultDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

function matchesFilter(result: SearchResult, filter: SearchFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'conversation') return result.kind === 'conversation' || result.kind === 'message';
  return result.kind === 'task' || result.kind === 'board';
}

export function GlobalSearch({ onQuery, onOpen, onClose, onNewConversation, onOpenTasks }: {
  onQuery: (query: string) => Promise<SearchResult[]>;
  onOpen: (result: SearchResult) => void;
  onClose: () => void;
  onNewConversation?: () => void;
  onOpenTasks?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [filter, setFilter] = useState<SearchFilter>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const filtered = useMemo(() => results.filter((result) => matchesFilter(result, filter)), [filter, results]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void onQuery(query).then((next) => {
        if (currentRequest !== requestId.current) return;
        setResults(next);
        setLoading(false);
      }).catch((reason) => {
        if (currentRequest !== requestId.current) return;
        setResults([]);
        setLoading(false);
        setError(reason instanceof Error ? reason.message : '搜索失败。');
      });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [onQuery, query]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    resultsRef.current?.querySelector<HTMLElement>(`[data-search-index="${selectedIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    closeTimerRef.current = window.setTimeout(onClose, reducedMotion ? 0 : 150);
  };

  const openSelected = (result: SearchResult | undefined) => {
    if (!result) return;
    onOpen(result);
    requestClose();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((current) => filtered.length > 0 ? (current + 1) % filtered.length : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((current) => filtered.length > 0 ? (current - 1 + filtered.length) % filtered.length : 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      openSelected(filtered[selectedIndex]);
    }
  };

  return <div className={`global-search-backdrop ${closing ? 'is-closing' : ''}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
    <section className="global-search-dialog" role="dialog" aria-modal="true" aria-labelledby="global-search-title" onKeyDown={handleKeyDown}>
      <h2 id="global-search-title" className="sr-only">搜索玉衡</h2>
      <div className="global-search-input-row">
        <Search size={18} aria-hidden="true" />
        <input ref={inputRef} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); }} placeholder="搜索会话、消息和任务" aria-label="搜索玉衡" autoComplete="off" />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="清除搜索"><X size={15} /></button>}
      </div>
      <div className="global-search-filters" role="tablist" aria-label="搜索范围" data-filter={filter}>
        {([['all', '全部'], ['conversation', '对话'], ['tasks', '任务']] as const).map(([value, label]) => <button type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'is-selected' : ''} key={value} onClick={() => { setFilter(value); setSelectedIndex(0); }}>{label}</button>)}
      </div>
      <div className="global-search-results" role="listbox" aria-label="搜索结果" ref={resultsRef}>
        {!query.trim() && <div className="global-search-actions" aria-label="快捷操作">
          {onNewConversation && <button type="button" className="global-search-action" onClick={() => { onNewConversation(); requestClose(); }}><Plus size={15} aria-hidden="true" /><span>新建会话</span><kbd>⌘ N</kbd></button>}
          {onOpenTasks && <button type="button" className="global-search-action" onClick={() => { onOpenTasks(); requestClose(); }}><ListTodo size={15} aria-hidden="true" /><span>打开任务</span><kbd>⌘ ⇧ T</kbd></button>}
        </div>}
        {groupOrder.map((kind) => {
          const group = filtered.filter((result) => result.kind === kind);
          if (group.length === 0) return null;
          return <section className="global-search-group" key={kind} aria-label={groupLabels[kind]}>
            <div className="global-search-group-label">{groupLabels[kind]}</div>
            {group.map((result) => {
              const index = filtered.indexOf(result);
              return <button type="button" role="option" aria-selected={selectedIndex === index} data-search-index={index} className={`global-search-result ${selectedIndex === index ? 'is-selected' : ''}`} key={`${result.kind}:${result.id}`} onMouseMove={() => setSelectedIndex(index)} onClick={() => openSelected(result)}>
                <span className="global-search-result-icon"><ResultIcon kind={result.kind} /></span>
                <span className="global-search-result-copy"><span className="global-search-result-title">{result.title}{result.archived && <span className="global-search-archived"><Archive size={11} aria-hidden="true" />已归档</span>}</span>{result.snippet && result.snippet !== result.title && <span className="global-search-result-snippet">{result.snippet}</span>}<span className="global-search-result-context">{result.context}{result.kind === 'message' ? ` · ${result.title}` : ''}</span></span>
                <time>{resultDate(result.updatedAt)}</time>
              </button>;
            })}
          </section>;
        })}
        {!loading && !error && filtered.length === 0 && <div className="global-search-empty">没有匹配的内容</div>}
        {loading && <div className="global-search-empty" role="status">正在搜索...</div>}
        {error && <div className="global-search-empty is-error" role="alert">{error}</div>}
      </div>
    </section>
  </div>;
}
