"use client";

import { useSyncExternalStore } from "react";
import type { PrototypeState } from "@/prototype/contracts";
import {
  createDefaultPrototypeState,
  parsePrototypeState,
  prototypeReducer,
  PROTOTYPE_STORAGE_KEY,
  type PrototypeAction,
} from "@/prototype/store-core";

let state = createDefaultPrototypeState();
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  state = parsePrototypeState(window.localStorage.getItem(PROTOTYPE_STORAGE_KEY));
  hydrated = true;
}

function getSnapshot(): PrototypeState {
  hydrate();
  return state;
}

const serverSnapshot = createDefaultPrototypeState();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dispatchPrototype(action: PrototypeAction): void {
  hydrate();
  const next = prototypeReducer(state, action);
  if (next === state) return;
  state = next;
  window.localStorage.setItem(PROTOTYPE_STORAGE_KEY, JSON.stringify(state));
  listeners.forEach((listener) => listener());
}

export function usePrototypeState(): PrototypeState {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
}
