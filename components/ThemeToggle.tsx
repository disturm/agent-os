'use client';

import { DesktopIcon, MoonIcon, SunIcon } from '@radix-ui/react-icons';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

type Theme = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const OPTIONS = [
  { value: 'system', label: 'Как в системе', Icon: DesktopIcon },
  { value: 'light', label: 'Светлая тема', Icon: SunIcon },
  { value: 'dark', label: 'Тёмная тема', Icon: MoonIcon },
] as const satisfies readonly { value: Theme; label: string; Icon: typeof DesktopIcon }[];

/** Разворачивает выбор в конкретный `data-theme` — единственное место, где живёт эта развилка. */
function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia(DARK_QUERY).matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/**
 * Три состояния, а не два: без «как в системе» этот режим становится недостижим после первого клика.
 * Значение хранится в localStorage, атрибут на <html> при загрузке ставит скрипт из layout.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  const [ready, setReady] = useState(false);

  // localStorage читается только после монтирования: на сервере его нет, иначе разъедется гидрация.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') setTheme(stored);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;

    applyTheme(theme);

    if (theme !== 'system') {
      localStorage.setItem(STORAGE_KEY, theme);
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme, ready]);

  return (
    <div
      role="radiogroup"
      aria-label="Тема оформления"
      className="inline-flex shrink-0 gap-0.5 rounded-md border border-border bg-card p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            'rounded-sm p-1.5 text-muted-foreground transition-colors outline-none',
            'hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
            theme === value && 'bg-secondary text-foreground',
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
