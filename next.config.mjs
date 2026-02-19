/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    allowedDevOrigins: [
      "http://localhost:3000",
      "http://192.168.1.128:3000",
    ],
  },
};

export default nextConfig
