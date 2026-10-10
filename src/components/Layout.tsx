import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate, NavLink } from 'react-router-dom';
import { Menu, X, MessageSquare, Sun, Moon, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLang, setLang } from '@/hooks/useLang';
import { useVersion } from '@/hooks/useVersion';

const NAV_ZH = [
  { label: '首页', path: '/' },
  { label: '多模态方案', hash: 'multimodal' },
  { label: '智能体架构', hash: 'architecture' },
  { label: '应用场景', hash: 'scenarios' },
];
const NAV_EN = [
  { label: 'Home', path: '/' },
  { label: 'Multimodal', hash: 'multimodal' },
  { label: 'Architecture', hash: 'architecture' },
  { label: 'Scenarios', hash: 'scenarios' },
];

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('srt-theme');
    if (saved === 'dark') return 'dark';
    if (saved === 'light') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const lang = useLang();
  const location = useLocation();
  const navigate = useNavigate();
  const { version, source: versionSource } = useVersion();

  useEffect(() => {
    document.documentElement.classList.remove('theme-light', 'theme-dark');
    document.documentElement.classList.add(theme === 'dark' ? 'theme-dark' : 'theme-light');
    localStorage.setItem('srt-theme', theme);
  }, [theme]);

  const NAV_ITEMS = lang === 'zh' ? NAV_ZH : NAV_EN;
  const chatLabel = lang === 'zh' ? '智能体对话' : 'Agent Chat';

  const handleHashNav = (hash: string) => {
    setMobileOpen(false);
    if (location.pathname !== '/') {
      navigate(`/#${hash}`);
    } else {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* 顶部导航栏 */}
      <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 md:px-6 lg:px-8">
          {/* Logo */}
          <NavLink to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2">
                <circle cx="7" cy="16" r="3" />
                <circle cx="17" cy="16" r="3" />
                <path d="M4 16V10l8-4 8 4v6" />
                <path d="M12 6v10" />
              </svg>
            </div>
            <span className="font-serif text-lg font-bold text-foreground">司农智机</span>
          </NavLink>

          {/* 桌面端导航 */}
          <nav className="hidden items-center gap-6 md:flex">
            {NAV_ITEMS.map((item) =>
              item.hash ? (
                <button
                  key={item.hash}
                  onClick={() => handleHashNav(item.hash!)}
                  className="group relative text-sm text-muted-foreground transition-colors hover:text-primary"
                >
                  {item.label}
                  <span className="absolute -bottom-1 left-0 h-0.5 w-0 rounded-full bg-primary transition-all duration-300 group-hover:w-full" />
                </button>
              ) : (
                <NavLink
                  key={item.path}
                  to={item.path!}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    cn(
                      'group relative text-sm transition-colors hover:text-primary',
                      isActive ? 'text-primary font-semibold' : 'text-muted-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {item.label}
                      <span
                        className={cn(
                          'absolute -bottom-1 left-0 h-0.5 rounded-full bg-primary transition-all duration-300',
                          isActive ? 'w-full' : 'w-0 group-hover:w-full',
                        )}
                      />
                    </>
                  )}
                </NavLink>
              ),
            )}
            <Button asChild size="sm" className="gap-1.5">
              <NavLink to="/chat">
                <MessageSquare className="h-4 w-4" />
                {chatLabel}
              </NavLink>
            </Button>
          </nav>

          {/* 右侧工具按钮（主题 + 语言 + 移动端菜单） */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-all hover:bg-accent hover:text-primary hover:scale-105"
              aria-label="切换主题"
              title={theme === 'dark' ? '切到亮色' : '切到暗色'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              className="flex h-9 items-center gap-1 rounded-full border border-border px-3 text-xs font-medium text-muted-foreground transition-all hover:bg-accent hover:text-primary hover:scale-105"
              aria-label="切换语言"
            >
              <Globe className="h-4 w-4" />
              {lang === 'zh' ? 'EN' : '中'}
            </button>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-md border border-border md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="菜单"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* 移动端导航抽屉 */}
        {mobileOpen && (
          <div className="border-t border-border/60 bg-background md:hidden">
            <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
              {NAV_ITEMS.map((item) =>
                item.hash ? (
                  <button
                    key={item.hash}
                    onClick={() => handleHashNav(item.hash!)}
                    className="rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-primary"
                  >
                    {item.label}
                  </button>
                ) : (
                  <NavLink
                    key={item.path}
                    to={item.path!}
                    end={item.path === '/'}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'rounded-md px-3 py-2 text-sm transition-colors',
                        isActive ? 'bg-accent text-primary font-semibold' : 'text-muted-foreground hover:bg-accent hover:text-primary',
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                ),
              )}
              <Button asChild size="sm" className="mt-2 gap-1.5">
                <NavLink to="/chat" onClick={() => setMobileOpen(false)}>
                  <MessageSquare className="h-4 w-4" />
                  {chatLabel}
                </NavLink>
              </Button>
            </nav>
          </div>
        )}
      </header>

      {/* 主内容区 */}
      <main className="flex-1 w-full">
        <Outlet />
      </main>

      {/* 页脚：版本号来自后端运行时接口，发布后无需重新构建前端即可刷新 */}
      <footer className="border-t border-border/60 bg-background/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-1 px-4 py-4 text-xs text-muted-foreground md:flex-row md:px-6 lg:px-8">
          <span>© 2026 司农智机 SRT27 · 南京农业大学</span>
          <span className="flex items-center gap-2">
            {version && (
              <>
                <span
                  title={
                    versionSource === 'live'
                      ? `运行时版本${version.commitShort ? ` · commit ${version.commitShort}` : ''}${version.startedAt ? ` · 启动于 ${version.startedAt}` : ''}`
                      : '构建期版本（后端接口不可用）'
                  }
                  className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-accent/50 px-2 py-0.5 font-mono"
                >
                  {version.display}
                  {versionSource === 'build' && (
                    <span className="text-muted-foreground/70">
                      {lang === 'zh' ? '构建版' : 'build'}
                    </span>
                  )}
                </span>
                {version.commitShort && (
                  <span className="hidden font-mono sm:inline">{version.commitShort}</span>
                )}
              </>
            )}
            <a
              href="https://github.com/Changjie29/AgriDx-v1/blob/main/CHANGELOG.md"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-2 transition-colors hover:text-primary"
            >
              {lang === 'zh' ? '更新日志' : 'Changelog'}
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
