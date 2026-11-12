"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, decodeState, type DemoState } from "@/lib/state";
import { loadRoundEvidence, loadTidepoolDemo, runTidepoolFreshCheck } from "@/lib/record/loader";
import type { TestnetRound } from "@/lib/record/model.mjs";
import type { FreshCheck, TidepoolDemo } from "@/lib/tidepool/model.mjs";

/** Polls the local simulation's /api/state. A failed poll keeps the last snapshot and reports the connection problem. */
export function useLocalState(pollMs = 1500) {
  const [data, setData] = useState<DemoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const serial = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const id = ++serial.current;
    try {
      const response = await fetch(apiUrl("/api/state"), { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "The local contracts are not ready yet.");
      const next = decodeState(body);
      if (mounted.current && id === serial.current) { setData(next); setError(null); setUpdatedAt(Date.now()); }
    } catch (failure) {
      if (mounted.current && id === serial.current) setError(failure instanceof Error && failure.name !== "TimeoutError" && failure.name !== "AbortError" ? failure.message : "The local API did not respond.");
    } finally {
      if (mounted.current && id === serial.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined; let disposed = false;
    async function poll() { await refresh(); if (!disposed) timer = setTimeout(poll, pollMs); }
    void poll();
    return () => { disposed = true; mounted.current = false; clearTimeout(timer); };
  }, [refresh, pollMs]);

  /** Starts the local rehearsal through the existing endpoint. It accepts no parameters and signs nothing public. */
  const start = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch(apiUrl("/api/demo/start"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "omit", signal: AbortSignal.timeout(10_000) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return typeof body?.error === "string" ? body.error : "The local round could not be started.";
      return null;
    } catch { return "The local API did not respond. Start the demo with bash scripts/docker-demo/up.sh."; }
    finally { await refresh(); }
  }, [refresh]);

  return { data, error, loading, updatedAt, refresh, start, connected: data !== null && error === null };
}

/** The published Aurora testnet rounds, validated. */
export function useSavedRounds() {
  const [rounds, setRounds] = useState<TestnetRound[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    loadRoundEvidence().then((next) => { if (active) setRounds(next); }, (failure) => { if (active) setError(failure instanceof Error ? failure.message : "Saved rounds are unavailable."); });
    return () => { active = false; };
  }, []);
  return { rounds, error };
}

/** The completed Tidepool community-testnet demonstration, from saved evidence. */
export function useTidepoolDemo(enabled = true) {
  const [demo, setDemo] = useState<TidepoolDemo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    loadTidepoolDemo().then((next) => { if (active) setDemo(next); }, (failure) => { if (active) setError(failure instanceof Error ? failure.message : "Tidepool evidence is unavailable."); });
    return () => { active = false; };
  }, [enabled]);
  return { demo, error };
}

/** The on-demand read-only receipt check. */
export function useFreshCheck() {
  const [fresh, setFresh] = useState<FreshCheck | null>(null);
  const [freshing, setFreshing] = useState(false);
  const run = useCallback(async () => { setFreshing(true); try { setFresh(await runTidepoolFreshCheck()); } finally { setFreshing(false); } }, []);
  return { fresh, freshing, run };
}
