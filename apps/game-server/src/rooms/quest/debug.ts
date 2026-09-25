/**
 * DASQuest scene-jump debug hook (`quest:debug`), used by tests and visual QA scripts.
 *
 * It is only reachable when the *server process* opts in on both counts:
 *   - NODE_ENV is exactly 'development' or 'test' (an unset NODE_ENV counts as production), and
 *   - DASCADE_QUEST_DEBUG=1.
 * Nothing a client sends can turn it on. Read on every call so tests can switch environments.
 */
export function questDebugEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const devBuild = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  return devBuild && env.DASCADE_QUEST_DEBUG === '1';
}
