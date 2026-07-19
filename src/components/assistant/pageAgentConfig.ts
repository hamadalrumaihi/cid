/** Owner-only Portal Assistant (page-agent) — configuration gate.
 *
 *  The assistant is INERT unless all three vars are set: no page-agent import,
 *  no network, nothing beyond a "not configured" note. The key is read on the
 *  CLIENT (NEXT_PUBLIC_*) because page-agent calls the LLM from the browser —
 *  use a restricted / proxy key, never a privileged one. See docs/DEV-TOOLING.md. */
export interface PageAgentConfig {
  model: string
  baseURL: string
  apiKey: string
}

export const pageAgentConfig = (): PageAgentConfig => ({
  model: process.env.NEXT_PUBLIC_PAGE_AGENT_MODEL || '',
  baseURL: process.env.NEXT_PUBLIC_PAGE_AGENT_BASE_URL || '',
  apiKey: process.env.NEXT_PUBLIC_PAGE_AGENT_API_KEY || '',
})

export const isPageAgentConfigured = (): boolean => {
  const c = pageAgentConfig()
  return !!(c.model && c.baseURL && c.apiKey)
}
