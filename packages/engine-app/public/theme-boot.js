// Before the first paint: a theme chosen in this browser, so the page never flashes the other one. A plain script on
// purpose, since a module waits for the parse; storage that refuses (a private window) leaves the system's theme.
try {
  const theme = localStorage.getItem("louvain-engine-theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {}
