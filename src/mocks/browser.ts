/** MSW browser worker — reserved for the Storybook / dev-preview phase.
 *
 *  NOT ACTIVE YET: the service-worker script (public/mockServiceWorker.js)
 *  is deliberately not generated in Phase 1, because anything in public/
 *  ships to production verbatim and the program's rule is that MSW must be
 *  impossible to ship. When the Storybook phase lands, generate the worker
 *  into Storybook's own staticDirs (NOT public/) via
 *  `npx msw init <staticDir>` and call worker.start() from dev-only tooling.
 *
 *  Nothing under src/app or src/components may import this module — the
 *  production-exclusion proof test (tests/msw/production-exclusion.test.ts)
 *  enforces that statically and scans the build output for the sentinel. */
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)
