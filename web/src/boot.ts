// Loaded as a classic (blocking) script in <head>: applies the saved theme and language
// before the first paint, so the page never flashes in the wrong theme or direction.
(() => {
  try {
    const theme = localStorage.getItem('dx-theme');
    if (theme) document.documentElement.dataset.theme = theme;
    if (localStorage.getItem('dx-lang') === 'en') {
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
    }
  } catch {
    // storage may be blocked
  }
})();
