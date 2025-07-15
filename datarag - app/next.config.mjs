import { config } from 'process';

/** @type {import('next').NextConfig} */
const nextConfig = {
    // Canvas is not supported in Node.js
    webpack: (
        config,
        { buildId, dev, isServer, defaultLoaders, nextRuntime, webpack }
      ) => {
        config.externals.push({ canvas: 'commonjs canvas' })
        return config
      },
    };
export default nextConfig;
