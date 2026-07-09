'use client'

/** Last-resort boundary — catches a crash in the root layout itself, where
 *  no app CSS is guaranteed, so styles are inline. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#070b14', color: '#e2e8f0', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <div style={{ maxWidth: 420, padding: 32, textAlign: 'center', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 16, background: 'rgba(11,17,32,0.9)' }}>
          <p style={{ fontSize: 36, margin: 0 }} aria-hidden>⚠️</p>
          <h1 style={{ fontSize: 18, margin: '8px 0 4px' }}>The portal hit an unexpected error</h1>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
            Your data is safe on the server.
            {error.digest ? ` (ref ${error.digest})` : ''}
          </p>
          <button
            onClick={reset}
            style={{ marginTop: 20, padding: '10px 18px', borderRadius: 10, border: 0, background: '#3b82f6', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
