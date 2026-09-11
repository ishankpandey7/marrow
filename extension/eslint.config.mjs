import rootConfig from "../eslint.config.mjs";

const config = [
  ...rootConfig,
  { rules: { "@next/next/no-html-link-for-pages": "off" } },
];

export default config;
