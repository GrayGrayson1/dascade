/**
 * The original DAStravaganza starter pack. Server-only: the client never imports this module
 * (answer keys stay on the server; clients get counts via packInfoJson).
 */
import type { StarterQuestion } from './types.ts';
import { GENERAL } from './general.ts';
import { SCIENCE } from './science.ts';
import { SCREEN } from './screen.ts';
import { TECH } from './tech.ts';
import { GEOGRAPHY } from './geography.ts';
import { HISTORY } from './history.ts';
import { FOOD } from './food.ts';
import { WEIRD } from './weird.ts';
import { NONSENSE } from './nonsense.ts';

export type { StarterQuestion } from './types.ts';

export const STARTER_QUESTIONS: readonly StarterQuestion[] = [
  ...GENERAL,
  ...SCIENCE,
  ...SCREEN,
  ...TECH,
  ...GEOGRAPHY,
  ...HISTORY,
  ...FOOD,
  ...WEIRD,
  ...NONSENSE,
];
