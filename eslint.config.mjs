import coreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...coreWebVitals,
  { ignores: [".next/**", "node_modules/**", "storage/**", "next-env.d.ts"] },
];

export default config;
