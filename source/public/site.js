/* Pillow Hub — theme, scroll reveal, install steps (macOS/Windows), copy buttons. */
(() => {
  'use strict';
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // theme: dark ↔ light, remembered
  document.querySelectorAll('[data-theme-toggle]').forEach(b => b.addEventListener('click', () => {
    const cur = root.dataset.theme || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('ph_theme', next); } catch (_) {}
  }));

  // Tab stops, theme state and keyboard navigation remain visible.
  document.querySelectorAll('[data-theme-toggle]').forEach(b => {
    const update = () => {const light=root.dataset.theme==='light';b.setAttribute('aria-label',light?'Switch to dark theme':'Switch to light theme');b.setAttribute('aria-pressed',String(light));};
    update();b.addEventListener('click',update);
  });

  // reveal on scroll
  const items = [...document.querySelectorAll('.rv')];
  items.forEach((el, i) => { if (!el.style.getPropertyValue('--d')) el.style.setProperty('--d', (i % 3) * 0.06 + 's'); });
  if (reduce || !('IntersectionObserver' in window)) items.forEach(el => el.classList.add('in'));
  else {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .1 });
    items.forEach(el => io.observe(el));
  }

  // Free downloads and live counters; Telegram is optional.
  // Relative to this page so a project site such as /pillow-hub-grok/ does not
  // request the domain root. The Node server and the static api/config.json file
  // both answer this URL.
  fetch(new URL('api/config.json', document.baseURI).href).then(r => r.ok ? r.json() : null).then(config => {
    if (!config) return;
    document.querySelectorAll('[data-stat="downloads"]').forEach(n => n.textContent = Number(config.stats?.downloads || 0).toLocaleString());
    document.querySelectorAll('[data-stat="members"]').forEach(n => n.textContent = Number(config.stats?.members || 0).toLocaleString() + ' creators');

  }).catch(() => {});

  // install steps: macOS / Windows (defaults to the visitor's system)
  const segs = [...document.querySelectorAll('[data-os]')];
  function showOS(os) {
    segs.forEach(b => { const on = b.dataset.os === os; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    document.querySelectorAll('[data-os-pane]').forEach(p => { p.hidden = p.dataset.osPane !== os; });
  }
  if (segs.length) {
    segs.forEach(b => b.addEventListener('click', () => showOS(b.dataset.os)));
    showOS(/Win/i.test(navigator.platform || navigator.userAgent) ? 'win' : 'mac');
  }

  // copy buttons
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-copy]'); if (!b) return;
    const text = b.parentElement.querySelector('code').textContent;
    const done = () => { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
    else { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (_) {} t.remove(); }
  });
})();

/* Quiet glass motion. All phase animation follows the actual video engine. */
(() => {
  'use strict';
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav=document.querySelector('.nav');
  if(nav){
    const links=[...nav.querySelectorAll('a')],active=nav.querySelector('[aria-current="page"]')||links[0];
    const glider=document.createElement('span');glider.className='nav-glider';glider.setAttribute('aria-hidden','true');nav.prepend(glider);
    const move=link=>{if(!link)return;nav.style.setProperty('--nav-x',link.offsetLeft+'px');nav.style.setProperty('--nav-width',link.offsetWidth+'px');};
    const restore=()=>move(links.includes(document.activeElement)?document.activeElement:active);
    restore();requestAnimationFrame(()=>nav.classList.add('is-guided'));
    links.forEach(link=>{
      link.addEventListener('focus',()=>move(link));
      if(!reduce&&matchMedia('(hover: hover) and (pointer: fine)').matches)link.addEventListener('pointerenter',()=>move(link));
    });
    nav.addEventListener('pointerleave',restore);
    nav.addEventListener('focusout',()=>queueMicrotask(restore));
    window.addEventListener('resize',restore,{passive:true});
    if('ResizeObserver'in window)new ResizeObserver(restore).observe(nav);
    document.fonts?.ready.then(restore);
  }
  if(reduce||!matchMedia('(hover: hover) and (pointer: fine)').matches)return;
  let pending=0,last=null;
  document.addEventListener('pointermove',event=>{
    const card=event.target.closest?.('.feature,.card,.dl');if(!card)return;
    last={card,x:event.clientX,y:event.clientY};if(pending)return;
    pending=requestAnimationFrame(()=>{
      pending=0;const {card,x,y}=last,rect=card.getBoundingClientRect();
      card.style.setProperty('--glow-x',(x-rect.left)+'px');card.style.setProperty('--glow-y',(y-rect.top)+'px');
    });
  },{passive:true});
})();
