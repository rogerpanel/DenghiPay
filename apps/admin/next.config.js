/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The design system and contracts ship as TypeScript source; Next compiles
  // them with the app so there is no separate build step in development.
  transpilePackages: ['@morapay/ui'],
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  // Same-origin API proxy — see the note in apps/web/next.config.js. The back
  // office needs it for the same reason: a build with an absolute API host in
  // the bundle can only be opened from that host.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000'}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=()' },
        ],
      },
      {
        // The service worker must not be cached, or an update never lands.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },
};

module.exports = nextConfig;
