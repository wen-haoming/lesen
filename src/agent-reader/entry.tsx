import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import { bootstrapAppearance } from "@/lib/appearance";
import { AgentReader } from "./reader";

bootstrapAppearance();
createRoot(document.getElementById("root")!).render(<AgentReader />);
