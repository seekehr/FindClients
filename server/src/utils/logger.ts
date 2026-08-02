/* eslint-disable no-console */
const ts = () => new Date().toISOString();

export const logger = {
  info: (msg: string, ...rest: unknown[]) => console.log(`[${ts()}] INFO  ${msg}`, ...rest),
  warn: (msg: string, ...rest: unknown[]) => console.warn(`[${ts()}] WARN  ${msg}`, ...rest),
  error: (msg: string, ...rest: unknown[]) => console.error(`[${ts()}] ERROR ${msg}`, ...rest),
  debug: (msg: string, ...rest: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') console.log(`[${ts()}] DEBUG ${msg}`, ...rest);
  },
};
