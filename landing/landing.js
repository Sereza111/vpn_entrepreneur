/**
 * Позволяет подставить ссылку на бота из query (?tg=USERNAME без @).
 */
(function () {
  const q = new URLSearchParams(window.location.search);
  const tg = q.get("tg") || "";
  const user = tg.replace(/^@+/, "").trim();
  const hrefBot = user ? `https://t.me/${encodeURIComponent(user)}` : "";

  document.querySelectorAll("#cta-open-bot, .hero-actions a.btn-primary").forEach((a) => {
    if (!(a instanceof HTMLAnchorElement)) return;
    if (!hrefBot) return;
    a.href = hrefBot;
  });

  const sup = document.getElementById("cta-support-link");
  if (sup instanceof HTMLAnchorElement && hrefBot) {
    sup.href = hrefBot;
  }
})();
