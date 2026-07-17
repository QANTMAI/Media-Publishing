/** @type {import('next').NextConfig} */

/* Security headers (Build Plan §06). CSP notes:
 * - style-src 'unsafe-inline': the design system uses inline style attributes.
 * - script-src 'unsafe-inline'/'unsafe-eval': required by Next's runtime
 *   bootstrap and dev tooling; tighten to nonces if a nonce pipeline is added.
 * - No external origins: fonts are self-hosted via next/font, media is served
 *   from our own signed-URL routes. Anything remote must be added explicitly. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Effective only over HTTPS (production); harmless locally.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig = {
  // Packages that resolve bundled binaries via __dirname must stay in
  // node_modules — bundling them breaks their binary paths.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static", "sharp"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
