/**
 * Форма ответа `POST /api/agent/run` и оформление вердиктов.
 * Живёт отдельно от компонентов: и левая колонка (ReviewPanel), и правая (PlanView)
 * читают один и тот же вердикт, дублировать его описание в двух местах нельзя.
 */

export type Verdict = 'approve' | 'revise' | 'needs_human_professional';

export type Review = {
  verdict: Verdict;
  score: number;
  issues: string[];
};

export type AgentResult = {
  plan: string;
  review: Review;
  rounds: number;
};

type VerdictMeta = {
  /** Русская расшифровка: сырой токен вердикта сам по себе ничего не объясняет. */
  gloss: string;
  /** Классы бейджа — пастельная пара фон/текст из палитры. */
  badge: string;
};

export const VERDICT_META: Record<Verdict, VerdictMeta> = {
  approve: {
    gloss: 'План одобрен ревьюером',
    badge: 'bg-approve text-approve-foreground',
  },
  revise: {
    gloss: 'Замечания не сняты за три раунда',
    badge: 'bg-revise text-revise-foreground',
  },
  needs_human_professional: {
    gloss: 'Запрос выходит за границы wellness',
    badge: 'bg-stop text-stop-foreground',
  },
};
