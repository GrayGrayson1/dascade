/** Shared (non-React) controllers for the battlefield UI. */
import { createContext, useContext } from 'react';
import type { BattlePresenter } from './model/presenter.ts';
import type { AimController } from './model/aim.ts';

export interface TanksControllers {
  presenter: BattlePresenter;
  aim: AimController;
  /** Toggle the whole-field camera on small screens. */
  overview: boolean;
  setOverview: (on: boolean) => void;
}

export const TanksContext = createContext<TanksControllers | null>(null);

export function useTanks(): TanksControllers {
  const ctx = useContext(TanksContext);
  if (!ctx) throw new Error('TanksContext missing');
  return ctx;
}
