import type { MachineConfig } from '../types'

// ─── Default machine config ────────────────────────────────────────────────
// This is overridden by whatever is saved in localStorage via the Admin Panel.
// On first boot, the admin should set the Machine ID for this specific kiosk.

export const DEFAULT_CONFIG: MachineConfig = {
  machineId:    'SF1',
  locationName: 'Steel Fab',
  partnerName:  undefined,    // set for data center sites (e.g. 'Clayco Compute')
  taxRate:      0.091,        // 9.1% — Maricopa County, AZ
  adminPin:     '0609',       // Canyon admin PIN (kiosk-side gate; see note below)
}

export const CONFIG_STORAGE_KEY = 'canyon-kiosk-config'

// Location display name by machine-code prefix. The ?machine= URL param is the
// authoritative identity, so the location label must follow it too — otherwise
// a CC kiosk shows the SF1 default "Steel Fab" (there is no on-device settings
// editor anymore). Add a prefix here when a new site gets kiosks.
const LOCATION_BY_PREFIX: Array<[prefix: string, location: string]> = [
  ['SF', 'Steel Fab'],
  ['CC', 'Call Center'],
  ['MB', 'Mirabella at ASU'],
]

function locationForMachine(machineId: string, fallback: string): string {
  const hit = LOCATION_BY_PREFIX.find(([p]) => machineId.startsWith(p))
  return hit ? hit[1] : fallback
}

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
        ...(machineFromUrl ? {
          machineId: machineFromUrl,
          locationName: locationForMachine(machineFromUrl, base.locationName),
        } : {}),
        ...(themeFromUrl   ? { theme: themeFromUrl }       : {}),
      }
    }
    return { ...base, locationName: locationForMachine(base.machineId, base.locationName) }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: MachineConfig): void {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config))
}
