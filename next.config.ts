import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ENABLE_STRIPE_TAX is the one switch for Stripe Tax. It is compiled into the server AND the browser code under this
  // name (see stripeTaxEnabled in src/app/utils/pricing.ts), so Checkout and the site's wording about tax cannot disagree.
  env: {
    NEXT_PUBLIC_ENABLE_STRIPE_TAX: process.env.ENABLE_STRIPE_TAX === "true" ? "true" : "false",
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
