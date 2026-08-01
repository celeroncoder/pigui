import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: "src/renderer",
  publicDir: "../../.e2e-public",
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] }
})
