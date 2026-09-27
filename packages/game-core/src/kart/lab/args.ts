/** Command-line arguments for the lab scripts (run with tsx; game-core has no Node types). */
export const argv: string[] = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2);
