import type { TriviaCategoryId, TriviaQuestion } from '@dascade/shared/games/trivia';

/** A starter-pack question: a TriviaQuestion with a required, stable id and a built-in category. */
export type StarterQuestion = TriviaQuestion & { id: string; category: TriviaCategoryId };
