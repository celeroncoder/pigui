import "@fontsource-variable/dm-sans"
import "@fontsource/michroma"
import "@fontsource/jetbrains-mono/400.css"
import "./styles.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
