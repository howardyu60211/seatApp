import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";

export default tseslint.config(
  // Generated files / dependencies
  {
    ignores: [
      "node_modules/**",
      ".vite/**",
      "out/**",
      "dist/**",
      "graphify-out/**",
    ],
  },

  // SeatApp TypeScript source/config
  {
    files: ["src/**/*.{ts,tsx}", "*.config.{ts,mts}", "eslint.config.mjs"],

    extends: [
      js.configs.recommended,
      // tseslint.configs 是 typescript-eslint 官方文件的用法，不是誤用具名匯出。
      // eslint-disable-next-line import/no-named-as-default-member
      ...tseslint.configs.recommended,
      importPlugin.flatConfigs.recommended,
      importPlugin.flatConfigs.electron,
      importPlugin.flatConfigs.typescript,
      reactHooks.configs.flat["recommended-latest"],
      // 必須放最後：關掉與 Prettier 衝突的樣式規則
      prettier,
    ],

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },

    settings: {
      // eslint-plugin-import 內建的 node resolver 看不懂 package.json 的 exports map，
      // typescript-eslint / @tailwindcss/vite 這類純 ESM 套件會被誤判為 no-unresolved。
      // eslint-plugin-import 2.32 還不支援 resolver-next，只能用舊式的具名 resolver 設定。
      "import/resolver": {
        typescript: {
          project: "./tsconfig.json",
        },
      },
    },
  },
);
