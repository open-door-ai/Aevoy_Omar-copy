/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Skip type checking during build (known React 19 types issue with lucide-react)
    ignoreBuildErrors: true,
  },
  images: {
    domains: ['localhost'],
  },
}

module.exports = nextConfig
