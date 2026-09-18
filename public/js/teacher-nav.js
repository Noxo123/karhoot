(() => {
  const token = localStorage.getItem('karhoot_token');
  const user = JSON.parse(localStorage.getItem('karhoot_user') || '{}');
  if (!token || !['teacher','admin'].includes(user.role)) return;

  const links = [
    ['/teacher.html','🏠','Tableau de bord'],
    ['/quiz-builder.html','🧠','Créer un quiz'],
    ['/teacher-admin.html','⚙️','Administration'],
    ['/avatar-shop.html','🛍️','Boutique avatars'],
    ['/avatar-editor.html','🎨','Éditeur SVG']
  ];
  const current = location.pathname.replace(/\/$/,'') || '/';
  const nav = document.createElement('nav');
  nav.className = 'teacher-global-nav sticky top-0 z-50 border-b border-white/10 bg-[#080912]/85 backdrop-blur-xl shadow-lg';
  nav.innerHTML = `<div class="max-w-7xl mx-auto px-4 py-3 flex items-center gap-2 overflow-x-auto">
    <a href="/teacher.html" class="shrink-0 kh-brand mr-2"><span class="kh-brand-mark" style="width:32px;height:32px;border-radius:10px"><img src="/brand-mark.svg" alt="" aria-hidden="true"></span><span>Karhoot</span></a>
    <div class="h-7 w-px bg-white/10 shrink-0"></div>
    ${links.map(([href,icon,label]) => {
      const active = current === href;
      return `<a href="${href}" class="shrink-0 px-3 py-2 rounded-xl text-sm font-bold transition ${active ? 'bg-violet-600 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'}">${icon} ${label}</a>`;
    }).join('')}
    <a href="/" class="shrink-0 px-3 py-2 rounded-xl text-sm font-bold text-slate-400 hover:bg-white/10 hover:text-white ml-auto">↩ Accueil</a>
  </div>`;
  document.body.prepend(nav);
})();
