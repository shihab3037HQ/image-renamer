'use strict';
/* Small page helpers: hero and FAQ buttons that use the tool. */
(function () {
  const ex = document.getElementById('heroExample');
  if (ex) ex.addEventListener('click', () => {
    document.getElementById('tool').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const t = document.getElementById('tryExample'); if (t) t.click();
  });
  document.querySelectorAll('[data-example-csv]').forEach(b => b.addEventListener('click', () => {
    const t = document.getElementById('exampleCsv'); if (t) t.click();
  }));
})();
