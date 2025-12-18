import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
        // Prefer TypeScript sources when both `.js` and `.ts/.tsx` exist.
        extensions: [".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
    },
    server: {
        proxy: {
            "/api": {
                target: "http://localhost:4000",
                changeOrigin: true,
                secure: false,
            },
        },
    },
});
