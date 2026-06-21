import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://zgmxmficzvlpzkosdcnx.supabase.co'
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_MUAaPltQkyDFsR0NvLTikQ_gY_pfJFy'

export const supabase = createClient(url, key)
