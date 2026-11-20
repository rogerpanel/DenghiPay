/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The design system and contracts ship as TypeScript source; Next compiles
  // them with the app so there is no separate build step in development.
  transpilePackages: ['@morapay/ui'],
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  // Same-origin API proxy.
  //
  // NEXT_PUBLIC_API_URL is inlined into the client bundle at build time, so a
  // build that names an absolute host can only be opened from that host — open
  // it on a phone and the phone calls itself. Set it to `/api` instead and the
  // browser calls whatever origin it is already on, which this rewrite forwards
  // to the API server-side. One build then works from localhost, from a phone
  // on the office network, through a tunnel, and from a server reached by bare
  // IP — none of which need DNS.
  //
  // It also takes CORS out of the picture entirely, and avoids the
  // mixed-content block you get when an HTTPS tunnel fronts a page whose API
  // calls are plain HTTP.
  //
  // Production sets the absolute `https://api.…` value and routes it through
  // its own nginx, so this rewrite is simply never reached there.
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
