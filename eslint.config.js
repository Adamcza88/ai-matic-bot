import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import pluginReact from "eslint-plugin-react";

export default defineConfig(
    eslint.configs.recommended,
    tseslint.configs.strict,
    pluginReact.configs.flat.recommended,
    pluginReact.configs.flat["jsx-runtime"],
    {
        ignores: ["**/*.js", "dist/**", "node_modules/**"],
    },
    {
        settings: {
            react: {
                version: "detect",
            },
        },
    }
);
