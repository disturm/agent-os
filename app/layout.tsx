import type { ReactNode } from 'react';

export const metadata = { title: 'Wellness-агент' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>{children}</body>
    </html>
  );
}
