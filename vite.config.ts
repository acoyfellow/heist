import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({ publicDir: "src/web/public", plugins: [svelte(), tailwindcss()] });
