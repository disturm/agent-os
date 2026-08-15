/**
 * Итог прогона по истории раундов: какой раунд считать результатом и что о нём сказать.
 *
 * Score отдельного раунда сам по себе мало что значит: важно, чем прогон кончился
 * и двигался ли план в нужную сторону. Всё считается из готовой истории —
 * модуль чистый, к модели и файлам не ходит.
 */

import type { RoundState } from './rounds';

/**
 * Раунд, который считается результатом прогона.
 *
 * Правило одно на всех, чтобы план, вердикт и score не разъезжались:
 * 1. Последний раунд остановил прогон как `needs_human_professional` — он и есть итог.
 *    Предохранитель перекрывает любое прежнее одобрение: план, одобренный до того,
 *    как ревьюер увидел медицинский запрос, отдавать нельзя.
 * 2. Иначе берём последний одобренный раунд. Так `minRounds` не может испортить
 *    готовый результат: доработка после `approve` либо улучшит план, либо будет отброшена.
 * 3. Одобрения не было вовсе — последний раунд как есть.
 */
export function finalRound(rounds: RoundState[]): RoundState | undefined {
  const last = rounds.at(-1);
  if (!last) return undefined;
  if (last.review.verdict === 'needs_human_professional') return last;
  return rounds.filter((state) => state.review.verdict === 'approve').at(-1) ?? last;
}

/** Score итогового раунда. История пуста — прогона не было, отдаём 0. */
export function finalScore(rounds: RoundState[]): number {
  return finalRound(rounds)?.review.score ?? 0;
}

/**
 * Выросла ли оценка между первым и последним раундом. Ответ на вопрос «замечания
 * ревьюера вообще что-то дали?» — при одном раунде сравнивать нечего, значит `false`.
 */
export function improved(rounds: RoundState[]): boolean {
  const first = rounds.at(0);
  const last = rounds.at(-1);
  if (!first || !last || first === last) return false;
  return last.review.score > first.review.score;
}
