import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// PRD §7 security. Next.js needs inline scripts for page bootstrapping, and
// 'unsafe-eval' only in development for fast refresh.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Location only for this site, and only when a student taps a punch button.
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Lets a phone on the same Wi-Fi load the dev server (hydration/HMR are blocked otherwise).
  // The four-label wildcard matches any IPv4 address, so a changing Wi-Fi IP keeps working.
  allowedDevOrigins: ["*.*.*.*", "*.trycloudflare.com"],
  experimental: {
    serverActions: {
      // Notes are capped at 10 MB in code; imports, leave documents and notice attachments at 5 MB.
      bodySizeLimit: "12mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
