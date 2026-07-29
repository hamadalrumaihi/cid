/** MSW project setup, file 1 of 2 — environment. MUST run before setup.ts:
 *  src/lib/supabase.ts and src/lib/fivemanage.ts read NEXT_PUBLIC_* at module
 *  load, so the mock endpoints have to be in place before any import pulls
 *  them in. Points supabase-js at a .test host that can never resolve — even
 *  a hypothetical unmocked request could not reach a real project, let alone
 *  production. */
import {
  MOCK_FIVEMANAGE_API_KEY, MOCK_FIVEMANAGE_URL, MOCK_SUPABASE_ANON_KEY, MOCK_SUPABASE_URL,
} from '@/mocks/env'

process.env.NEXT_PUBLIC_SUPABASE_URL = MOCK_SUPABASE_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = MOCK_SUPABASE_ANON_KEY
process.env.NEXT_PUBLIC_FIVEMANAGE_BASE_URL = MOCK_FIVEMANAGE_URL
process.env.NEXT_PUBLIC_FIVEMANAGE_API_KEY = MOCK_FIVEMANAGE_API_KEY

// React act() support for the component smoke tests (no RTL in this repo —
// components render via react-dom/client + act, see render helper).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
