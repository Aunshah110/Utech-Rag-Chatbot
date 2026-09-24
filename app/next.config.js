// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['cohere-ai', '@upstash/vector', 'groq-sdk'],
};

module.exports = nextConfig;