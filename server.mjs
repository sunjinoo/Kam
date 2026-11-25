import http from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual, createHmac, randomBytes, createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.KAM_DATA_DIR ? path.resolve(process.env.KAM_DATA_DIR) : path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'kam-data.json');
// Tiny .env reader keeps the project dependency-free. Existing process env wins.
try {
  const envText = await readFile(path.join(ROOT, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}
const PORT = Number(process.env.PORT || 4173);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `${PUBLIC_BASE_URL}/auth/google/callback`;
const SESSION_SECRET = process.env.KAM_SESSION_SECRET || '';
const GOOGLE_AUTH_ENABLED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && SESSION_SECRET.length >= 32);
const SESSION_COOKIE = 'kam_session';
const OAUTH_STATE_COOKIE = 'kam_oauth_state';
const PRICELENS_BASE = (process.env.PRICELENS_BASE_URL || 'https://pricelens.store/api/v1/partner').replace(/\/$/, '');
const PRICELENS_KEY = process.env.PRICELENS_API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_TOKEN = process.env.KAM_ADMIN_TOKEN || '';
const IS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);

const GOVERNORATES = [
  'القاهرة','الجيزة','الإسكندرية','الدقهلية','الشرقية','الغربية','المنوفية','القليوبية','البحيرة',
  'كفر الشيخ','دمياط','بورسعيد','الإسماعيلية','السويس','شمال سيناء','جنوب سيناء','الفيوم','بني سويف',
  'المنيا','أسيوط','سوهاج','قنا','الأقصر','أسوان','البحر الأحمر','الوادي الجديد','مطروح'
];

const CATEGORIES = [
  {id:'phones',name:'موبايلات وتابلت',kind:'product',icon:'📱'},
  {id:'computers',name:'كمبيوتر ولابتوب',kind:'product',icon:'💻'},
  {id:'electronics',name:'إلكترونيات وصوتيات',kind:'product',icon:'🎧'},
  {id:'home-appliances',name:'أجهزة منزلية',kind:'product',icon:'🧺'},
  {id:'fashion',name:'ملابس وأحذية',kind:'product',icon:'👟'},
  {id:'beauty',name:'جمال وعناية شخصية',kind:'product',icon:'🧴'},
  {id:'grocery',name:'سوبر ماركت وبقالة',kind:'product',icon:'🛒'},
  {id:'furniture',name:'أثاث وديكور',kind:'product',icon:'🛋️'},
  {id:'home-tools',name:'أدوات ومستلزمات منزلية',kind:'product',icon:'🪛'},
  {id:'baby',name:'أطفال ورضّع',kind:'product',icon:'🧸'},
  {id:'sports',name:'رياضة ولياقة',kind:'product',icon:'⚽'},
  {id:'books',name:'كتب وأدوات مكتبية',kind:'product',icon:'📚'},
  {id:'automotive',name:'سيارات وقطع غيار',kind:'product',icon:'🚗'},
  {id:'pets',name:'مستلزمات الحيوانات',kind:'product',icon:'🐾'},
  {id:'other-products',name:'منتجات أخرى',kind:'product',icon:'📦'},
  {id:'device-repair',name:'صيانة أجهزة وموبايلات',kind:'service',icon:'🧰'},
  {id:'home-maintenance',name:'صيانة منزلية',kind:'service',icon:'🔧'},
  {id:'automotive-service',name:'صيانة سيارات',kind:'service',icon:'🛠️'},
  {id:'cleaning',name:'تنظيف ونقل',kind:'service',icon:'🧹'},
  {id:'beauty-service',name:'صالونات وعناية',kind:'service',icon:'💇'},
  {id:'education',name:'دروس وتعليم',kind:'service',icon:'🎓'},
  {id:'events',name:'تصوير ومناسبات',kind:'service',icon:'📸'},
  {id:'other-services',name:'خدمات أخرى',kind:'service',icon:'🧾'}
];

const STORES = [
  {id:'amazon',name:'Amazon.eg',url:'https://www.amazon.eg/',mode:'aggregator',note:'عبر مزوّد الأسعار عند تفعيله'},
  {id:'noon',name:'Noon',url:'https://www.noon.com/egypt-en/',mode:'aggregator',note:'عبر مزوّد الأسعار عند تفعيله'},
  {id:'jumia',name:'Jumia',url:'https://www.jumia.com.eg/',mode:'aggregator',note:'عبر مزوّد الأسعار عند تفعيله'},
  {id:'btech',name:'B.TECH',url:'https://www.btech.com/',mode:'aggregator',note:'عبر مزوّد الأسعار عند تفعيله'},
  {id:'2b',name:'2B',url:'https://2b.com.eg/',mode:'aggregator',note:'حسب تغطية المزوّد'},
  {id:'raya',name:'Raya Shop',url:'https://www.rayashop.com/',mode:'aggregator',note:'حسب تغطية المزوّد'},
  {id:'carrefour',name:'Carrefour',url:'https://www.carrefouregypt.com/',mode:'aggregator',note:'حسب تغطية المزوّد'},
  {id:'ikea',name:'IKEA Egypt',url:'https://www.ikea.com/eg/en/',mode:'aggregator',note:'حسب تغطية المزوّد'},
  {id:'homzmart',name:'Homzmart',url:'https://homzmart.com/',mode:'aggregator',note:'حسب تغطية المزوّد'},
  {id:'dubizzle',name:'Dubizzle',url:'https://www.dubizzle.com.eg/',mode:'search-link',note:'إعلانات مستعمل؛ لا توجد تغذية أسعار حيّة مفعّلة'},
  {id:'marketplace',name:'Facebook Marketplace',url:'https://www.facebook.com/marketplace/',mode:'search-link',note:'رابط خارجي فقط'}
];

let localData = { contributions: [] };
let cache = new Map();
const rate = new Map();
let googleJwksCache = { keys: [], expires: 0 };

async function loadLocalData() {
  await mkdir(DATA_DIR, { recursive: true });
  try { localData = JSON.parse(await readFile(DATA_FILE, 'utf8')); }
  catch { await persistLocal(); }
  if (!Array.isArray(localData.contributions)) localData.contributions = [];
}
async function persistLocal() {
  await mkdir(DATA_DIR, { recursive: true });
  const temp = DATA_FILE + '.tmp';
  await writeFile(temp, JSON.stringify(localData, null, 2), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(temp, DATA_FILE);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'x-frame-options':'DENY',
    'referrer-policy':'strict-origin-when-cross-origin',
    'content-security-policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'content-length':Buffer.byteLength(body)
  });
  res.end(body);
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function base64url(value) { return Buffer.from(value).toString('base64url'); }
function signedPayload(payload) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}
function readSignedPayload(value) {
  if (!SESSION_SECRET || !value) return null;
  const parts = String(value).split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const expected = createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload || !Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { out[name] = decodeURIComponent(value); } catch { out[name] = value; }
  }
  return out;
}
function cookieString(name, value, maxAge) {
  const secure = PUBLIC_BASE_URL.startsWith('https://') || process.env.NODE_ENV === 'production';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function clearCookieString(name) { return cookieString(name, '', 0); }
function appendCookie(res, cookie) {
  const previous = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', previous ? [...(Array.isArray(previous) ? previous : [previous]), cookie] : cookie);
}
function getSession(req) {
  const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
  const payload = readSignedPayload(token);
  if (!payload?.sub || !payload?.email) return null;
  return payload;
}
function requestUserKey(req, fallback = '') {
  const session = getSession(req);
  if (session) return `google:${cleanText(session.sub, 180)}`;
  return cleanText(fallback || req.headers['x-kam-user'], 80);
}
async function googleJwks() {
  if (googleJwksCache.expires > Date.now() && googleJwksCache.keys.length) return googleJwksCache.keys;
  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Google signing keys unavailable (${response.status})`);
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new Error('Invalid Google signing key response');
  googleJwksCache = { keys: body.keys, expires: Date.now() + 50 * 60_000 };
  return body.keys;
}
async function verifyGoogleIdToken(token, expectedNonce) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid Google ID token');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Google ID token signature');
  let jwk = (await googleJwks()).find(key => key.kid === header.kid && key.use === 'sig');
  if (!jwk) { googleJwksCache.expires = 0; jwk = (await googleJwks()).find(key => key.kid === header.kid && key.use === 'sig'); }
  if (!jwk) throw new Error('Google signing key not found');
  const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  const verified = verifySignature('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedPayload}`), publicKey, Buffer.from(encodedSignature, 'base64url'));
  if (!verified) throw new Error('Google ID token signature verification failed');
  const now = Math.floor(Date.now() / 1000);
  const issuerOK = ['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss);
  const audienceOK = claims.aud === GOOGLE_CLIENT_ID || (Array.isArray(claims.aud) && claims.aud.includes(GOOGLE_CLIENT_ID));
  if (!issuerOK || !audienceOK || !claims.sub || !claims.exp || claims.exp <= now || (claims.iat && claims.iat > now + 60)) throw new Error('Google ID token claims are invalid');
  if (claims.nonce !== expectedNonce) throw new Error('Google OAuth nonce mismatch');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('Google account email is not verified');
  if (!claims.email || !String(claims.email).includes('@')) throw new Error('Google account email is missing');
  return claims;
}
function redirect(res, location, cookies = []) {
  const headers = { location, 'cache-control': 'no-store' };
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(302, headers); res.end();
}
async function handleAuthRoute(req, res, url) {
  if (url.pathname === '/auth/google' && req.method === 'GET') {
    if (!GOOGLE_AUTH_ENABLED) { redirect(res, `${PUBLIC_BASE_URL}/?auth=not-configured#account`); return true; }
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const statePayload = signedPayload({ state, nonce, verifier, exp: Math.floor(Date.now()/1000) + 600 });
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, redirect_uri: GOOGLE_REDIRECT_URI, response_type: 'code',
      scope: 'openid email profile', state, nonce, code_challenge: challenge,
      code_challenge_method: 'S256', prompt: 'select_account'
    }).toString();
    redirect(res, auth.href, [cookieString(OAUTH_STATE_COOKIE, statePayload, 600)]); return true;
  }
  if (url.pathname === '/auth/google/callback' && req.method === 'GET') {
    const clearState = clearCookieString(OAUTH_STATE_COOKIE);
    if (!GOOGLE_AUTH_ENABLED) { redirect(res, `${PUBLIC_BASE_URL}/?auth=not-configured#account`, [clearState]); return true; }
    try {
      const cookies = parseCookies(req.headers.cookie || '');
      const stateData = readSignedPayload(cookies[OAUTH_STATE_COOKIE]);
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      if (!stateData || !state || !safeEqual(state, stateData.state) || !code) throw new Error('Invalid or expired Google OAuth state');
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: GOOGLE_REDIRECT_URI, grant_type: 'authorization_code', code_verifier: stateData.verifier }),
        signal: AbortSignal.timeout(15_000)
      });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.id_token) throw new Error(tokens.error_description || tokens.error || 'Google token exchange failed');
      const claims = await verifyGoogleIdToken(tokens.id_token, stateData.nonce);
      const session = { sub: String(claims.sub), email: String(claims.email), name: cleanText(claims.name || claims.given_name || claims.email, 120), picture: /^https:\/\//.test(claims.picture || '') ? claims.picture : '', exp: Math.floor(Date.now()/1000) + 7*24*60*60 };
      redirect(res, `${PUBLIC_BASE_URL}/?auth=success#account`, [clearState, cookieString(SESSION_COOKIE, signedPayload(session), 7*24*60*60)]);
    } catch (error) {
      console.error('Google sign-in failed:', error.message);
      redirect(res, `${PUBLIC_BASE_URL}/?auth=failed#account`, [clearState]);
    }
    return true;
  }
  if (url.pathname === '/auth/logout' && req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin && origin !== new URL(PUBLIC_BASE_URL).origin) { json(res, 403, { error: 'Invalid request origin.' }); return true; }
    const body = JSON.stringify({ ok: true });
    res.writeHead(200, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'set-cookie':clearCookieString(SESSION_COOKIE) });
    res.end(body);
    return true;
  }
  return false;
}
function adminAllowed(req) {
  if (!ADMIN_TOKEN) return false;
  return safeEqual((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), ADMIN_TOKEN);
}
function cleanText(value, max = 180) {
  return String(value ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, max);
}
function parseBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '', size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('حجم الطلب أكبر من المسموح.')); req.destroy(); return; }
      data += chunk.toString('utf8');
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('صيغة JSON غير صحيحة.')); }
    });
    req.on('error', reject);
  });
}
function limited(req, res) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const item = rate.get(key) || { count:0, reset:now + 60_000 };
  if (now > item.reset) { item.count = 0; item.reset = now + 60_000; }
  item.count += 1; rate.set(key, item);
  if (item.count > 100) { json(res, 429, {error:'طلبات كثيرة. حاول بعد دقيقة.'}); return true; }
  return false;
}

async function supabaseRequest(table, method = 'GET', query = '', body = undefined, prefer = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const headers = {
    apikey:SUPABASE_KEY,
    authorization:`Bearer ${SUPABASE_KEY}`,
    'content-type':'application/json'
  };
  if (prefer) headers.prefer = prefer;
  const resp = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(12_000) });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Database request failed (${resp.status}): ${text.slice(0, 250)}`);
  return text ? JSON.parse(text) : null;
}
async function getContributions({status = null, userKey = null} = {}) {
  if (IS_SUPABASE) {
    const filters = ['select=*', 'order=created_at.desc', 'limit=1000'];
    if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
    if (userKey) filters.push(`user_key=eq.${encodeURIComponent(userKey)}`);
    return await supabaseRequest('kam_contributions', 'GET', filters.join('&'));
  }
  return localData.contributions
    .filter(x => !status || x.status === status)
    .filter(x => !userKey || x.user_key === userKey)
    .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
}
async function insertContribution(item) {
  if (IS_SUPABASE) {
    const rows = await supabaseRequest('kam_contributions', 'POST', 'select=*', item, 'return=representation');
    return rows?.[0] || item;
  }
  localData.contributions.unshift(item); await persistLocal(); return item;
}
async function updateContribution(id, patch) {
  if (IS_SUPABASE) {
    const rows = await supabaseRequest('kam_contributions', 'PATCH', `id=eq.${encodeURIComponent(id)}&select=*`, patch, 'return=representation');
    return rows?.[0] || null;
  }
  const item = localData.contributions.find(x => x.id === id);
  if (!item) return null;
  Object.assign(item, patch); await persistLocal(); return item;
}

async function priceLens(pathname, params = {}) {
  if (!PRICELENS_KEY) throw Object.assign(new Error('مفتاح مزود الأسعار غير مضبوط على السيرفر.'), {code:'PROVIDER_NOT_CONFIGURED'});
  const url = new URL(`${PRICELENS_BASE}${pathname}`);
  for (const [k,v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const resp = await fetch(url, {
    headers:{ authorization:`Bearer ${PRICELENS_KEY}`, accept:'application/json' },
    signal:AbortSignal.timeout(15_000)
  });
  const text = await resp.text();
  if (!resp.ok) throw Object.assign(new Error(`مزود الأسعار أعاد ${resp.status}: ${text.slice(0, 180)}`), {code:'PROVIDER_ERROR',status:resp.status});
  try { return JSON.parse(text); } catch { throw new Error('استجابة مزود الأسعار ليست JSON صالحًا.'); }
}
function listFrom(data, keys = ['products','results','items','data']) {
  if (Array.isArray(data)) return data;
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.data?.products)) return data.data.products;
  return [];
}
function normalizeOffer(o, product = {}) {
  const p = Number(o.price ?? o.current_price ?? o.amount);
  if (!Number.isFinite(p) || p <= 0) return null;
  return {
    id:String(o.listing_id || o.id || randomUUID()),
    retailer:cleanText(o.retailer || o.store || o.merchant || 'متجر', 80),
    seller:cleanText(o.seller || o.seller_name || '', 100),
    price:p,
    currency:cleanText(o.currency || 'EGP', 8),
    in_stock:o.in_stock ?? o.available ?? null,
    last_seen:o.last_seen || o.observed_at || o.updated_at || null,
    link:o.link || o.store_url || o.url || product.pricelens_url || null,
    product_url:o.store_url || null,
    image:product.image_url || o.image_url || null,
    condition:cleanText(o.condition || 'جديد', 30),
    shipping:o.shipping ?? null,
    warranty:o.warranty ?? null,
    source:'PriceLens',
    verified_source:true
  };
}
async function liveProductSearch(query, {category = '', limit = 8} = {}) {
  const key = `search:${query}:${category}:${limit}`;
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  const searchData = await priceLens('/search', { q:query });
  const products = listFrom(searchData).slice(0, Math.min(limit, 8));
  const normalized = await Promise.all(products.map(async p => {
    const id = p.id || p.product_id;
    if (!id) return null;
    try {
      const market = await priceLens(`/products/${encodeURIComponent(id)}/market`, { days:90 });
      const offersRaw = listFrom(market, ['offers','listings','results','data']);
      if (!offersRaw.length && Array.isArray(market?.data?.offers)) offersRaw.push(...market.data.offers);
      if (!offersRaw.length && Array.isArray(market?.market?.offers)) offersRaw.push(...market.market.offers);
      const product = market.product || p;
      const offers = offersRaw.map(o => normalizeOffer(o, product)).filter(Boolean).sort((a,b)=>a.price-b.price);
      return {
        id:String(id), title:cleanText(product.title_ar || product.title || p.title || p.name || 'منتج', 200),
        brand:cleanText(product.brand || p.brand || '', 80), category:cleanText(product.category || category || '', 80),
        image:product.image_url || p.image_url || null, productUrl:product.pricelens_url || p.pricelens_url || null,
        median:Number(market.median || market.market?.median || 0) || null,
        history:market.history || market.price_history || [], offers
      };
    } catch (err) {
      return { id:String(id), title:cleanText(p.title_ar || p.title || p.name || 'منتج', 200), offers:[], warning:err.message };
    }
  }));
  const result = { mode:'live', provider:'PriceLens', query, generatedAt:searchData.generated_at || new Date().toISOString(), products:normalized.filter(Boolean), stores:STORES };
  cache.set(key, {until:Date.now()+180_000, value:result});
  return result;
}

function googleSiteSearch(domain, query) {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:${domain} ${query}`)}`;
}
function fallbackStoreLinks(query) {
  return [
    {id:'amazon',name:'Amazon.eg',url:`https://www.amazon.eg/s?k=${encodeURIComponent(query)}`,kind:'product-search'},
    {id:'noon',name:'Noon',url:`https://www.noon.com/egypt-en/search/?q=${encodeURIComponent(query)}`,kind:'product-search'},
    {id:'jumia',name:'Jumia',url:`https://www.jumia.com.eg/catalog/?q=${encodeURIComponent(query)}`,kind:'product-search'},
    {id:'btech',name:'B.TECH',url:googleSiteSearch('btech.com',query),kind:'external-search'},
    {id:'dubizzle',name:'Dubizzle — مستعمل',url:googleSiteSearch('dubizzle.com.eg',query),kind:'classified-search'},
    {id:'facebook',name:'Facebook Marketplace',url:`https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(query)}`,kind:'classified-search'}
  ];
}

async function handleApi(req, res, url) {
  if (limited(req, res)) return;
  const p = url.pathname;
  if (p === '/api/auth/me' && req.method === 'GET') {
    const session = getSession(req);
    json(res, 200, { authenticated: Boolean(session), googleConfigured: GOOGLE_AUTH_ENABLED,
      user: session ? { id: session.sub, email: session.email, name: session.name, picture: session.picture } : null }); return;
  }
  if (p === '/api/health' && req.method === 'GET') {
    json(res, 200, {
      ok:true, version:'2.1.1', time:new Date().toISOString(),
      database:IS_SUPABASE?'supabase-postgres':'local-json',
      integrations:{ pricelens:{configured:Boolean(PRICELENS_KEY),type:'aggregator'},
        amazon:{configuredThroughAggregator:Boolean(PRICELENS_KEY),mode:PRICELENS_KEY?'via-aggregator-coverage-varies':'not-directly-connected'},
        noon:{configuredThroughAggregator:Boolean(PRICELENS_KEY),mode:PRICELENS_KEY?'via-aggregator-coverage-varies':'not-directly-connected'},
        dubizzle:{available:false,mode:'public-search-link-only'} },
      adminConfigured:Boolean(ADMIN_TOKEN)
    }); return;
  }
  if (p === '/api/config' && req.method === 'GET') {
    json(res,200,{governorates:GOVERNORATES,categories:CATEGORIES,stores:STORES,features:['marketplace-search','service-prices','quote-analysis','price-alerts-client','favorites-client','community-contributions','moderation','shareable-search','recent-searches']}); return;
  }
  if (p === '/api/market/search' && req.method === 'GET') {
    const q = cleanText(url.searchParams.get('q'),150);
    if (q.length < 2) { json(res,400,{error:'اكتب كلمتين على الأقل للبحث.'}); return; }
    try { json(res,200,await liveProductSearch(q,{category:cleanText(url.searchParams.get('category'),80)})); }
    catch (e) {
      if (e.code === 'PROVIDER_NOT_CONFIGURED') json(res,200,{mode:'not_configured',provider:null,query:q,products:[],storeLinks:fallbackStoreLinks(q),message:'أضف PRICELENS_API_KEY إلى إعدادات السيرفر لتفعيل الأسعار الحية.'});
      else json(res,502,{mode:'provider_error',query:q,error:'تعذر جلب الأسعار الحية حاليًا.',details:process.env.NODE_ENV==='development'?e.message:undefined,storeLinks:fallbackStoreLinks(q)});
    } return;
  }
  if (p === '/api/market/deals' && req.method === 'GET') {
    try {
      const data = await priceLens('/deals',{basis:'verified',max_age_hours:72,limit:30});
      json(res,200,{mode:'live',deals:listFrom(data,['deals','results','data']),generatedAt:data.generated_at || new Date().toISOString()});
    } catch (e) { json(res,e.code==='PROVIDER_NOT_CONFIGURED'?200:502,{mode:'not_configured',deals:[],message:'عروض التخفيضات الحقيقية تحتاج مفتاح مزود الأسعار.'}); }
    return;
  }
  if (p === '/api/market/stores' && req.method === 'GET') {
    try { const data = await priceLens('/stores'); json(res,200,{mode:'live',stores:listFrom(data,['stores','results','data'])}); }
    catch { json(res,200,{mode:'not_configured',stores:STORES}); }
    return;
  }
  if (p === '/api/contributions' && req.method === 'GET') {
    const mine = url.searchParams.get('mine') === '1';
    const userKey = requestUserKey(req);
    const kind = cleanText(url.searchParams.get('kind'),20);
    const category = cleanText(url.searchParams.get('category'),80);
    const governorate = cleanText(url.searchParams.get('governorate'),80);
    const q = cleanText(url.searchParams.get('q'),150).toLowerCase();
    try {
      let rows = await getContributions({status:mine?null:'approved',userKey:mine?userKey:null});
      rows = rows.filter(row => (!kind || row.kind === kind) && (!category || row.category === category) && (!governorate || governorate === 'كل مصر' || row.governorate === governorate) && (!q || String(row.item_name || '').toLowerCase().includes(q) || String(row.brand || '').toLowerCase().includes(q) || String(row.model || '').toLowerCase().includes(q)));
      json(res,200,{contributions:rows.map(row=>{const owner=mine && row.user_key===userKey; const {user_key,...safe}=row; return {...safe,owner:mine?owner:undefined};})});
    } catch (e) { json(res,500,{error:'تعذر قراءة المساهمات.',details:process.env.NODE_ENV==='development'?e.message:undefined}); }
    return;
  }
  if (p === '/api/contributions' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      const userKey = requestUserKey(req, b.userKey || req.headers['x-kam-user']);
      const amount = Number(b.price);
      const date = String(b.date_paid || '');
      const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : new Date(NaN);
      const validDate = Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0,10) === date;
      if (!userKey || userKey.length < 8) { json(res,400,{error:'معرّف المستخدم غير صالح. حدّث الصفحة وحاول مجددًا.'}); return; }
      if (!['product','service'].includes(b.kind)) { json(res,400,{error:'نوع المساهمة غير صالح.'}); return; }
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) { json(res,400,{error:'أدخل مبلغًا صحيحًا.'}); return; }
      if (!validDate || date > new Date().toISOString().slice(0,10)) { json(res,400,{error:'تاريخ الشراء غير صالح.'}); return; }
      const item = {
        id:randomUUID(), user_key:userKey, kind:b.kind, category:cleanText(b.category,80),
        item_name:cleanText(b.item_name,180), brand:cleanText(b.brand,80), model:cleanText(b.model,100),
        variant:cleanText(b.variant,100), governorate:cleanText(b.governorate,80), city:cleanText(b.city,100),
        price:amount, currency:'EGP', date_paid:date, seller_name:cleanText(b.seller_name,100),
        source_type:cleanText(b.source_type || 'personal_experience',40), source_url:cleanText(b.source_url,500),
        note:cleanText(b.note,600), rating:Math.max(1,Math.min(5,Number(b.rating)||3)),
        proof_status:b.proof_url?'link_provided':'not_provided', status:'pending',
        created_at:new Date().toISOString(), moderated_at:null
      };
      if (!item.item_name || !item.category || !item.governorate) { json(res,400,{error:'أكمل اسم المنتج/الخدمة والتصنيف والمحافظة.'}); return; }
      if (!CATEGORIES.some(c => c.id === item.category && c.kind === item.kind)) { json(res,400,{error:'التصنيف لا يطابق نوع المساهمة.'}); return; }
      if (!GOVERNORATES.includes(item.governorate)) { json(res,400,{error:'اختر محافظة مصرية صحيحة.'}); return; }
      const saved = await insertContribution(item);
      json(res,201,{ok:true,contribution:{id:saved.id,status:saved.status,created_at:saved.created_at},message:'وصلت المساهمة إلى قائمة المراجعة.'});
    } catch (e) { json(res,500,{error:'تعذر حفظ المساهمة.',details:process.env.NODE_ENV==='development'?e.message:undefined}); }
    return;
  }
  if ((p === '/api/compare/service' || p === '/api/compare/contributions') && req.method === 'POST') {
    try {
      const b = await parseBody(req); const amount = Number(b.price);
      const kind = p === '/api/compare/service' ? 'service' : (b.kind === 'product' ? 'product' : 'service');
      const item = cleanText(b.item_name,180), cat = cleanText(b.category,80), gov = cleanText(b.governorate,80);
      if (!item || !cat || !gov || !Number.isFinite(amount) || amount <= 0) { json(res,400,{error:'أكمل تفاصيل المقارنة.'}); return; }
      if (!CATEGORIES.some(c => c.id === cat && c.kind === kind) || !GOVERNORATES.includes(gov)) { json(res,400,{error:'القسم أو المحافظة غير صالحين.'}); return; }
      const rows = (await getContributions({status:'approved'})).filter(x => x.kind === kind && x.category === cat && x.governorate === gov && x.item_name.toLowerCase() === item.toLowerCase() && (Date.now()-new Date(x.date_paid).getTime()) <= 180*86400000);
      const prices = rows.map(x=>Number(x.price)).filter(x=>x>0).sort((a,b)=>a-b);
      if (prices.length < 5) { json(res,200,{status:'insufficient-data',sampleSize:prices.length,required:5,message:'لا توجد تجارب موثوقة كافية لإصدار حكم. لا تصف السعر بأنه مرتفع أو منخفض حتى نجمع 5 تجارب معتمدة على الأقل.'}); return; }
      const median = prices[Math.floor(prices.length/2)];
      const low = prices[Math.floor((prices.length-1)*0.2)];
      const high = prices[Math.ceil((prices.length-1)*0.8)];
      const pct = Math.round(((amount-median)/median)*100);
      const verdict = amount < low ? 'below' : amount > high ? 'above' : 'within';
      json(res,200,{status:'enough-data',kind,sampleSize:prices.length,median,low,high,submitted:amount,differencePercent:pct,verdict,updatedAt:new Date().toISOString()});
    } catch (e) { json(res,500,{error:'تعذرت المقارنة.',details:process.env.NODE_ENV==='development'?e.message:undefined}); }
    return;
  }
  if (p === '/api/admin/queue' && req.method === 'GET') {
    if (!adminAllowed(req)) { json(res,401,{error:'غير مصرح. أدخل رمز الإدارة الصحيح.'}); return; }
    try { json(res,200,{contributions:(await getContributions({status:'pending'})).map(({user_key,...x})=>x)}); }
    catch (e) { json(res,500,{error:'تعذر تحميل قائمة المراجعة.',details:e.message}); }
    return;
  }
  const adminMatch = p.match(/^\/api\/admin\/contributions\/([a-f0-9-]+)$/i);
  if (adminMatch && req.method === 'PATCH') {
    if (!adminAllowed(req)) { json(res,401,{error:'غير مصرح.'}); return; }
    try {
      const b = await parseBody(req);
      if (!['approved','rejected'].includes(b.status)) { json(res,400,{error:'قرار المراجعة غير صالح.'}); return; }
      const item = await updateContribution(adminMatch[1],{status:b.status,moderation_note:cleanText(b.note,300),moderated_at:new Date().toISOString()});
      if (!item) { json(res,404,{error:'المساهمة غير موجودة.'}); return; }
      json(res,200,{ok:true,status:item.status});
    } catch (e) { json(res,500,{error:'تعذرت مراجعة المساهمة.',details:e.message}); }
    return;
  }
  json(res,404,{error:'API route not found'});
}

const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function serveStatic(res, pathname) {
  try {
    const decoded = decodeURIComponent(pathname);
    let target = pathname === '/' ? path.join(PUBLIC,'index.html') : path.resolve(PUBLIC, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
    const relative = path.relative(PUBLIC, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { json(res,403,{error:'Forbidden'}); return; }
    const info = await stat(target);
    if (info.isDirectory()) target = path.join(target,'index.html');
    const data = await readFile(target);
    const ext = path.extname(target);
    res.writeHead(200,{
      'content-type':MIME[ext] || 'application/octet-stream',
      'cache-control':ext==='.html'?'no-cache':'public, max-age=300',
      'x-content-type-options':'nosniff',
      'x-frame-options':'DENY',
      'referrer-policy':'strict-origin-when-cross-origin',
      'permissions-policy':'camera=(), microphone=(), geolocation=()',
      'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://pricelens.store https://*.supabase.co; font-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
    });
    res.end(data);
  } catch { json(res,404,{error:'Not found'}); }
}

await loadLocalData();
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://localhost');
    if (url.pathname.startsWith('/auth/')) { const handled = await handleAuthRoute(req,res,url); if (handled) return; }
    if (url.pathname.startsWith('/api/')) return await handleApi(req,res,url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { json(res,405,{error:'Method not allowed'}); return; }
    await serveStatic(res,url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res,500,{error:'حدث خطأ داخلي.'}); else res.end();
  }
});
server.listen(PORT,()=>console.log(`KAM v2.1.1 running at http://localhost:${PORT} — database: ${IS_SUPABASE?'Supabase':'local JSON'}`));
