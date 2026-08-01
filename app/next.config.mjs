/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // PGlite ships its Postgres extensions (e.g. btree_gist) as .tar.gz
  // bundles loaded from disk at runtime. Webpack's default bundling
  // rewrites that internal file access into a static-asset URL, which
  // breaks in a Node server context (it's not a browser — there's no
  // server to fetch that URL from). Telling Next not to bundle this
  // package and let Node's native `require`/`import` resolve it directly
  // avoids that rewrite entirely. This only matters for the embedded
  // dev/test database path (db/client.ts) — a real Postgres/Supabase
  // connection in production never touches this package.
  experimental: {
    serverComponentsExternalPackages: ["@electric-sql/pglite"],
  },
};
export default nextConfig;
