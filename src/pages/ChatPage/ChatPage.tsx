import { useState, useRef, useEffect, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { Send, Trash2, Loader2, Bot, User, Sparkles, Cpu, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import content, { pick } from '@/data/content';
import { useLang } from '@/hooks/useLang';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error' | 'loading';
  content: string;
  model?: string;
  provider?: 'gemini' | 'deepseek';
}

const STORAGE_KEY = '__app_srt27_chat_history';
const META_KEY = '__app_srt27_chat_meta';

// 农机类型选项（轻量，不强制）
const MACHINE_TYPES_ZH = ['拖拉机', '联合收割机', '插秧机', '植保机', '新能源农机', '无人农机', '其他'];
const MACHINE_TYPES_EN = ['Tractor', 'Combine', 'Transplanter', 'Sprayer', 'New-energy', 'Autonomous', 'Other'];

function generateId() {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadHistory(): ChatMessage[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    // 关闭页面时若正在请求，localStorage 里可能残留 loading/error 占位消息；恢复时丢弃
    return Array.isArray(parsed)
      ? parsed.filter((m): m is ChatMessage =>
          m !== null && typeof m === 'object' && typeof m.id === 'string' &&
          typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant')
        ).slice(-100).map((m) => ({
          id: m.id, role: m.role, content: m.content,
          model: typeof m.model === 'string' ? m.model : undefined,
          provider: m.provider === 'gemini' || m.provider === 'deepseek' ? m.provider : undefined,
        }))
      : [];
  } catch {
    return [];
  }
}

function loadMeta(): { machineType: string; brand: string; model: string } {
  try {
    const meta = localStorage.getItem(META_KEY);
    if (!meta) return { machineType: '', brand: '', model: '' };
    const m = JSON.parse(meta);
    return {
      machineType: typeof m?.machineType === 'string' ? (MACHINE_TYPES_ZH[MACHINE_TYPES_EN.indexOf(m.machineType)] || m.machineType) : '',
      brand: typeof m?.brand === 'string' ? m.brand : '',
      model: typeof m?.model === 'string' ? m.model : '',
    };
  } catch {
    return { machineType: '', brand: '', model: '' };
  }
}

export default function ChatPage() {
  const lang = useLang();
  const t = useCallback((zh: string, en: string) => (lang === 'zh' ? zh : en), [lang]);
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentModel, setCurrentModel] = useState<string>('');
  const [currentProvider, setCurrentProvider] = useState<'gemini' | 'deepseek' | ''>('');
  const [machineType, setMachineType] = useState<string>(() => loadMeta().machineType);
  const [brand, setBrand] = useState<string>(() => loadMeta().brand);
  const [model, setModel] = useState<string>(() => loadMeta().model);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 保存历史
  useEffect(() => {
    try {
      if (messages.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-100)));
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }, [messages]);
  useEffect(() => {
    try {
      localStorage.setItem(META_KEY, JSON.stringify({ machineType, brand, model }));
    } catch { /* ignore */ }
  }, [machineType, brand, model]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 100);
    return () => window.clearTimeout(timer);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > 2000 || requestRef.current) return;
      const controller = new AbortController();
      requestRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), 45_000);

      const userMsg: ChatMessage = { id: generateId(), role: 'user', content: trimmed };
      const loadingMsg: ChatMessage = { id: generateId(), role: 'loading', content: '' };

      setMessages((prev) => [...prev, userMsg, loadingMsg]);
      setInput('');
      setIsLoading(true);

      try {
        // 前端只发 user/assistant 历史；system prompt 由后端构造
        const historyForApi = messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(-20)
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [...historyForApi, { role: 'user' as const, content: trimmed }],
            machineType: machineType || undefined,
            brand: brand || undefined,
            model: model || undefined,
          }),
          // 后端单请求上限约 20s，前端留足余量，避免网络异常时永久转圈
          signal: controller.signal,
        });

        let reply = '';
        let modelName = '';
        let provider: 'gemini' | 'deepseek' | '' = '';
        if (response.ok) {
          const data = await response.json();
          const result = data?.choices?.[0]?.message?.content;
          if (typeof result !== 'string' || !result.trim()) throw new Error('Empty response');
          reply = result;
          modelName = typeof data?.model === 'string' ? data.model : '';
          provider = data?.provider === 'gemini' || data?.provider === 'deepseek' ? data.provider : '';
        } else {
          // 后端已脱敏，统一友好文案
          const errData = await response.json().catch(() => null);
          reply = (typeof errData?.error === 'string' && errData.error) || t('智能诊断服务暂时无法连接，请稍后重试。', 'AI service unavailable, please try again later.');
        }

        if (requestRef.current !== controller) return;
        if (modelName) setCurrentModel(modelName);
        setCurrentProvider(provider);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingMsg.id
              ? {
                  ...m,
                  role: reply && response.ok ? ('assistant' as const) : ('error' as const),
                  content: reply,
                  model: modelName || undefined,
                  provider: provider || undefined,
                }
              : m,
          ),
        );
      } catch {
        if (requestRef.current !== controller) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingMsg.id
              ? {
                  ...m,
                  role: 'error' as const,
                  content: t('智能诊断服务暂时无法连接，请稍后重试。', 'AI service unavailable, please try again later.'),
                }
              : m,
          ),
        );
        toast.error(t('对话服务暂不可用', 'Chat service unavailable'));
      } finally {
        window.clearTimeout(timeout);
        if (requestRef.current === controller) {
          requestRef.current = null;
          setIsLoading(false);
          setTimeout(() => textareaRef.current?.focus(), 0);
        }
      }
    },
    [messages, machineType, brand, model, t],
  );

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      sendMessage(input);
    },
    [input, sendMessage],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        sendMessage(input);
      }
    },
    [input, sendMessage],
  );

  const handleQuickQuestion = useCallback(
    (question: string) => {
      sendMessage(question);
    },
    [sendMessage],
  );

  const stopRequest = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setIsLoading(false);
    setMessages((prev) => prev.filter((m) => m.role !== 'loading'));
    textareaRef.current?.focus();
  }, []);

  const handleClear = useCallback(() => {
    stopRequest();
    setCurrentModel('');
    setCurrentProvider('');
    setMessages([]);
    setIsLoading(false);
    toast.success(t('对话已清空', 'Chat cleared'));
  }, [t, stopRequest]);

  const isEmpty = messages.length === 0;
  const typeOptions = lang === 'zh' ? MACHINE_TYPES_ZH : MACHINE_TYPES_EN;

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col bg-background">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between border-b border-border/60 bg-card/50 px-4 py-3 md:px-6">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">司农智机 · {t('故障诊断', 'Diagnosis')}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">{t('本地知识库 + LLM', 'Local KB + LLM')}</span>
              {currentProvider && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-accent/60 px-1.5 py-0.5 text-[11px] text-foreground">
                  <Cpu className="h-3 w-3 text-primary" />
                  {currentProvider === 'gemini' ? 'Gemini' : 'DeepSeek'}
                </span>
              )}
              {currentModel && (
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-border/60 bg-accent/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  {currentModel}
                </span>
              )}
            </div>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="secondary" size="sm" className="gap-1.5 shrink-0" aria-label={t('清空对话', 'Clear conversation')} disabled={isEmpty}>
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">{t('清空对话', 'Clear')}</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('确认清空对话？', 'Clear all messages?')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('清空后当前所有对话记录将被删除，且无法恢复。', 'All current messages will be deleted and cannot be recovered.')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('取消', 'Cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleClear}>{t('确认清空', 'Clear')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* 消息列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto" role="log" aria-label={t('诊断对话', 'Diagnosis conversation')} aria-live="polite">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
          {/* 空状态 / 欢迎态 */}
          {isEmpty && (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="h-7 w-7" />
              </div>
              <h2 className="font-serif text-xl font-bold text-foreground">{pick(content.CHAT_WELCOME.title, lang)}</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">{pick(content.CHAT_WELCOME.desc, lang)}</p>

              {/* 农机信息选择（可选） */}
              <div className="mt-6 w-full max-w-xl rounded-xl border border-border/60 bg-card p-4 text-left">
                <div className="mb-2 text-xs font-medium text-wheat">{t('农机信息（可选，帮助检索）', 'Machine info (optional, improves retrieval)')}</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <select
                    aria-label={t('农机类型', 'Machine type')}
                    value={machineType}
                    onChange={(e) => setMachineType(e.target.value)}
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                  >
                    <option value="">{t('类型', 'Type')}</option>
                    {typeOptions.map((v, index) => (
                      <option key={MACHINE_TYPES_ZH[index]} value={MACHINE_TYPES_ZH[index]}>{v}</option>
                    ))}
                  </select>
                  <input
                    aria-label={t('品牌', 'Brand')}
                    maxLength={100}
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder={t('品牌（选填）', 'Brand (optional)')}
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                  />
                  <input
                    aria-label={t('型号', 'Model')}
                    maxLength={100}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={t('型号（选填）', 'Model (optional)')}
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                  />
                </div>
              </div>

              {/* 快捷提问按钮 */}
              <div className="mt-6 w-full">
                <div className="mb-3 text-xs font-medium text-wheat">{t('您可以这样问', 'Try asking')}</div>
                <div className="grid gap-2 md:grid-cols-2">
                  {content.CHAT_QUICK_QUESTIONS.map((q) => (
                    <button
                      key={pick(q, lang)}
                      onClick={() => handleQuickQuestion(pick(q, lang))}
                      disabled={isLoading}
                      className="rounded-md border border-border/60 bg-card p-3 text-left text-sm text-foreground transition-all hover:border-primary/40 hover:bg-accent/50 hover:text-primary disabled:opacity-50"
                    >
                      {pick(q, lang)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 消息列表 */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`mb-4 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role !== 'user' && (
                <div className="mr-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </div>
              )}
              <div
                className={`min-w-0 break-words max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed md:max-w-[75%] ${
                  msg.role === 'user'
                    ? 'rounded-tr-sm bg-primary text-primary-foreground'
                    : msg.role === 'error'
                    ? 'rounded-tl-sm border border-destructive/30 bg-destructive/5 text-destructive'
                    : msg.role === 'loading'
                    ? 'rounded-tl-sm border border-border/60 bg-card text-muted-foreground'
                    : 'rounded-tl-sm border border-border/60 bg-card text-foreground'
                }`}
              >
                {msg.role === 'loading' ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t('正在思考...', 'Thinking...')}</span>
                  </div>
                ) : msg.role === 'user' ? (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                ) : (
                  <div className="prose prose-sm max-w-none overflow-x-auto dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    {msg.role === 'assistant' && msg.model && (
                      <div className="mt-1.5 text-right text-[11px] text-muted-foreground/70">
                        {msg.provider === 'gemini' ? 'Gemini' : msg.provider === 'deepseek' ? 'DeepSeek' : ''} · {msg.model}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="ml-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/80 text-primary-foreground">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 输入区 */}
      <div className="border-t border-border/60 bg-card/50 px-4 py-4 md:px-6">
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2">
            <Textarea
              aria-label={t('故障描述', 'Fault description')}
              aria-describedby="chat-input-help"
              aria-invalid={input.trim().length > 2000}
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('描述您遇到的农机故障现象...', 'Describe the fault symptom...')}
              className="min-h-[60px] resize-none"
              rows={2}
              disabled={isLoading}
            />
            {isLoading ? (
              <Button type="button" size="icon" onClick={stopRequest} aria-label={t('停止等待', 'Stop waiting')} title={t('停止等待', 'Stop waiting')}>
                <Square className="h-4 w-4" />
              </Button>
            ) : <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || input.trim().length > 2000}
              className="shrink-0"
              aria-label={t('发送', 'Send')}
            >
              <Send className="h-4 w-4" />
            </Button>}
          </div>
          <div id="chat-input-help" className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
            <span>{t('按 Enter 发送，Shift + Enter 换行', 'Enter to send, Shift+Enter for newline')}</span>
            <span className={input.trim().length > 2000 ? 'text-destructive' : ''}>{input.trim().length} / 2000</span>
          </div>
        </form>
      </div>
    </div>
  );
}
