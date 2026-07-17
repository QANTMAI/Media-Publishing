/** @type {import('next').NextConfig} */
const nextConfig = {
  // Packages that resolve bundled binaries via __dirname must stay in
  // node_modules — bundling them breaks their binary paths.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static", "sharp"],
};

export default nextConfig;
