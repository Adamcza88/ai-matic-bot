const path = require("path");
const reactImport = require("@vitejs/plugin-react");

const react = reactImport.default ?? reactImport;

module.exports = {
  cacheDir: ".vite",
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
    chunkSizeWarningLimit: 900,
  },
};
