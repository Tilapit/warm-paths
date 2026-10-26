import type { NextConfig } from "next";

const config: NextConfig = {
  // The data files are read at request time from ./data.
  serverExternalPackages: ["@anthropic-ai/sdk"],
  devIndicators: false,
  // The dev server's own resources answer only to these origins (never to a tunnel).
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default config;
