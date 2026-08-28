import { CalendarDays, FileText, ListTodo } from 'lucide-react';
import type { ReactNode } from 'react';
import { ThinkingOrb } from 'thinking-orbs';

const starterPrompts = [
  { icon: CalendarDays, label: '整理计划', prompt: '帮我整理今天的计划，并按优先级排列。' },
  { icon: FileText, label: '总结资料', prompt: '帮我总结一份资料，提取重点和下一步行动。' },
  { icon: ListTodo, label: '记录待办', prompt: '帮我记录一个待办，并确认截止时间和优先级。' },
];

export function ConversationStart({ composer, onSelectPrompt }: { composer: ReactNode; onSelectPrompt: (prompt: string) => void }) {
  return (
    <section className="conversation-start" aria-labelledby="conversation-start-title">
      <div className="conversation-start-heading">
        <div className="conversation-start-orb"><ThinkingOrb state="breathing" size={64} theme="dark" /></div>
        <h2 id="conversation-start-title">今天想先处理什么？</h2>
      </div>
      <div className="conversation-start-composer">{composer}</div>
      <nav className="conversation-starters" aria-label="快捷开始">
        {starterPrompts.map(({ icon: Icon, label, prompt }) => (
          <button type="button" key={label} onClick={() => onSelectPrompt(prompt)}>
            <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </section>
  );
}
