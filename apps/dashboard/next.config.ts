import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@panopticon/shared'],
  async rewrites() {
    const apiUrl = process.env.INTERNAL_API_URL ?? 'http://api:4400';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
