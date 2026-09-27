/* eslint-disable no-console */
const ts = () => new Date().toISOString();

export const logger = {
  info: (msg: string, ...rest: unknown[]) => console.log(`[${ts()}] INFO  ${msg}`, ...rest),
  warn: (msg: string, ...rest: unknown[]) => console.warn(`[${ts()}] WARN  ${msg}`, ...rest),
  error: (msg: string, ...rest: unknown[]) => console.error(`[${ts()}] ERROR ${msg}`, ...rest),
};

/** In dev mode, the stack of an error that was caught and reported by message only. */
export function logStackInDev(devMode: boolean, where: string, err: unknown): void {
  if (!devMode) return;
  const stack = err instanceof Error ? err.stack : undefined;
  if (stack) console.error(`[${ts()}] DEV   ${where}
${stack}`);
}
