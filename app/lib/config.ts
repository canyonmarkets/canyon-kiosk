import type { MachineConfig } from '../types'

// ─── Default machine config ────────────────────────────────────────────────
// This is overridden by whatever is saved in localStorage via the Admin Panel.
// On first boot, the admin should set the Machine ID for this specific kiosk.

export const DEFAULT_CONFIG: MachineConfig = {
  machineId:    'SF1',
  locationName: 'Steel Fab',
  partnerName:  undefined,    // set for data center sites (e.g. 'Clayco Compute')
  taxRate:      0.091,        // 9.1% — Maricopa County, AZ
  adminPin:     '1234',       // CHANGE THIS on first boot via Admin Panel
}

export const CONFIG_STORAGE_KEY = 'canyon-kiosk-config'

export function loadConfig(): MachineConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG
  try {
    const saved = localStorage.getItem(CONFIG_STORAGE_KEY)
    const base: MachineConfig = saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG

    // URL params are the authoritative source of machine identity.
    // ?machine=SF2 overrides whatever is in localStorage — even after a browser reset.
    // ?theme=steelfab wires up future theming (no effect until themes are built).
    const params = new URLSearchParams(window.location.search)
    const machineFromUrl = params.get('machine')?.toUpperCase().trim()
    const themeFromUrl   = params.get('theme')?.toLowerCase().trim()

    if (machineFromUrl || themeFromUrl) {
      return {
        ...base,
        ...(machineFromUrl ? { machineId: machineFromUrl } : {}),
        ...(themeFromUrl   ? { theme: themeFromUrl }       : {}),
      }
    }
    return base
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: MachineConfig): void {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config))
}
