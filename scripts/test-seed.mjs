#!/usr/bin/env node
/** Reset + seed the DEDICATED test Supabase project by running
 *  scripts/test-seed.sql through psql. Passwords are passed as psql variables
 *  from env (never committed). Refuses to run against production.
 *
 *  Env required:
 *    TEST_DATABASE_URL   direct Postgres connection string for the TEST project
 *    TEST_PW_DETECTIVE / _SENIOR / _LEAD / _DEPUTY / _DIRECTOR / _OWNER
 *
 *  Usage: node scripts/test-seed.mjs   (or `npm run test:seed`)
 *  Needs the `psql` client on PATH (present on CI runners; `brew install
 *  libpq` / `apt-get install postgresql-client` locally). */
import { execFileSync } from 'node:child_process'

const PROD_REF = 'jhxuflzmqspidkvjckox' // production project ref — hard block.

const dbUrl = process.env.TEST_DATABASE_URL || ''
if (!dbUrl) {
  console.error('TEST_DATABASE_URL is not set — see docs/TEST-ENVIRONMENT.md.')
  process.exit(1)
}
if (dbUrl.includes(PROD_REF)) {
  console.error('REFUSING TO RUN: TEST_DATABASE_URL references the PRODUCTION project.')
  process.exit(2)
}

const pwEnvs = {
  pw_detective: 'TEST_PW_DETECTIVE',
  pw_senior: 'TEST_PW_SENIOR',
  pw_lead: 'TEST_PW_LEAD',
  pw_deputy: 'TEST_PW_DEPUTY',
  pw_director: 'TEST_PW_DIRECTOR',
  pw_owner: 'TEST_PW_OWNER',
}

const args = [dbUrl, '--set', 'ON_ERROR_STOP=on']
for (const [pgVar, envName] of Object.entries(pwEnvs)) {
  const val = process.env[envName]
  if (!val) {
    console.error(`Missing password env ${envName} — all six TEST_PW_* must be set.`)
    process.exit(1)
  }
  args.push('-v', `${pgVar}=${val}`)
}
args.push('-f', 'scripts/test-seed.sql')

console.log('Seeding TEST project (production is hard-blocked)…')
try {
  execFileSync('psql', args, { stdio: ['ignore', 'inherit', 'inherit'] })
  console.log('Test project reset + seeded.')
} catch (err) {
  console.error('Seed failed:', err.message)
  process.exit(1)
}
