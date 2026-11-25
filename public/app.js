'use strict';

const $ = (id) => document.getElementById(id);
const STATE = {
  config: { governorates: [], categories: [], stores: [] },
  view: 'home', kind: 'all', contributionKind: 'product', compareMode: 'product',
  results: [], searchMeta: null, approvedContributions: [], currentProduct: null,
  savedTab: 'favorites', adminToken: sessionStorage.getItem('kam_admin_token') || '', authUser: null, googleConfigured: false
};
const STORE = {
  userKey: 'kam_user_key_v2', favorites: 'kam_favorites_v2', alerts: 'kam_alerts_v2',
  recent: 'kam_recent_v2', theme: 'kam_theme_v2'
};

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function writeStorage(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function userKey() {
  let key = localStorage.getItem(STORE.userKey);
  if (!key) { key = `kam_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`; localStorage.setItem(STORE.userKey, key); }
  return key;
}
function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return window.KAM_I18N?.t('غير متاح') || 'غير متاح';
  return window.KAM_I18N?.language === 'en' ? `${n.toLocaleString('en-US',{maximumFractionDigits:2})} EGP` : `${n.toLocaleString('ar-EG',{maximumFractionDigits:2})} ج.م`;
}
function uiText(arabic) { return window.KAM_I18N?.t(arabic) || arabic; }
function uiLocale() { return window.KAM_I18N?.language === 'en' ? 'en-US' : 'ar-EG'; }

function dateLabel(value) {
  if (!value) return uiText('وقت الرصد غير متاح');
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(uiLocale(),{dateStyle:'medium',timeStyle:'short'});
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function safeHttpUrl(value) {
  try { const url = new URL(String(value || ''), location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}
function toast(message, type = '') {
  const node = document.createElement('div'); node.className = `toast ${type}`; node.textContent = message;
  $('toastRegion').append(node); setTimeout(() => node.remove(), 4200);
}
async function api(path, options = {}) {
  const headers = { 'content-type':'application/json', 'x-kam-user':userKey(), ...(options.headers || {}) };
  const response = await fetch(path, { ...options, headers, credentials:'same-origin', signal: options.signal || AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `تعذر إكمال الطلب (${response.status})`);
  return data;
}
function categoryById(id) { return STATE.config.categories.find(x => x.id === id); }
function categoryOptions(kind = 'all') {
  return STATE.config.categories.filter(c => kind === 'all' || c.kind === kind)
    .map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
}
function governorateOptions(includeAll = false) {
  const top = includeAll ? '<option value="كل مصر">كل مصر</option>' : '<option value="">اختر المحافظة</option>';
  return top + STATE.config.governorates.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
}
function fillStaticSelects() {
  $('heroGovernorate').innerHTML = governorateOptions(true);
  $('exploreGovernorate').innerHTML = governorateOptions(true);
  $('contributionGovernorate').innerHTML = governorateOptions(false);
  $('serviceGovernorate').innerHTML = governorateOptions(false);
  $('exploreCategory').innerHTML = '<option value="all">كل الأقسام</option>' + categoryOptions('all');
  $('contributionCategory').innerHTML = categoryOptions('product');
  $('serviceCategory').innerHTML = categoryOptions('service');
  $('compareProductCategory').innerHTML = categoryOptions('product');
  $('compareProductGovernorate').innerHTML = governorateOptions(false);
  $('contributionDate').max = new Date().toISOString().slice(0,10);
  $('contributionDate').value = new Date().toISOString().slice(0,10);
  $('year').textContent = new Date().getFullYear();
}
function go(view, {push = true} = {}) {
  const valid = ['home','explore','deals','compare','contribute','saved','account','admin','about'];
  if (!valid.includes(view)) view = 'home';
  STATE.view = view;
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `view-${view}`));
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  if (push) history.pushState({view}, '', `#${view}`);
  $('mobileMenu').classList.remove('open');
  window.scrollTo({top:0, behavior:'smooth'});
  if (view === 'account') loadAccount();
  if (view === 'saved') renderSaved();
  if (view === 'deals') loadDeals();
  if (view === 'admin' && STATE.adminToken) loadAdminQueue();
  if (view === 'explore' && window.matchMedia('(min-width: 761px)').matches) setTimeout(() => $('exploreSearch').focus({preventScroll:true}), 100);
}
function initNavigation() {
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-view]');
    if (target) { event.preventDefault(); go(target.dataset.view); }
  });
  document.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); go(el.dataset.nav); }));
  $('mobileMenuButton').addEventListener('click', () => $('mobileMenu').classList.toggle('open'));
  window.addEventListener('popstate', event => {
    const view = event.state?.view || location.hash.slice(1) || 'home';
    go(view, {push:false});
  });
  if (location.hash) go(location.hash.slice(1), {push:false});
  // Extra mouse buttons: button 3 = browser Back, button 4 = browser Forward.
  document.addEventListener('auxclick', event => {
    if (event.button === 3) { event.preventDefault(); history.back(); }
    if (event.button === 4) { event.preventDefault(); history.forward(); }
  });
  document.addEventListener('keydown', event => {
    if ((event.altKey && event.key === 'ArrowLeft') || (event.metaKey && event.key === '[')) { event.preventDefault(); history.back(); }
    if ((event.altKey && event.key === 'ArrowRight') || (event.metaKey && event.key === ']')) { event.preventDefault(); history.forward(); }
    if (event.key === 'Escape') closeModal();
  });
}
function initTheme() {
  const theme = localStorage.getItem(STORE.theme);
  if (theme === 'light') document.body.classList.add('light');
  $('themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('light');
    localStorage.setItem(STORE.theme, document.body.classList.contains('light') ? 'light' : 'dark');
  });
}
function initCategories() {
  const visible = STATE.config.categories;
  $('homeCategories').innerHTML = visible.map(c => `<button class="category-card" data-category="${esc(c.id)}" data-kind="${c.kind}"><span class="category-emoji">${c.icon}</span><strong>${esc(c.name)}</strong><small>${c.kind === 'product' ? 'مقارنة منتجات' : 'أسعار خدمات'}</small></button>`).join('');
  $('homeCategories').addEventListener('click', e => {
    const btn = e.target.closest('[data-category]'); if (!btn) return;
    $('exploreCategory').value = btn.dataset.category;
    $('exploreSearch').value = '';
    setExploreKind(btn.dataset.kind);
    go('explore'); runExplore();
  });
  document.querySelectorAll('#kindSegment button').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('#kindSegment button').forEach(x => x.classList.toggle('selected', x === btn));
    STATE.kind = btn.dataset.kind;
    const categorySelect = $('exploreCategory');
    categorySelect.innerHTML = '<option value="all">كل الأقسام</option>' + categoryOptions(STATE.kind);
    updateActiveChips();
  }));
  document.querySelectorAll('#contributionKind button').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('#contributionKind button').forEach(x => x.classList.toggle('selected', x === btn));
    STATE.contributionKind = btn.dataset.kind;
    $('contributionCategory').innerHTML = categoryOptions(STATE.contributionKind);
  }));
  document.querySelectorAll('[data-compare-mode]').forEach(btn => btn.addEventListener('click', () => setCompareMode(btn.dataset.compareMode)));
}
function setExploreKind(kind) {
  STATE.kind = kind;
  document.querySelectorAll('#kindSegment button').forEach(x => x.classList.toggle('selected', x.dataset.kind === kind));
  $('exploreCategory').innerHTML = '<option value="all">كل الأقسام</option>' + categoryOptions(kind);
}
function setCompareMode(mode) {
  STATE.compareMode = mode;
  document.querySelectorAll('[data-compare-mode]').forEach(x => x.classList.toggle('selected', x.dataset.compareMode === mode));
  $('productCompareForm').hidden = mode !== 'product'; $('serviceCompareForm').hidden = mode !== 'service';
  $('compareOutput').innerHTML = '<div class="empty-state"><div>⇄</div><h3>نتيجة المقارنة هتظهر هنا</h3><p>أدخل بيانات المقارنة وابدأ.</p></div>';
}
function updateActiveChips() {
  const chips = [];
  if (STATE.kind !== 'all') chips.push(STATE.kind === 'product' ? 'منتجات' : 'خدمات');
  if ($('exploreCategory').value !== 'all') chips.push(categoryById($('exploreCategory').value)?.name || 'قسم');
  if ($('exploreGovernorate').value !== 'كل مصر') chips.push($('exploreGovernorate').value);
  $('activeChips').innerHTML = chips.map(x => `<span class="filter-chip">${esc(x)}</span>`).join('');
}

async function loadHealth() {
  try {
    const health = await api('/api/health');
    const connected = health.integrations?.pricelens?.configured;
    $('heroLivePill').textContent = connected ? 'مصدر الأسعار متصل' : 'مصدر الأسعار غير مفعّل';
    $('heroLivePill').classList.toggle('connected', Boolean(connected));
    $('sourceStatus').textContent = connected ? 'مصدر البيانات متصل' : 'بانتظار مفتاح مزود البيانات';
    renderStores(health);
    if (connected) {
      try { const storeData = await api('/api/market/stores'); if (storeData.mode === 'live' && storeData.stores?.length) {
        $('storeStrip').innerHTML = storeData.stores.slice(0,14).map(s => `<div class="store-chip online"><span></span>${esc(s.name || s.store || s.id || 'متجر')}</div>`).join('') + '<div class="store-chip"><span></span>Dubizzle · بحث خارجي</div>';
      } } catch {}
    }
  } catch {
    $('sourceStatus').textContent = 'تعذر الاتصال بالسيرفر';
    $('heroLivePill').textContent = 'السيرفر غير متاح';
  }
}
function renderStores(health) {
  const connected = Boolean(health?.integrations?.pricelens?.configured);
  const show = STATE.config.stores.slice(0,9);
  $('storeStrip').innerHTML = show.map(s => `<div class="store-chip ${connected && s.mode==='aggregator'?'online':''}"><span></span>${esc(s.name)}</div>`).join('') + `<div class="store-chip"><span></span>Dubizzle · بحث خارجي</div>`;
}
function addRecent(query, kind = 'product') {
  if (!query) return;
  const items = readStorage(STORE.recent, []).filter(x => x.query !== query);
  items.unshift({query,kind,at:new Date().toISOString()}); writeStorage(STORE.recent,items.slice(0,12));
}
function showExternalLinks(links) {
  const node = $('externalSources');
  if (!links?.length) { node.hidden = true; node.innerHTML = ''; return; }
  node.hidden = false;
  node.innerHTML = `<strong>افتح بحثًا مباشرًا في المنصات</strong>${links.map(x => { const url=safeHttpUrl(x.url); return url ? `<a class="external-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)} ↗</a>` : ''; }).join('')}`;
}
function renderProducts(products, mode) {
  STATE.results = products || [];
  if (!products?.length) {
    $('exploreResults').innerHTML = `<div class="empty-state"><div>⌕</div><h3>${mode==='not_configured'?'مصدر الأسعار الحية غير مفعّل بعد':'لم نجد عروضًا مطابقة'}</h3><p>${mode==='not_configured'?'تقدر تفتح بحثًا مباشرًا في المتاجر الآن، أو تفعيل مزود الأسعار من إعدادات السيرفر لعرض المقارنة داخل كَم؟.':'جرب صياغة مختلفة أو ابحث في متجر آخر.'}</p></div>`;
    return;
  }
  const sortMode = $('exploreSort')?.value || 'relevance';
  const sorted = [...products].sort((a,b) => sortMode === 'priceDesc' ? (b.offers?.[0]?.price ?? -Infinity) - (a.offers?.[0]?.price ?? -Infinity) : (a.offers?.[0]?.price ?? Infinity) - (b.offers?.[0]?.price ?? Infinity));
  $('exploreResults').innerHTML = sorted.map(p => {
    const offers = p.offers || []; const lowest = offers[0]; const isSaved = readStorage(STORE.favorites,[]).some(x=>x.id===p.id);
    const shops = [...new Set(offers.map(x=>x.retailer))].slice(0,4);
    return `<article class="product-card">
      <div class="product-card-top"><div class="product-image">${p.image ? `<img src="${esc(safeHttpUrl(p.image))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '📦'}</div><div class="product-head"><h3>${esc(p.title)}</h3><div class="product-meta">${esc(p.brand || p.category || 'منتج')} · ${offers.length} عرض</div></div><button class="save-button ${isSaved?'saved':''}" data-save-product="${esc(p.id)}" aria-label="حفظ المنتج">${isSaved?'♥':'♡'}</button></div>
      <div class="retailer-pills">${shops.map(s=>`<span class="retailer-pill">${esc(s)}</span>`).join('')}</div>
      <div class="product-card-bottom"><div class="lowest-price"><small>أقل سعر مرصود</small><strong>${lowest?money(lowest.price):'غير متاح'}</strong></div><div class="offer-count">${lowest?`آخر رصد<br>${esc(dateLabel(lowest.last_seen))}`:'لا توجد عروض متاحة'}</div></div>
      <div class="product-actions"><button class="button button-primary" data-product-detail="${esc(p.id)}">تفاصيل المقارنة</button><button class="button button-quiet" data-watch="${esc(p.id)}">تنبيه سعر</button></div>
    </article>`;
  }).join('') + (mode === 'live' ? '<div class="form-footnote wide">الأسعار بواسطة <a href="https://pricelens.store" target="_blank" rel="noopener noreferrer">PriceLens</a>. روابط العروض تُعرض كما وصلت من المصدر.</div>' : '');
  $('exploreResults').querySelectorAll('[data-product-detail]').forEach(btn => btn.addEventListener('click',()=>openProduct(btn.dataset.productDetail)));
  $('exploreResults').querySelectorAll('[data-save-product]').forEach(btn => btn.addEventListener('click',()=>toggleFavorite(btn.dataset.saveProduct)));
  $('exploreResults').querySelectorAll('[data-watch]').forEach(btn => btn.addEventListener('click',()=>createAlert(btn.dataset.watch)));
}
function renderServiceGroups(rows, query, governorate, category) {
  const filtered = rows.filter(r => (!query || r.item_name.toLowerCase().includes(query.toLowerCase())) && (governorate==='كل مصر'||r.governorate===governorate) && (!category||category==='all'||r.category===category));
  const groups = new Map();
  for (const r of filtered) {
    const key = `${r.item_name}|${r.category}|${r.governorate}`;
    if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(r);
  }
  const cards = [...groups.values()].map(items => {
    const prices = items.map(x=>Number(x.price)).sort((a,b)=>a-b); const med=prices[Math.floor(prices.length/2)];
    return {items, name:items[0].item_name, category:items[0].category, governorate:items[0].governorate, low:prices[0], high:prices.at(-1), median:med, count:items.length, latest:items[0].date_paid};
  }).sort((a,b)=>b.count-a.count);
  $('resultsCount').textContent = `${cards.length} مجموعة · ${filtered.length} تجربة معتمدة`;
  if (!cards.length) {
    $('exploreResults').innerHTML = '<div class="empty-state"><div>◎</div><h3>لسه مفيش تجارب معتمدة كفاية</h3><p>كن أول شخص يضيف تجربة سعر حقيقية، وبعد مراجعتها هتساعد غيرك.</p><button class="button button-primary" data-view="contribute">شارك سعرًا</button></div>';
    return;
  }
  $('exploreResults').innerHTML = cards.map((g,i)=>`<article class="product-card"><div class="product-card-top"><div class="product-image">🧾</div><div class="product-head"><h3>${esc(g.name)}</h3><div class="product-meta">${esc(categoryById(g.category)?.name || g.category)} · ${esc(g.governorate)}</div></div></div><div class="product-card-bottom"><div class="lowest-price"><small>نطاق الأسعار المعتمدة</small><strong>${money(g.low)} – ${money(g.high)}</strong></div><div class="offer-count">${g.count} تجربة<br>آخر تجربة ${esc(g.latest)}</div></div><div class="product-meta" style="margin-top:10px">الوسيط ${money(g.median)} · لا يشمل اختلاف جودة الخدمة</div><div class="product-actions"><button class="button button-primary" data-service-detail="${i}">عرض التجارب</button><button class="button button-quiet" data-service-compare="${i}">قارن عرضك</button></div></article>`).join('');
  $('exploreResults').querySelectorAll('[data-service-detail]').forEach(btn=>btn.addEventListener('click',()=>openServiceGroup(cards[Number(btn.dataset.serviceDetail)])));
  $('exploreResults').querySelectorAll('[data-service-compare]').forEach(btn=>btn.addEventListener('click',()=>{
    const g=cards[Number(btn.dataset.serviceCompare)]; setCompareMode('service'); $('serviceName').value=g.name; $('serviceCategory').value=g.category; $('serviceGovernorate').value=g.governorate; go('compare');
  }));
}
function renderCommunityProductPrices(rows) {
  if (!rows?.length) return;
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.item_name}|${row.category}|${row.governorate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const cards = [...groups.values()].map(items => {
    const prices = items.map(x=>Number(x.price)).filter(x=>x>0).sort((a,b)=>a-b);
    return {items,name:items[0].item_name,category:items[0].category,governorate:items[0].governorate,count:prices.length,low:prices[0],high:prices.at(-1),median:prices[Math.floor(prices.length/2)],latest:items[0].date_paid};
  });
  if (!cards.length) return;
  const html = `<div class="community-block wide"><div class="section-heading"><div><span class="kicker">تجارب ناس حقيقية</span><h2>أسعار شاركها المجتمع</h2><p>هذه مساهمات معتمدة وليست عروض متاجر. تختلف النتائج حسب الموديل والحالة والمنطقة.</p></div></div><div class="results-grid">${cards.map((g,i)=>`<article class="product-card"><div class="product-card-top"><div class="product-image">🧾</div><div class="product-head"><h3>${esc(g.name)}</h3><div class="product-meta">${esc(categoryById(g.category)?.name||g.category)} · ${esc(g.governorate)}</div></div></div><div class="product-card-bottom"><div class="lowest-price"><small>${g.count>=3?'نطاق التجارب المعتمدة':'أحدث سعر مبلغ عنه'}</small><strong>${g.count>=3?`${money(g.low)} – ${money(g.high)}`:money(g.latest?g.items[0].price:0)}</strong></div><div class="offer-count">${g.count} تجربة<br>آخر تحديث ${esc(g.latest)}</div></div><div class="product-meta" style="margin-top:9px">${g.count>=3?`الوسيط ${money(g.median)}`:'عدد محدود من التجارب — لا يكفي لحكم إحصائي'}</div><div class="product-actions"><button class="button button-primary" data-community-detail="${i}">تفاصيل التجارب</button></div></article>`).join('')}</div></div>`;
  $('exploreResults').insertAdjacentHTML('beforeend',html);
  const block = $('exploreResults').querySelector('.community-block');
  block?.querySelectorAll('[data-community-detail]').forEach(btn=>btn.addEventListener('click',()=>openServiceGroup(cards[Number(btn.dataset.communityDetail)])));
}

async function runExplore() {
  const query = $('exploreSearch').value.trim(); const category = $('exploreCategory').value; const governorate = $('exploreGovernorate').value;
  updateActiveChips(); showExternalLinks([]);
  if (STATE.kind === 'service' || (STATE.kind === 'all' && categoryById(category)?.kind === 'service')) {
    $('resultsCount').textContent = 'جارٍ تحميل تجارب المجتمع…'; $('exploreResults').innerHTML='<div class="skeleton"></div><div class="skeleton"></div>';
    try {
      const result = await api('/api/contributions'); STATE.approvedContributions = result.contributions || [];
      renderServiceGroups(STATE.approvedContributions,query,governorate,category);
    } catch(e) { $('exploreResults').innerHTML=`<div class="empty-state"><h3>تعذر تحميل التجارب</h3><p>${esc(e.message)}</p></div>`; }
    return;
  }
  if (STATE.kind === 'all' && !category && !query) {
    $('resultsCount').textContent='اختر قسمًا أو اكتب كلمة للبحث';
    $('exploreResults').innerHTML='<div class="empty-state"><div>⌕</div><h3>ابدأ البحث عن منتج</h3><p>الأسعار المباشرة لا تظهر إلا بعد الاتصال بمصدر بيانات.</p></div>';
    return;
  }
  if (!query) { $('resultsCount').textContent='اكتب اسم المنتج للبحث'; $('exploreResults').innerHTML='<div class="empty-state"><h3>اكتب اسم المنتج</h3><p>اختيار القسم وحده لا يكفي لطلب أسعار منتج محدد.</p></div>'; return; }
  addRecent(query,'product'); $('resultsCount').textContent='جارٍ البحث في المتاجر…'; $('exploreResults').innerHTML='<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const result = await api(`/api/market/search?q=${encodeURIComponent(query)}&category=${encodeURIComponent(category==='all'?'':category)}`);
    if (categoryById(category)?.kind === 'service') {
      const rows = await api('/api/contributions'); renderServiceGroups(rows.contributions || [],query,governorate,category); return;
    }
    renderProducts(result.products || [],result.mode);
    const links = result.storeLinks || [];
    showExternalLinks(links);
    $('resultsCount').textContent = result.mode === 'live' ? `${result.products?.length || 0} منتج · بيانات من ${result.provider}` : 'بحث خارجي — لم يتم تفعيل مصدر الأسعار الحي';
    if (result.mode === 'live') maybeTriggerAlerts(result.products || []);
    try {
      const params = new URLSearchParams({kind:'product',q:query});
      if (category !== 'all') params.set('category',category);
      if (governorate !== 'كل مصر') params.set('governorate',governorate);
      const community = await api(`/api/contributions?${params.toString()}`);
      renderCommunityProductPrices(community.contributions || []);
    } catch {}
    STATE.searchMeta = result; addRecent(query,'product');
  } catch(e) { $('resultsCount').textContent='حدث خطأ'; $('exploreResults').innerHTML=`<div class="empty-state"><h3>تعذر إكمال البحث</h3><p>${esc(e.message)}</p></div>`; }
}
function openProduct(id) {
  const p = STATE.results.find(x=>String(x.id)===String(id)); if (!p) return;
  STATE.currentProduct = p;
  const offers = p.offers || [];
  const historyRows = (Array.isArray(p.history) ? p.history : []).map(h => ({
    date: h.date || h.observed_at || h.timestamp || h.day || '',
    price: Number(h.price ?? h.median ?? h.value ?? h.amount)
  })).filter(h => Number.isFinite(h.price) && h.price > 0).slice(-10);
  const minHistory = historyRows.length ? Math.min(...historyRows.map(h=>h.price)) : 0;
  const maxHistory = historyRows.length ? Math.max(...historyRows.map(h=>h.price)) : 0;
  const historyChart = historyRows.length ? `<section style="margin-top:16px"><h3 style="font-size:12px;margin:0 0 9px">سجل السعر المتاح من المصدر</h3><div style="display:flex;align-items:end;gap:6px;height:86px;padding:7px 2px;border-bottom:1px solid var(--line)">${historyRows.map(h=>`<div title="${esc(dateLabel(h.date))}: ${money(h.price)}" style="flex:1;min-width:8px;height:${Math.max(10,((h.price-minHistory)/(maxHistory-minHistory||1))*72+10)}px;background:linear-gradient(0deg,var(--purple2),var(--purple));border-radius:6px 6px 2px 2px"></div>`).join('')}</div><div class="form-footnote">${esc(dateLabel(historyRows[0].date))} — ${esc(dateLabel(historyRows.at(-1).date))}. يعرض فقط النقاط التي أرسلها المصدر.</div></section>` : '<p class="form-footnote" style="margin-top:14px">لا يتوفر سجل تاريخي لهذا المنتج في استجابة المصدر الحالية.</p>';
  const rows = offers.map(o=>`<tr><td><strong>${esc(o.retailer)}</strong>${o.seller?`<br><small>${esc(o.seller)}</small>`:''}</td><td><strong>${money(o.price)}</strong></td><td>${o.in_stock===true?'<span class="tag">متاح</span>':o.in_stock===false?'<span class="tag warn">غير متاح</span>':'—'}</td><td>${esc(dateLabel(o.last_seen))}</td><td>${o.link?`<a href="${esc(safeHttpUrl(o.link))}" target="_blank" rel="noopener noreferrer">اذهب للمتجر ↗</a>`:'—'}</td></tr>`).join('');
  showModal(p.title,`<div class="modal-product-head"><div class="product-image">${p.image?`<img src="${esc(safeHttpUrl(p.image))}" alt="" referrerpolicy="no-referrer">`:'📦'}</div><div><h3>${esc(p.title)}</h3><p>${esc(p.brand||'')} · ${offers.length} عروض مرصودة</p></div></div>${historyChart}<div style="overflow:auto;margin-top:14px"><table class="offer-table"><thead><tr><th>المتجر والبائع</th><th>السعر</th><th>التوفر</th><th>وقت الرصد</th><th>المصدر</th></tr></thead><tbody>${rows || '<tr><td colspan="5">لا توجد عروض مرصودة لهذا المنتج.</td></tr>'}</tbody></table></div><p class="form-footnote">الأسعار بواسطة <a href="https://pricelens.store" target="_blank" rel="noopener noreferrer">PriceLens</a>. رابط كل عرض محفوظ كما وصل من المصدر.</p><div class="modal-actions"><button class="button button-primary" id="modalSaveProduct">${readStorage(STORE.favorites,[]).some(x=>x.id===p.id)?'إزالة من المحفوظات':'حفظ المنتج'}</button><button class="button button-quiet" id="modalShareProduct">مشاركة المقارنة</button><button class="button button-quiet" id="modalAlertProduct">إنشاء تنبيه سعر</button></div><p class="form-footnote">قد يتغير السعر أو المخزون قبل إتمام الشراء. تحقق من السعر النهائي والشحن والضمان في المتجر.</p>`);
  $('modalSaveProduct').addEventListener('click',()=>{toggleFavorite(p.id);closeModal();});
  $('modalShareProduct').addEventListener('click',()=>shareCurrentSearch(p.title));
  $('modalAlertProduct').addEventListener('click',()=>createAlert(p.id));
}
function openServiceGroup(group) {
  const rows = group.items.map(x=>`<div class="saved-row"><span><strong>${money(x.price)}</strong><small>${esc(x.city||x.governorate)} · ${esc(x.date_paid)} · تقييم ${x.rating||'—'}/5</small></span><span class="tag">معتمدة</span></div>`).join('');
  showModal(group.name,`<p class="form-footnote">${esc(categoryById(group.category)?.name||group.category)} · ${esc(group.governorate)} · ${group.count} تجارب معتمدة</p><div class="result-summary"><div class="result-verdict neutral">نطاق التجارب المسجلة</div><div class="result-metric">${money(group.low)} – ${money(group.high)}</div><div class="result-meta">الوسيط: ${money(group.median)} · ليس عرض سعر ملزمًا</div></div><div style="display:grid;gap:8px;margin-top:14px">${rows}</div><div class="modal-actions"><button class="button button-primary" id="modalCompareService">قارن عرض سعر</button></div>`);
  $('modalCompareService').addEventListener('click',()=>{closeModal();setCompareMode('service');$('serviceName').value=group.name;$('serviceCategory').value=group.category;$('serviceGovernorate').value=group.governorate;go('compare');});
}
function showModal(title, html) { $('modalTitle').textContent=title; $('modalContent').innerHTML=html; $('modalBackdrop').hidden=false; document.body.style.overflow='hidden'; }
function closeModal() { $('modalBackdrop').hidden=true; $('modalContent').innerHTML=''; document.body.style.overflow=''; }
function initModal() { $('modalClose').addEventListener('click',closeModal); $('modalBackdrop').addEventListener('click',e=>{if(e.target===$('modalBackdrop'))closeModal();}); }
function getFavorites(){return readStorage(STORE.favorites,[])}
function toggleFavorite(id) {
  const product=STATE.results.find(x=>String(x.id)===String(id)) || (STATE.currentProduct?.id===id?STATE.currentProduct:null);
  const list=getFavorites(); const index=list.findIndex(x=>String(x.id)===String(id));
  if(index>=0){list.splice(index,1);toast('تمت الإزالة من المحفوظات.');}
  else {list.unshift(product?{id:String(product.id),title:product.title,category:product.category||'',savedAt:new Date().toISOString()}:{id:String(id),title:'منتج محفوظ',savedAt:new Date().toISOString()});toast('تم حفظ المنتج.','success');}
  writeStorage(STORE.favorites,list); renderSaved();
}
function createAlert(id) {
  const product=STATE.results.find(x=>String(x.id)===String(id)) || STATE.currentProduct;
  if(!product){toast('ابحث عن المنتج أولًا لإنشاء تنبيه.');return;}
  const raw=prompt(uiText('اكتب السعر المستهدف بالجنيه الذي تريد التنبيه عند الوصول إليه:'));
  const target=Number(raw);
  if(!raw || !Number.isFinite(target) || target<=0){toast('لم يتم إنشاء التنبيه. أدخل سعرًا صحيحًا.');return;}
  const alerts=readStorage(STORE.alerts,[]); alerts.unshift({id:String(product.id),title:product.title,target,createdAt:new Date().toISOString()}); writeStorage(STORE.alerts,alerts); toast('تم إنشاء تنبيه محلي. يحتاج فتح كَم؟ ومصدر الأسعار متصلًا للتحقق من التغيرات.','success');
}
function maybeTriggerAlerts(products) {
  const alerts=readStorage(STORE.alerts,[]); let changed=false;
  for(const p of products){const low=p.offers?.[0]?.price;if(!low)continue;for(const a of alerts){if(String(a.id)===String(p.id)&&low<=a.target&&!a.notified){toast(`وصل ${p.title} إلى ${money(low)} — أقل من السعر المستهدف.`,'success');a.notified=true;changed=true;}}}
  if(changed)writeStorage(STORE.alerts,alerts);
}
function renderSaved() {
  const node=$('savedContent');
  if(STATE.savedTab==='favorites'){
    const list=getFavorites(); node.innerHTML=list.length?list.map(x=>`<div class="saved-row"><span><strong>${esc(x.title)}</strong><small>تم الحفظ ${esc(dateLabel(x.savedAt))}</small></span><button data-remove-fav="${esc(x.id)}">إزالة ×</button></div>`).join(''):'<div class="empty-state"><div>♡</div><h3>المحفوظات فارغة</h3><p>احفظ المنتجات التي تريد متابعتها أثناء البحث.</p><button class="button button-primary" data-view="explore">ابدأ البحث</button></div>';
    node.querySelectorAll('[data-remove-fav]').forEach(b=>b.addEventListener('click',()=>{writeStorage(STORE.favorites,getFavorites().filter(x=>x.id!==b.dataset.removeFav));renderSaved();}));
  } else if(STATE.savedTab==='alerts'){
    const list=readStorage(STORE.alerts,[]); node.innerHTML=list.length?list.map(x=>`<div class="saved-row"><span><strong>${esc(x.title)}</strong><small>تنبيه عند ${money(x.target)} · ${x.notified?'تم الوصول للهدف':'بانتظار الرصد'}</small></span><button data-remove-alert="${esc(x.id)}">حذف ×</button></div>`).join(''):'<div class="empty-state"><div>⌁</div><h3>لا توجد تنبيهات بعد</h3><p>من صفحة تفاصيل المنتج أنشئ تنبيهًا عند وصول السعر لهدفك.</p></div>';
    node.querySelectorAll('[data-remove-alert]').forEach(b=>b.addEventListener('click',()=>{writeStorage(STORE.alerts,list.filter(x=>x.id!==b.dataset.removeAlert));renderSaved();}));
  } else {
    const list=readStorage(STORE.recent,[]); node.innerHTML=list.length?list.map(x=>`<div class="saved-row"><span><strong>${esc(x.query)}</strong><small>${esc(dateLabel(x.at))}</small></span><button data-run-recent="${esc(x.query)}">ابحث ↗</button></div>`).join(''):'<div class="empty-state"><div>◷</div><h3>لا يوجد سجل بحث</h3><p>عمليات البحث القادمة ستظهر هنا.</p></div>';
    node.querySelectorAll('[data-run-recent]').forEach(b=>b.addEventListener('click',()=>{$('exploreSearch').value=b.dataset.runRecent;go('explore');runExplore();}));
  }
}
function initSaved() {
  document.querySelectorAll('[data-saved-tab]').forEach(b=>b.addEventListener('click',()=>{STATE.savedTab=b.dataset.savedTab;document.querySelectorAll('[data-saved-tab]').forEach(x=>x.classList.toggle('selected',x===b));renderSaved();}));
  $('savedButton').addEventListener('click',()=>go('saved'));
}
async function loadDeals() {
  $('dealsGrid').innerHTML='<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try{
    const data=await api('/api/market/deals'); const deals=data.deals||[];
    if(!deals.length){$('dealsGrid').innerHTML='<div class="empty-state wide"><div>✦</div><h3>لا توجد عروض حية متاحة</h3><p>اربط مزود الأسعار أولًا. لن نعرض خصومات أو نسب توفير غير موثقة.</p></div>';return;}
    $('dealsGrid').innerHTML=deals.map(d=>`<article class="product-card"><div class="product-card-top"><div class="product-image">${safeHttpUrl(d.product?.image_url)?`<img src="${esc(safeHttpUrl(d.product.image_url))}" alt=""/>`:'✦'}</div><div class="product-head"><h3>${esc(d.product?.title_ar||d.product?.title||'عرض')}</h3><div class="product-meta">${esc(d.retailer||'متجر')} · ${esc(d.seller||'')}</div></div></div><div class="product-card-bottom"><div class="lowest-price"><small>السعر الحالي</small><strong>${money(d.price)}</strong></div><div class="offer-count">توفير موثق ${Number(d.verified_discount_pct||0).toLocaleString(uiLocale())}%</div></div><div class="product-actions"><a class="button button-primary" href="${esc(safeHttpUrl(d.link||d.product?.pricelens_url)) || '#'}" target="_blank" rel="noopener noreferrer">عرض المنتج ↗</a></div><p class="form-footnote">آخر رصد: ${esc(dateLabel(d.last_seen))} · <a href="https://pricelens.store" target="_blank" rel="noopener noreferrer">Prices by PriceLens</a></p></article>`).join('');
  }catch(e){$('dealsGrid').innerHTML=`<div class="empty-state wide"><h3>تعذر تحميل العروض</h3><p>${esc(e.message)}</p></div>`;}
}
async function compareProduct() {
  const query=$('compareProductQuery').value.trim(); const quote=Number($('compareYourPrice').value);
  if(query.length<2){toast('اكتب اسم المنتج أولًا.','error');return;}
  $('compareOutput').innerHTML='<div class="skeleton"></div>';
  try{
    const result=await api(`/api/market/search?q=${encodeURIComponent(query)}`);
    const products=result.products||[];
    const offers=products.flatMap(p=>(p.offers||[]).map(o=>({...o,product:p.title}))).sort((a,b)=>a.price-b.price);
    if(!offers.length){
      const communityPayload={kind:'product',item_name:query,category:$('compareProductCategory').value,governorate:$('compareProductGovernorate').value,price:quote};
      if (quote > 0 && communityPayload.category && communityPayload.governorate) {
        const community=await api('/api/compare/contributions',{method:'POST',body:JSON.stringify(communityPayload)});
        if(community.status==='enough-data'){
          const verdict={below:['أقل من نطاق التجارب','good'],above:['أعلى من نطاق التجارب','bad'],within:['داخل نطاق التجارب','neutral']}[community.verdict];
          $('compareOutput').innerHTML=`<div class="result-summary"><div class="result-verdict ${verdict[1]}">${verdict[0]}</div><div class="result-metric">${money(quote)}</div><div class="result-meta">وسيط ${money(community.median)} · ${community.sampleSize} أسعار منتجات معتمدة في ${esc(communityPayload.governorate)}</div></div><p class="form-footnote">المقارنة مبنية على تجارب المجتمع المطابقة للاسم والقسم والمحافظة خلال آخر 180 يومًا، وليست عروض متاجر مباشرة.</p>`;
          return;
        }
      }
      $('compareOutput').innerHTML=`<div class="empty-state"><div>⇄</div><h3>لا توجد عروض أو تجارب كافية للمقارنة</h3><p>${esc(result.message||'اربط مصدر الأسعار أو اجمع خمس تجارب معتمدة مطابقة.')} </p><p class="form-footnote">للمقارنة بتجارب المجتمع، اختر القسم والمحافظة وأدخل السعر المعروض.</p>${(result.storeLinks||[]).map(x=>`<a class="external-link" target="_blank" rel="noopener noreferrer" href="${esc(x.url)}">${esc(x.name)} ↗</a>`).join('')}</div>`;return;
    }
    const low=offers[0], high=offers.at(-1), avg=offers.reduce((s,x)=>s+x.price,0)/offers.length;
    const quoteText=quote>0?`<div class="result-summary" style="margin-top:12px"><div class="result-verdict ${quote>low.price?'neutral':'good'}">${quote>low.price?'عرضك أعلى من أقل عرض مرصود':'عرضك يساوي أو يقل عن أقل عرض مرصود'}</div><div class="result-metric">${money(quote)}</div><div class="result-meta">الفرق عن أقل عرض: ${money(Math.abs(quote-low.price))}</div></div>`:'';
    $('compareOutput').innerHTML=`<div class="result-summary"><div class="result-verdict good">أقل عرض مرصود</div><div class="result-metric">${money(low.price)}</div><div class="result-meta">${esc(low.retailer)} · ${offers.length} عروض · متوسطها ${money(avg)}</div></div>${quoteText}<div style="overflow:auto;margin-top:15px"><table class="offer-table"><thead><tr><th>المتجر</th><th>السعر</th><th>البائع</th><th>المصدر</th></tr></thead><tbody>${offers.map(o=>`<tr><td>${esc(o.retailer)}</td><td><strong>${money(o.price)}</strong></td><td>${esc(o.seller||'—')}</td><td>${o.link?`<a href="${esc(safeHttpUrl(o.link))}" target="_blank" rel="noopener noreferrer">فتح ↗</a>`:'—'}</td></tr>`).join('')}</tbody></table></div><p class="form-footnote">الأسعار بواسطة <a href="https://pricelens.store" target="_blank" rel="noopener noreferrer">PriceLens</a>. السعر والمخزون قابلان للتغير؛ قارن الشحن والضمان والبائع قبل الدفع.</p>`;
    STATE.results=products; addRecent(query,'product');
  }catch(e){$('compareOutput').innerHTML=`<div class="empty-state"><h3>تعذرت المقارنة</h3><p>${esc(e.message)}</p></div>`;}
}
async function compareService() {
  const payload={item_name:$('serviceName').value.trim(),category:$('serviceCategory').value,governorate:$('serviceGovernorate').value,price:Number($('serviceQuote').value)};
  if(!payload.item_name||!payload.category||!payload.governorate||!payload.price){toast('أكمل اسم الخدمة والقسم والمحافظة والسعر.','error');return;}
  $('compareOutput').innerHTML='<div class="skeleton"></div>';
  try{
    const data=await api('/api/compare/contributions',{method:'POST',body:JSON.stringify({...payload,kind:'service'})});
    if(data.status==='insufficient-data'){$('compareOutput').innerHTML=`<div class="result-summary"><div class="result-verdict neutral">لا توجد بيانات كافية للحكم</div><div class="result-metric">${data.sampleSize} / ${data.required}</div><div class="result-meta">تجارب معتمدة مطلوبة قبل المقارنة</div><p class="form-footnote">${esc(data.message)}</p></div><button class="button button-primary full-button" data-view="contribute">شارك تجربة حقيقية</button>`;return;}
    const verdict={below:['أقل من النطاق المسجل','good'],above:['أعلى من النطاق المسجل','bad'],within:['داخل النطاق المسجل','neutral']}[data.verdict];
    $('compareOutput').innerHTML=`<div class="result-summary"><div class="result-verdict ${verdict[1]}">${verdict[0]}</div><div class="result-metric">${money(data.submitted)}</div><div class="result-meta">وسيط التجارب ${money(data.median)} · ${data.sampleSize} تجربة معتمدة</div><div class="result-bars"><div class="result-bar-row"><span>أقل 20%</span><div class="bar-track"><span style="width:30%"></span></div><strong>${money(data.low)}</strong></div><div class="result-bar-row"><span>الوسيط</span><div class="bar-track"><span style="width:65%"></span></div><strong>${money(data.median)}</strong></div><div class="result-bar-row"><span>أعلى 20%</span><div class="bar-track"><span style="width:100%"></span></div><strong>${money(data.high)}</strong></div></div></div><p class="form-footnote">هذه مقارنة إحصائية وليست حكمًا نهائيًا؛ نوع القطع والضمان والمنطقة وتفاصيل الخدمة قد تؤثر على السعر.</p>`;
  }catch(e){$('compareOutput').innerHTML=`<div class="empty-state"><h3>تعذرت المقارنة</h3><p>${esc(e.message)}</p></div>`;}
}
async function submitContribution(event) {
  event.preventDefault();
  const payload={userKey:userKey(),kind:STATE.contributionKind,item_name:$('contributionName').value.trim(),category:$('contributionCategory').value,brand:$('contributionBrand').value.trim(),governorate:$('contributionGovernorate').value,city:$('contributionCity').value.trim(),price:Number($('contributionPrice').value),date_paid:$('contributionDate').value,seller_name:$('contributionSeller').value.trim(),rating:Number($('contributionRating').value),note:$('contributionNote').value.trim(),source_type:'personal_experience'};
  if(!$('contributionTruth').checked||!$('contributionPrivacy').checked){toast('أكد صحة التجربة ومراعاة الخصوصية.','error');return;}
  try{
    const result=await api('/api/contributions',{method:'POST',body:JSON.stringify(payload)});
    toast(result.message||'تم إرسال المساهمة.','success'); $('contributionForm').reset(); $('contributionDate').value=new Date().toISOString().slice(0,10); $('contributionKind').querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b.dataset.kind==='product')); STATE.contributionKind='product'; $('contributionCategory').innerHTML=categoryOptions('product'); go('account');
  }catch(e){toast(e.message,'error');}
}
function setAuthMessage(message = '', type = '') {
  const node = $('authStatus');
  if (!node) return;
  node.textContent = message;
  node.className = `auth-status ${type}`.trim();
}
function renderAuth() {
  const user = STATE.authUser;
  const signIn = $('googleSignInButton');
  const signOut = $('googleSignOutButton');
  const avatar = $('authAvatar');
  if (user) {
    $('authHeading').textContent = `${uiText('أنت مسجل الدخول')} · ${user.name || user.email}`;
    $('authDescription').textContent = user.email;
    $('authPrivacyNote').textContent = uiText('سيتم استخدام الاسم والبريد والصورة العامة من حساب Google فقط. لا نطلب صلاحية قراءة رسائل Gmail.');
    if (user.picture && safeHttpUrl(user.picture)) avatar.innerHTML = `<img src="${esc(safeHttpUrl(user.picture))}" alt="" referrerpolicy="no-referrer">`;
    else avatar.textContent = (user.name || user.email || 'K').trim().charAt(0).toUpperCase();
    signIn.hidden = true;
    signOut.hidden = false;
    $('accountIdentifier').textContent = user.email;
    setAuthMessage('', '');
  } else {
    $('authHeading').textContent = uiText('الدخول بحساب Google');
    $('authDescription').textContent = uiText('سجّل الدخول لمزامنة مساهماتك عبر أجهزتك.');
    $('authPrivacyNote').textContent = uiText('سيتم استخدام الاسم والبريد والصورة العامة من حساب Google فقط. لا نطلب صلاحية قراءة رسائل Gmail.');
    avatar.textContent = 'K';
    signIn.hidden = false;
    signIn.setAttribute('aria-disabled', STATE.googleConfigured ? 'false' : 'true');
    signIn.title = STATE.googleConfigured ? uiText('المتابعة باستخدام Google') : uiText('إعداد تسجيل Google غير مكتمل على السيرفر.');
    $('googleSignInText').textContent = STATE.googleConfigured ? uiText('المتابعة باستخدام Google') : uiText('إعداد تسجيل Google غير مكتمل على السيرفر.');
    signOut.hidden = true;
    $('accountIdentifier').textContent = `${uiText('مستخدم')} ${userKey().slice(-6)}`;
    if (!STATE.googleConfigured) setAuthMessage(uiText('إعداد تسجيل Google غير مكتمل على السيرفر.'), 'error');
    else setAuthMessage('', '');
  }
}
async function loadAuthStatus() {
  try {
    const response = await fetch('/api/auth/me', { credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Auth status unavailable');
    STATE.authUser = data.authenticated ? data.user : null;
    STATE.googleConfigured = Boolean(data.googleConfigured);
    renderAuth();
  } catch (error) {
    STATE.authUser = null;
    STATE.googleConfigured = false;
    renderAuth();
    setAuthMessage(uiText('تعذر التحقق من جلسة تسجيل الدخول.'), 'error');
  }
}
async function logoutGoogle() {
  try {
    const response = await fetch('/auth/logout', { method:'POST', credentials:'same-origin', headers:{'content-type':'application/json'} });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || uiText('تعذر تسجيل الخروج.'));
    STATE.authUser = null;
    await loadAuthStatus();
    setAuthMessage(uiText('تم تسجيل الخروج.'), 'success');
    await loadAccount();
  } catch (error) { setAuthMessage(error.message, 'error'); }
}
function handleAuthRedirect() {
  const url = new URL(location.href);
  const auth = url.searchParams.get('auth');
  if (!auth) return;
  const messages = {
    success:['تم تسجيل الدخول بنجاح.','success'],
    failed:['تعذر تسجيل الدخول باستخدام Google. راجع إعدادات OAuth ثم حاول مجددًا.','error'],
    'not-configured':['إعداد تسجيل Google غير مكتمل على السيرفر.','error']
  };
  if (messages[auth]) setTimeout(() => setAuthMessage(uiText(messages[auth][0]), messages[auth][1]), 0);
  url.searchParams.delete('auth');
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

async function loadAccount() {
  $('accountIdentifier').textContent=STATE.authUser?.email || `${uiText('مستخدم')} ${userKey().slice(-6)}`;
  $('myContributions').innerHTML='<div class="skeleton"></div>';
  try{
    const data=await api('/api/contributions?mine=1'); const rows=data.contributions||[];
    const pending=rows.filter(x=>x.status==='pending').length, approved=rows.filter(x=>x.status==='approved').length, rejected=rows.filter(x=>x.status==='rejected').length;
    $('accountStats').innerHTML=[['إجمالي المساهمات',rows.length],['بانتظار المراجعة',pending],['معتمدة',approved]].map(([l,v])=>`<div class="account-stat"><small>${l}</small><strong>${v}</strong></div>`).join('');
    $('myContributions').innerHTML=rows.length?`<table class="data-table"><thead><tr><th>المنتج / الخدمة</th><th>المحافظة</th><th>السعر</th><th>التاريخ</th><th>الحالة</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.item_name)}</td><td>${esc(x.governorate)}</td><td>${money(x.price)}</td><td>${esc(x.date_paid)}</td><td class="status-${esc(x.status)}">${x.status==='approved'?'معتمدة':x.status==='rejected'?'مرفوضة':'قيد المراجعة'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state"><div>▤</div><h3>لا توجد مساهمات بعد</h3><p>شارك أول تجربة سعر وسنضيفها إلى سجلك.</p><button class="button button-quiet" data-view="contribute">أضف أول سعر</button></div>';
  }catch(e){$('myContributions').innerHTML=`<div class="empty-state"><h3>تعذر تحميل السجل</h3><p>${esc(e.message)}</p></div>`;}
}
async function loadAdminQueue() {
  $('adminAccess').hidden=Boolean(STATE.adminToken); $('adminPanel').hidden=!STATE.adminToken; $('adminQueue').innerHTML='<div class="skeleton"></div>';
  if(!STATE.adminToken)return;
  try{
    const data=await api('/api/admin/queue',{headers:{authorization:`Bearer ${STATE.adminToken}`}}); const rows=data.contributions||[];
    $('adminQueue').innerHTML=rows.length?rows.map(x=>`<div class="admin-queue-item"><div><strong>${esc(x.item_name)} — ${money(x.price)}</strong><p>${esc(x.governorate)} · ${esc(x.date_paid)} · ${esc(categoryById(x.category)?.name||x.category)} · ${esc(x.user_key||'')}</p><p>${esc(x.note||'لا توجد تفاصيل إضافية')}</p></div><div class="admin-queue-actions"><button class="button button-primary" data-moderate="approved" data-id="${esc(x.id)}">اعتماد</button><button class="button button-quiet" data-moderate="rejected" data-id="${esc(x.id)}">رفض</button></div></div>`).join(''):'<div class="empty-state"><h3>لا توجد مساهمات معلقة</h3><p>قائمة المراجعة فارغة حاليًا.</p></div>';
    $('adminQueue').querySelectorAll('[data-moderate]').forEach(b=>b.addEventListener('click',()=>moderateContribution(b.dataset.id,b.dataset.moderate)));
  }catch(e){$('adminPanel').hidden=true;$('adminAccess').hidden=false;toast(e.message,'error');}
}
async function moderateContribution(id,status) {
  try{await api(`/api/admin/contributions/${encodeURIComponent(id)}`,{method:'PATCH',headers:{authorization:`Bearer ${STATE.adminToken}`},body:JSON.stringify({status})});toast(status==='approved'?'تم اعتماد المساهمة.':'تم رفض المساهمة.','success');loadAdminQueue();}
  catch(e){toast(e.message,'error');}
}
async function shareCurrentSearch(title='بحث على كَم؟') {
  const url=location.origin+`/?q=${encodeURIComponent(title)}#explore`;
  const payload={title:'كَم؟ — مقارنة الأسعار',text:`شوف مقارنة ${title} على كَم؟`,url};
  try{if(navigator.share)await navigator.share(payload);else{await navigator.clipboard.writeText(`${payload.text}\n${url}`);toast('تم نسخ رابط المشاركة.','success');}}catch(e){if(e.name!=='AbortError')toast('تعذرت المشاركة من هذا المتصفح.');}
}
function initActions() {
  $('heroSearchButton').addEventListener('click',()=>{$('exploreSearch').value=$('heroSearch').value;$('exploreGovernorate').value=$('heroGovernorate').value;STATE.kind='all';setExploreKind('all');go('explore');runExplore();});
  $('heroSearch').addEventListener('keydown',e=>{if(e.key==='Enter')$('heroSearchButton').click();});
  document.querySelectorAll('[data-query]').forEach(b=>b.addEventListener('click',()=>{$('heroSearch').value=b.dataset.query;$('heroSearchButton').click();}));
  $('exploreGo').addEventListener('click',runExplore); $('exploreSearch').addEventListener('keydown',e=>{if(e.key==='Enter')runExplore();});
  ['exploreCategory','exploreGovernorate','exploreSort'].forEach(id=>$(id).addEventListener('change',()=>{updateActiveChips();if($('exploreSearch').value.trim())runExplore();}));
  $('filterToggle').addEventListener('click',()=>$('filterPanel').classList.toggle('open'));
  $('clearFilters').addEventListener('click',()=>{STATE.kind='all';setExploreKind('all');$('exploreCategory').value='all';$('exploreGovernorate').value='كل مصر';$('exploreSearch').value='';updateActiveChips();$('exploreResults').innerHTML='<div class="empty-state"><div>⌕</div><h3>اكتب اللي بتدور عليه</h3><p>ابدأ بحثًا جديدًا.</p></div>';});
  $('refreshDeals').addEventListener('click',loadDeals); $('compareProductButton').addEventListener('click',compareProduct); $('compareServiceButton').addEventListener('click',compareService);
  $('contributionForm').addEventListener('submit',submitContribution);
  $('adminLoad').addEventListener('click',()=>{const token=$('adminToken').value.trim();if(!token){toast('أدخل رمز الإدارة.','error');return;}STATE.adminToken=token;sessionStorage.setItem('kam_admin_token',token);loadAdminQueue();});
  $('adminRefresh').addEventListener('click',loadAdminQueue);
  $('googleSignOutButton').addEventListener('click',logoutGoogle);
  $('googleSignInButton').addEventListener('click', event => {
    if (!STATE.googleConfigured) { event.preventDefault(); setAuthMessage(uiText('إعداد تسجيل Google غير مكتمل على السيرفر.'), 'error'); }
  });
}

async function init() {
  window.KAM_I18N?.init();
  window.addEventListener('kam:languagechange', () => { renderAuth(); if (STATE.view === 'account') loadAccount(); });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  initNavigation(); initTheme(); initModal(); initSaved(); initActions();
  try {
    STATE.config=await api('/api/config');
  } catch(e) {
    toast('تعذر الاتصال بسيرفر كَم؟. شغّل server.mjs أولًا.','error');
    STATE.config={governorates:['القاهرة','الجيزة','الإسكندرية','الدقهلية','الغربية'],categories:[],stores:[]};
  }
  fillStaticSelects(); initCategories(); updateActiveChips();
  $('serviceCategory').value=STATE.config.categories.find(x=>x.kind==='service')?.id||'';
  await loadHealth();
  await loadAuthStatus();
  handleAuthRedirect();
  const sharedQuery = new URLSearchParams(location.search).get('q');
  if (sharedQuery) { $('exploreSearch').value = sharedQuery; go('explore',{push:false}); runExplore(); }
  if(location.hash==='#admin')go('admin',{push:false});
}

document.addEventListener('DOMContentLoaded',init);
