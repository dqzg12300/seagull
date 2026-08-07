import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { resolveAppTheme, THEME_STORAGE_KEY } from "./theme.js";
import "./styles.css";
import "./i18n.css";
import "./theme.css";

document.documentElement.dataset.theme = resolveAppTheme(localStorage.getItem(THEME_STORAGE_KEY));

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
