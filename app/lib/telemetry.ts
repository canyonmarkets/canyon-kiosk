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
  try {
    void supabase.from('kiosk_events').insert({
      machine_code: machineCode,
      kind,
      message: message?.slice(0, 500) ?? null,
      stack: stack?.slice(0, 2000) ?? null,
      meta: { ...meta, ...memorySnapshot(), uptime_min: uptimeMinutes() },
    }).then(() => { /* fire-and-forget */ })
  } catch { /* telemetry must never break the kiosk */ }
}

// Install global error hooks + a boot marker. Call once on mount.
// Returns a cleanup fn for React strict-mode/unmount hygiene.
export function initTelemetry(machineCode: string): () => void {
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
