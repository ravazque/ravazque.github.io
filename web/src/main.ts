import { createApp } from "vue";
import "./styles/fonts.css";
import "./styles/controls.css";
import "./styles/report.css";
import "./styles/dash.css";
import "./styles/site.css";
import "./styles/v2.css";
import App from "./App.vue";
import { router } from "./router";
import { install } from "./lib/behave";
import { applyTheme } from "./lib/look";
import { settings } from "./state";

applyTheme(settings.get("theme"));
install();
createApp(App).use(router).mount("#app");
