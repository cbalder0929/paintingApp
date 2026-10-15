import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
	base: "/PixiPaintJS/",
  server: {
    port: 8080,
    open: true,
  },
});
