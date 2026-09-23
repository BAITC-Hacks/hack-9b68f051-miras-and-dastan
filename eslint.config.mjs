import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextVitals,
  { ignores: ["coverage/**", "data/demo/**"] },
];

export default config;
