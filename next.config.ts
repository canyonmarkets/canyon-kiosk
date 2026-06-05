import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Static export — kiosk is pure client-side React.
  // API routes (heartbeat, future charge) will be handled separately
  // (heartbeat fails silently; charge will move to Supabase Edge Function).
  output: 'export',
  images: { unoptimized: true },
}

export default nextConfig
