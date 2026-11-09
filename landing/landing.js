/**
 * Позволяет подставить ссылку на бота из query (?tg=USERNAME без @).
 */
(function () {
  const q = new URLSearchParams(window.location.search);
  const tg = q.get("tg") || "";
  const user = tg.replace(/^@+/, "").trim();
  const hrefBot = user ? `https://t.me/${encodeURIComponent(user)}` : "";

  document.querySelectorAll('a[href="https://t.me/VL_VPNbot"]').forEach((a) => {
    if (!(a instanceof HTMLAnchorElement)) return;
    if (!hrefBot) return;
    a.href = hrefBot;
  });

  const sup = document.getElementById("cta-support-link");
  if (sup instanceof HTMLAnchorElement && hrefBot) {
    sup.href = hrefBot;
  }
})();

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let revealObserver;
if ("IntersectionObserver" in window && !reducedMotion.matches) {
  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
    },
    { threshold: 0.08 },
  );
  document.documentElement.classList.add("js-motion");
  document
    .querySelectorAll(".reveal")
    .forEach((el) => revealObserver.observe(el));
}

const views = {
  profile: {
    title: "01 / ЕДИНЫЙ ПРОФИЛЬ",
    description: "Скопируй ссылку подписки и импортируй её в VPN-клиент.",
  },
  access: {
    title: "02 / ДОСТУП ЧЕРЕЗ TELEGRAM",
    description:
      "Открой мини-приложение в боте и выбери подходящий вариант доступа.",
  },
  control: {
    title: "03 / УПРАВЛЕНИЕ ПОДПИСКОЙ",
    description:
      "Проверяй статус подписки, остаток баланса и доступные узлы на одном экране.",
  },
};
const frame = document.querySelector(".sigil-frame");
const viewButtons = document.querySelectorAll(".sigil-node[data-view]");
viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const view = views[button.dataset.view];
    if (!view) return;
    viewButtons.forEach((other) =>
      other.setAttribute("aria-pressed", String(other === button)),
    );
    document.getElementById("route-caption").textContent = view.title;
    document.getElementById("route-description").textContent = view.description;
    if (frame) frame.dataset.active = button.dataset.view;
  });
});

frame?.addEventListener("pointermove", (event) => {
  if (reducedMotion.matches || event.pointerType !== "mouse") return;
  const rect = frame.getBoundingClientRect();
  frame.style.rotate = `y ${((event.clientX - rect.left) / rect.width - 0.5) * 12}deg`;
});
frame?.addEventListener("pointerleave", () => {
  frame.style.rotate = "";
});
reducedMotion.addEventListener?.("change", () => {
  if (!reducedMotion.matches) return;
  document.documentElement.classList.remove("js-motion");
  revealObserver?.disconnect();
  if (frame) frame.style.rotate = "";
});
