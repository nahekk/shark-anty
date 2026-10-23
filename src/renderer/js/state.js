import { api } from './ui.js';

// Single source of truth for the UI, refreshed from the main process.
export const state = {
  info: {},
  profiles: [],
  proxies: [],
  extensions: [],
  settings: {},
  running: [],
  engine: {},
  rpc: {},
  engineProgress: null,
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(reason) {
  for (const fn of listeners) fn(reason);
}

export async function refresh(reason = 'refresh') {
  Object.assign(state, await api('state:get'));
  emit(reason);
}

export function runningMap() {
  return new Map(state.running.map((r) => [r.id, r]));
}

export function proxyById(id) {
  return state.proxies.find((p) => p.id === id) || null;
}

export function groups() {
  return [...new Set(state.profiles.map((p) => p.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
