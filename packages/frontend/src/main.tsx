import "./lib/translate-resilience";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { listenForSaleSound } from "./lib/salesSound";

listenForSaleSound();

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<App />);
}
