/** Facts about this server process (uptime, the running build) for health checks and crew tools. */
export const processStartedAt = Date.now();

/** The commit this process runs (Render sets RENDER_GIT_COMMIT at runtime), '' when unknown. */
export function runningCommit(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const sha = env.RENDER_GIT_COMMIT ?? env.GIT_COMMIT ?? '';
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 12) : '';
}
