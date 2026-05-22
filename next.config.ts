import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

/** Absoluut pad — nodig bij mapnaam met spaties (Turbopack/Webpack root). */
const projectDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectDir,
  experimental: {
    serverActions: {
      // Audio-uploads gaan nu via /transcribe-chunk (chunks van ~2 MB), maar
      // we houden ruimte voor andere uploads (bv. Word-templates).
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
