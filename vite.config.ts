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
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes("node_modules")) return;
                    if (id.includes("react")) return "react";
                    if (id.includes("@radix-ui")) return "radix";
                    if (id.includes("i18next") || id.includes("react-i18next")) return "i18n";
                    if (id.includes("lucide-react")) return "icons";
                    return "vendor";
                },
            },
        },
    },
});
