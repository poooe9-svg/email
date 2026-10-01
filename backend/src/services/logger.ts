import { insertLogEntry, trimDispatchLog } from "../db/db";
import type { DispatchLogEntry } from "../types";

type Listener = (entry: DispatchLogEntry) => void;

const listeners = new Set<Listener>();
let logCount = 0;

export function onLogEntry(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function log(
  worker: string,
  message: string,
  level: DispatchLogEntry["level"] = "info"
): DispatchLogEntry {
  // Playwright errors carry terminal color codes, which render as junk in the dashboard.
  const clean = message.replace(/\x1b\[[0-9;]*m/g, "").trim();
  const entry = insertLogEntry({ level, worker, message: clean });
  for (const listener of listeners) listener(entry);

  logCount++;
  if (logCount % 500 === 0) trimDispatchLog();

  return entry;
}

export const logger = {
  info: (worker: string, message: string) => log(worker, message, "info"),
  success: (worker: string, message: string) => log(worker, message, "success"),
  warn: (worker: string, message: string) => log(worker, message, "warn"),
  error: (worker: string, message: string) => log(worker, message, "error"),
};
