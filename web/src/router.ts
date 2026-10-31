import { createRouter, createWebHashHistory, createWebHistory } from "vue-router";
import { offline } from "./offline";

export const router = createRouter({
  history: offline ? createWebHashHistory() : createWebHistory(), // a file opened from disk has no server behind it
  routes: [
    { path: "/", component: () => import("./components/Landing.vue"), beforeEnter: () => (offline ? "/app" : true) },
    { path: "/about", component: () => import("./components/Reading.vue"), props: { page: "about" } },
    { path: "/privacy", component: () => import("./components/Reading.vue"), props: { page: "privacy" } },
    { path: "/refused", component: () => import("./components/Refused.vue") },
    { path: "/app/stats", component: () => import("./components/Stats.vue") },
    { path: "/app/delete", component: () => import("./components/Confirm.vue"), props: { kind: "delete" } },
    { path: "/app/publish", component: () => import("./components/Confirm.vue"), props: { kind: "publish" } },
    { path: "/app/corrections", redirect: "/app/evaluations" },
    { path: "/app/:page(projects|evaluations|people|campus|coalition)?", component: () => import("./components/Dashboard.vue") },
    { path: "/:rest(.*)*", redirect: "/" },
  ],
  scrollBehavior(to, from, saved) {
    if (saved) return saved;
    if (to.path === from.path) return false; // a switch or a filter on the same page keeps the scroll
    if (to.hash) return { el: to.hash, top: 80 };
    return { top: 0 };
  },
});

// the public pages and the app have their own stylesheets' scope (body.site): set before the page renders
const SITE = ["/", "/about", "/privacy", "/refused"];
router.beforeEach((to) => { document.body.classList.toggle("site", SITE.includes(to.path)); });
