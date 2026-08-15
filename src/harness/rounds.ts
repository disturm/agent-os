/**
 * Состояние раундов ревизии: что коуч предложил и что ревьюер на это ответил.
 *
 * Loop-у достаточно последнего плана, но harness обязан помнить всю историю —
 * по ней видно, как менялся вердикт, и на ней считается score (см. `score.ts`).
 * Модуль только накапливает факты, никаких решений о продолжении цикла не принимает.
 */

import type { Review } from './validateReview';

/** Один проход коуч → ревьюер. `round` нумеруется с единицы, как в логах. */
export type RoundState = {
  round: number;
  plan: string;
  review: Review;
};

export type RoundHistory = {
  /** Записывает завершившийся раунд и возвращает его состояние. */
  record(plan: string, review: Review): RoundState;
  /** Копия истории: наружу отдаём снимок, чтобы её нельзя было дописать мимо `record`. */
  all(): RoundState[];
  /** Сколько раундов уже прошло. */
  count(): number;
};

export function createRoundHistory(): RoundHistory {
  const rounds: RoundState[] = [];

  return {
    record(plan, review) {
      const state: RoundState = { round: rounds.length + 1, plan, review };
      rounds.push(state);
      return state;
    },
    all: () => [...rounds],
    count: () => rounds.length,
  };
}
