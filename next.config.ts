import type { NextConfig } from "next";

// Security headers ported from main's vercel.json (vanilla app) so the rebase
// does not lose security posture. CSP adjusted for Next.js:
// - no cdn.jsdelivr.net / cdn.sheetjs.com (export libs come from npm, not CDNs)
// - no Google Fonts origins (next/font self-hosts)
// - 'unsafe-eval' only in dev (Next.js HMR needs it)
const isDev = process.env.NODE_ENV === "development";

const csp = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets the PDF export (@react-pdf/renderer → yoga-layout)
  // compile its WebAssembly layout module. It permits WASM only — NOT general
  // eval() — so the script-injection posture is unchanged.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://discord.com https://*.discord.com https://api.fivemanage.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // No Cache-Control override: Next.js manages caching per-asset
          // (immutable /_next/static, revalidated HTML) — unlike the static vanilla host.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
