// Breadcrumb telemetry for kiosk freeze/crash forensics.
//
// Born from the Aug 1 2026 SF2 incident: the WebView froze at 10:11 PM with the
// screen on — scanner beeped but JS never processed the read — and after the
// on-site reboot there was zero evidence of why. This module leaves a trail in
// `kiosk_events` (boot markers, JS errors, promise rejections) and rides memory
// stats along on the heartbeat so a leak can be watched climbing toward the
// freeze point instead of guessed at afterward.
//
// Design constraints:
// - Must NEVER interfere with selling. Every write is fire-and-forget and
//   wrapped so a telemetry failure can't surface to the shopper.
// - Must not spam the table when something errors in a loop: per-session cap
//   plus consecutive-duplicate suppression.
import { supabase } from './supabase'

const MAX_EVENTS_PER_SESSION = 40
const bootTime = Date.now()
let eventCount = 0
let lastKey = ''

// ── Offline event queue ───────────────────────────────────────────────────────
// The whole point of breadcrumbs is to survive the outage that produced them,
// and a fire-and-forget insert during a network outage is a breadcrumb thrown
// in the bin. MB1 (2026-09-07) went silent for 6h18m and left NOTHING behind,
// so afterwards there was no way to tell a frozen WebView (JS dead at 10:38)
// from a dead uplink (app alive and retrying until 5pm) — both look identical
// from the server: zero packets.
//
// So: park failed events in localStorage and flush them on the next boot. The
// TIMESTAMP OF THE LAST QUEUED TICK is the discriminator. If the app stayed
// alive through the outage, ticks run right up to the moment power was cut.
// If it froze, the ticks stop dead at the freeze and the gap speaks for itself.
const QUEUE_KEY = 'kiosk_event_queue_v1'
const MAX_QUEUED = 100

type QueuedRow = {
  machine_code: string
  kind: string
  message: string | null
  stack: string | null
  meta: Record<string, unknown>
  created_at: string
}

function readQueue(): QueuedRow[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function writeQueue(rows: QueuedRow[]) {
  // Keep the NEWEST rows: during a long outage the tail is what says when the
  // app actually stopped, which is the question we're trying to answer.
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(rows.slice(-MAX_QUEUED))) } catch { /* quota / private mode */ }
}

function queueRow(row: QueuedRow) {
  writeQueue([...readQueue(), row])
}

// Push everything stranded by the last outage. Called once on boot.
export function flushEventQueue() {
  const rows = readQueue()
  if (rows.length === 0) return
  // Clear first so a slow flush can't be double-sent by a second call; put the
  // rows back if the insert fails (still offline at boot — Wi-Fi not up yet).
  writeQueue([])
  try {
    void supabase.from('kiosk_events').insert(rows)
      .then(({ error }) => { if (error) writeQueue([...rows, ...readQueue()]) })
  } catch { writeQueue([...rows, ...readQueue()]) }
}

// performance.memory is Chrome/WebView-only and non-standard — exactly the
// runtime the kiosks use. Absent elsewhere; callers handle null.
type ChromeMemory = { usedJSHeapSize: number; jsHeapSizeLimit: number }
export function memorySnapshot(): { mem_used_mb: number; mem_limit_mb: number } | null {
  const mem = (performance as unknown as { memory?: ChromeMemory }).memory
  if (!mem) return null
  return {
    mem_used_mb: Math.round(mem.usedJSHeapSize / 1048576),
    mem_limit_mb: Math.round(mem.jsHeapSizeLimit / 1048576),
  }
}

export function uptimeMinutes(): number {
  return Math.round((Date.now() - bootTime) / 60000)
}

export function logEvent(
  machineCode: string,
  kind: string,
  message?: string,
  stack?: string,
  meta?: Record<string, unknown>,
) {
  if (eventCount >= MAX_EVENTS_PER_SESSION) return
  // Suppress immediate repeats (an error firing every frame would flood the cap
  // in one second and drown the interesting events).
  const key = `${kind}|${message}`
  if (key === lastKey) return
  lastKey = key
  eventCount++
  const row: QueuedRow = {
    machine_code: machineCode,
    kind,
    message: message?.slice(0, 500) ?? null,
    stack: stack?.slice(0, 2000) ?? null,
    meta: { ...meta, ...memorySnapshot(), uptime_min: uptimeMinutes() },
    created_at: new Date().toISOString(),
  }
  try {
    // Supabase resolves with { error } rather than rejecting, so a dropped
    // insert has to be caught BOTH ways or the breadcrumb is silently lost.
    void supabase.from('kiosk_events').insert(row)
      .then(({ error }) => { if (error) queueRow(row) })
  } catch { queueRow(row) }
}

// Breadcrumb written while the backend is known-unreachable. Goes STRAIGHT to
// the queue — there is no point attempting a network call we know will fail —
// and deliberately bypasses the per-session cap and duplicate suppression,
// because here the repetition IS the signal: each tick proves the JS was still
// running at that moment. Bounded by MAX_QUEUED instead.
export function logOfflineTick(machineCode: string, meta?: Record<string, unknown>) {
  queueRow({
    machine_code: machineCode,
    kind: 'offline_tick',
    message: 'backend unreachable — app still running',
    stack: null,
    meta: { ...meta, ...memorySnapshot(), uptime_min: uptimeMinutes() },
    created_at: new Date().toISOString(),
  })
}

// Install global error hooks + a boot marker. Call once on mount.
// Returns a cleanup fn for React strict-mode/unmount hygiene.
export function initTelemetry(machineCode: string): () => void {
  // Drain anything the last outage stranded before adding this boot's marker,
  // so the trail reads in order: ...offline_ticks -> boot.
  flushEventQueue()

  logEvent(machineCode, 'boot', 'kiosk page loaded', undefined, {
    userAgent: navigator.userAgent,
    // 'navigate' = fresh launch (tablet reboot / Fully relaunch); 'reload' = page
    // refresh — distinguishes "device rebooted" from "app reloaded" in the trail.
    navigationType: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type,
  })

  const onError = (e: ErrorEvent) =>
    logEvent(machineCode, 'error', e.message, e.error?.stack, { source: `${e.filename}:${e.lineno}` })
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason
    logEvent(machineCode, 'promise_rejection',
      r instanceof Error ? r.message : String(r),
      r instanceof Error ? r.stack : undefined)
  }
  // Visibility flips are breadcrumbs too — the SF2 freeze theory hinges on what
  // the WebView was doing right before heartbeats stopped.
  const onVisibility = () =>
    logEvent(machineCode, 'visibility', document.visibilityState)

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
