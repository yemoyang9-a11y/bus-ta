import globals from "globals";
import tseslint from "typescript-eslint";

// Keep this gate focused on defects; TypeScript owns TS name/type checking.
export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.expo/**", ".agent-loop/**", ".worktrees/**"] },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: { ecmaVersion: "latest", parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      "no-undef": "error",
      "constructor-super": "error",
      "no-dupe-args": "error",
      "no-dupe-else-if": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-unexpected-multiline": "error",
      "no-unsafe-finally": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
    },
  },
  {
    files: ["apps/server/**/*.{js,mjs,cjs,ts}", "scripts/**/*.{js,mjs,ts}", "eslint.config.mjs", "apps/mobile/*.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/mobile/**/*.{js,jsx,ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node, __DEV__: "readonly" } },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: { "no-undef": "off" },
  },
];
