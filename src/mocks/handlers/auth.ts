/** GoTrue auth handlers — enough surface for supabase-js password-grant
 *  sessions (the same flow tests/support/signin.ts uses against the real test
 *  project): token (password + refresh), user, logout. Credentials come from
 *  the store session registered by roleSession(); anything else fails with
 *  GoTrue's invalid-credentials shape. */
import { http, HttpResponse } from 'msw'
import { supabaseBaseUrl } from '../env'
import { getSession, type MockAuthSession } from '../store'
import { shapeNetwork } from './postgrest'

function gotrueUser(session: MockAuthSession) {
  const now = new Date().toISOString()
  return {
    id: session.userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: session.email,
    email_confirmed_at: now,
    phone: '',
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: now,
    updated_at: now,
  }
}

function tokenResponse(session: MockAuthSession) {
  return HttpResponse.json({
    access_token: `mock-access-token-${session.userId}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `mock-refresh-token-${session.userId}`,
    user: gotrueUser(session),
  })
}

const invalidCredentials = () =>
  HttpResponse.json(
    { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' },
    { status: 400 },
  )

export const authHandlers = [
  http.post(`${supabaseBaseUrl()}/auth/v1/token`, async ({ request }) => {
    const shaped = await shapeNetwork()
    if (shaped) return shaped
    const session = getSession()
    if (!session) return invalidCredentials()
    const grant = new URL(request.url).searchParams.get('grant_type')
    if (grant === 'refresh_token') return tokenResponse(session)
    if (grant !== 'password') return invalidCredentials()
    const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string }
    if (body.email !== session.email || body.password !== session.password) return invalidCredentials()
    return tokenResponse(session)
  }),

  http.get(`${supabaseBaseUrl()}/auth/v1/user`, async () => {
    const shaped = await shapeNetwork()
    if (shaped) return shaped
    const session = getSession()
    if (!session) {
      return HttpResponse.json(
        { code: 401, error_code: 'no_authorization', msg: 'Missing authorization header' },
        { status: 401 },
      )
    }
    return HttpResponse.json(gotrueUser(session))
  }),

  http.post(`${supabaseBaseUrl()}/auth/v1/logout`, async () => {
    const shaped = await shapeNetwork()
    if (shaped) return shaped
    return new HttpResponse(null, { status: 204 })
  }),
]
