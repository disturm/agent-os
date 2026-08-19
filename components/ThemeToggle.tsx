'use client';

import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Иконки инлайном: по `docs/spec9.md` UI-библиотек в проекте не осталось, а тащить пакет
 * ради трёх глифов незачем. Пути обычные, из набора Radix Icons.
 */
const ICONS: Record<Theme, string> = {
  system: 'M2 3h12v8H2zM6 13h4M8 11v2',
  light: 'M8 3.5v-2M8 14.5v-2M12.5 8h2M1.5 8h2M11.2 4.8l1.4-1.4M3.4 12.6l1.4-1.4M11.2 11.2l1.4 1.4M3.4 3.4l1.4 1.4M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  dark: 'M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z',
};

const OPTIONS = [
  { value: 'system', label: 'Как в системе' },
  { value: 'light', label: 'Светлая тема' },
  { value: 'dark', label: 'Тёмная тема' },
] as const satisfies readonly { value: Theme; label: string }[];

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
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={`rounded-sm p-1.5 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${
            theme === value ? 'bg-secondary text-foreground' : 'text-muted-foreground'
          }`}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className="size-4">
            <path d={ICONS[value]} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ))}
    </div>
  );
}
