// Keeps the per-function copies of the shared Edge Function helpers identical to supabase/functions/_shared.
// create-report-payment and payfast-report-itn carry local copies so they can be deployed as self-contained bundles
// without the Supabase CLI resolving ../_shared. _shared is the single source of truth: edit it, then run
//   node scripts/sync-edge-helpers.mjs
// `--check` exits non-zero if any copy is stale (used by the test suite and CI).
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'functions')
const read = (p) => readFileSync(join(root, p), 'utf8')

/** Every generated file and the exact content it must have. */
export function expectedCopies() {
  const out = {}
  for (const fn of ['create-report-payment', 'payfast-report-itn']) {
    for (const f of ['edge.ts', 'payfast.ts']) out[`${fn}/${f}`] = read(`_shared/${f}`)
  }
  // payfast-report-itn is the same receiver as payfast-itn with local imports.
  out['payfast-report-itn/index.ts'] = read('payfast-itn/index.ts').replaceAll("'../_shared/", "'./")
  return out
}

export function staleCopies() {
  return Object.entries(expectedCopies())
    .filter(([p, content]) => !existsSync(join(root, p)) || read(p) !== content)
    .map(([p]) => p)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const stale = staleCopies()
    if (stale.length) { console.error('Stale edge function copies:\n  ' + stale.join('\n  ') + '\nRun: node scripts/sync-edge-helpers.mjs'); process.exit(1) }
    console.log('Edge function copies are in sync.')
  } else {
    for (const [p, content] of Object.entries(expectedCopies())) writeFileSync(join(root, p), content)
    console.log('Synced edge function copies.')
  }
}
