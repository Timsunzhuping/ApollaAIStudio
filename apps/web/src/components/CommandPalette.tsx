import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Command {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
  run: (navigate: (to: string) => void) => void;
}

const COMMANDS: Command[] = [
  { id: 'research', label: '新建研究', hint: 'Research', keywords: 'research yanjiu 研究 report 报告', run: (n) => n('/research') },
  { id: 'chat', label: '打开聊天', hint: 'Chat', keywords: 'chat liaotian 聊天 对话', run: (n) => n('/chat') },
  { id: 'inbox', label: '任务收件箱', hint: 'Inbox', keywords: 'inbox tasks history 任务 历史 收件箱', run: (n) => n('/inbox') },
  { id: 'workspace', label: '工作区文件', hint: 'Workspace', keywords: 'workspace files wenjian 文件 工作区', run: (n) => n('/workspace') },
  { id: 'collab', label: '协同文档', hint: 'Collab', keywords: 'collab 协同 协作 文档', run: (n) => n('/collab') },
  { id: 'surfaces', label: 'Surfaces（翻译/表格/纪要）', hint: 'Surfaces', keywords: 'surfaces translate sheet notes 翻译 表格 纪要', run: (n) => n('/surfaces') },
  { id: 'agent', label: 'Agent & Cowork', hint: 'Agent', keywords: 'agent cowork 代理 插件', run: (n) => n('/agent') },
  { id: 'automation', label: '自动化（定时/Job）', hint: 'Automation', keywords: 'automation schedule jobs 定时 自动化', run: (n) => n('/automation') },
  { id: 'billing', label: '套餐与用量', hint: 'Billing', keywords: 'billing plan usage 计费 套餐 用量', run: (n) => n('/billing') },
  { id: 'settings', label: '设置', hint: 'Settings', keywords: 'settings 设置 token mfa 账号', run: (n) => n('/settings') },
];

/** ⌘K / Ctrl+K command palette (S26A-U5): fuzzy navigation without leaving the keyboard. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery('');
        setActive(0);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) => c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q));
  }, [query]);

  const exec = (c: Command) => {
    setOpen(false);
    c.run(navigate);
  };

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="命令面板"
      style={{ position: 'fixed', inset: 0, background: 'rgba(31,30,28,0.35)', zIndex: 100, display: 'flex', justifyContent: 'center', paddingTop: '14vh' }}
      onClick={() => setOpen(false)}
    >
      <div
        style={{ width: 520, maxWidth: '92vw', height: 'fit-content', background: 'var(--panel)', borderRadius: 14, boxShadow: 'var(--shadow-float)', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          aria-label="搜索命令"
          placeholder="输入以搜索页面与动作…"
          value={query}
          style={{ width: '100%', border: 'none', borderBottom: '1px solid var(--bd)', borderRadius: 0, padding: '0.9rem 1.1rem', fontSize: '1rem' }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && matches[active]) exec(matches[active]);
          }}
        />
        <div role="listbox" aria-label="命令列表" style={{ maxHeight: 320, overflowY: 'auto', padding: '0.35rem' }}>
          {matches.length === 0 && <div className="muted" style={{ padding: '0.75rem 1rem' }}>没有匹配的命令</div>}
          {matches.map((c, i) => (
            <button
              key={c.id}
              role="option"
              aria-selected={i === active}
              className="navlink"
              style={{ width: '100%', border: 'none', background: i === active ? 'var(--accent-wash)' : 'transparent', justifyContent: 'space-between', display: 'flex' }}
              onMouseEnter={() => setActive(i)}
              onClick={() => exec(c)}
            >
              <span>{c.label}</span>
              {c.hint && <span className="muted" style={{ fontSize: '0.78rem' }}>{c.hint}</span>}
            </button>
          ))}
        </div>
        <div className="muted" style={{ padding: '0.5rem 1.1rem', borderTop: '1px solid var(--bd)', fontSize: '0.72rem' }}>↑↓ 选择 · Enter 打开 · Esc 关闭</div>
      </div>
    </div>
  );
}
