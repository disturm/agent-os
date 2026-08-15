import type { ReactNode } from 'react';
import { Golos_Text, JetBrains_Mono, Playfair_Display } from 'next/font/google';

import './globals.css';

// Кириллица обязательна: интерфейс и планы — на русском.
const sans = Golos_Text({ subsets: ['latin', 'cyrillic'], variable: '--font-golos', display: 'swap' });
const serif = Playfair_Display({ subsets: ['latin', 'cyrillic'], variable: '--font-playfair', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], variable: '--font-jetbrains', display: 'swap' });

/**
 * Ставит data-theme до первой отрисовки, иначе при тёмной теме успевает мигнуть светлая.
 *
 * Именно сырой <script> в <head>: браузер исполняет его синхронно при разборе разметки.
 * `next/script` со стратегией beforeInteractive здесь не годится — он кладёт код в очередь
 * `self.__next_s`, а её разбирает рантайм Next уже после загрузки бандла, то есть после
 * первой отрисовки. React в dev ругается на script внутри компонента: предупреждение
 * безобидное, скрипт своё дело делает из серверной разметки.
 */
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('theme');var d=s==='dark'||(s!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}})();`;

export const metadata = {
  title: 'Wellness-агент',
  description: 'Коуч по питанию, тренировкам и восстановлению с обязательной проверкой безопасности.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
