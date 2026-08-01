// Sends a remote-reload broadcast on the catalog-sync channel (test harness).
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(
  'https://zgmxmficzvlpzkosdcnx.supabase.co',
  'sb_publishable_MUAaPltQkyDFsR0NvLTikQ_gY_pfJFy',
)
const machine = process.argv[2] || 'TESTDIAG'
const channel = supabase.channel('catalog-sync')
channel.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    channel.send({ type: 'broadcast', event: 'reload', payload: { machine } })
      .then(() => { console.log('reload broadcast sent to', machine); setTimeout(() => process.exit(0), 500) })
  }
})
setTimeout(() => { console.error('timeout'); process.exit(1) }, 10000)
