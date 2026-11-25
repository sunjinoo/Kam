import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

const mockProvider = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('content-type', 'application/json');
  if (url.pathname.endsWith('/search')) {
    res.end(JSON.stringify({ products: [{ id: 'mock-product-1', title: 'حاسوب تجريبي', brand: 'KAM Test' }] }));
  } else if (url.pathname.endsWith('/market')) {
    res.end(JSON.stringify({
      product: { title: 'حاسوب تجريبي', brand: 'KAM Test', image_url: null },
      median: 20000,
      history: [{ date: '2026-11-10', price: 20500 }],
      offers: [
        { id: 'offer-1', retailer: 'Amazon.eg', price: 19500, link: 'https://www.amazon.eg/dp/test', last_seen: '2026-11-25T08:00:00Z' },
        { id: 'offer-2', retailer: 'Noon', price: 20200, link: 'https://www.noon.com/test', last_seen: '2026-11-25T08:00:00Z' }
      ]
    }));
  } else if (url.pathname.endsWith('/deals')) {
    res.end(JSON.stringify({ deals: [{ retailer: 'Amazon.eg', price: 19500, verified_discount_pct: 8, link: 'https://www.amazon.eg/dp/test', product: { title: 'حاسوب تجريبي' } }] }));
  } else if (url.pathname.endsWith('/stores')) {
    res.end(JSON.stringify({ stores: [{ id: 'amazon', name: 'Amazon.eg' }, { id: 'noon', name: 'Noon' }] }));
  } else {
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  }
});

const i18nSource = await readFile(path.resolve('public/i18n.js'), 'utf8');
const mockWindow = { addEventListener(){}, dispatchEvent(){} };
vm.runInNewContext(i18nSource, { window:mockWindow, document:{body:null}, localStorage:{getItem:()=> 'en',setItem(){}}, CustomEvent:class{}, console });
const pageMarkup = await readFile(path.resolve('public/index.html'), 'utf8');
const staticArabicText = [...pageMarkup.matchAll(/>([^<>]+)</g)].map(match => match[1].trim()).filter(value => /[\u0600-\u06ff]/.test(value));
const arabicAttributes = [...pageMarkup.matchAll(/(?:placeholder|aria-label|title)="([^"]+)"/g)].map(match => match[1]).filter(value => /[\u0600-\u06ff]/.test(value));
assert.deepEqual([...new Set(staticArabicText)].filter(value => mockWindow.KAM_I18N.t(value) === value), []);
assert.deepEqual([...new Set(arabicAttributes)].filter(value => mockWindow.KAM_I18N.t(value) === value), []);
assert.equal(mockWindow.KAM_I18N.t('٥ مجموعة · ١٢ تجربة معتمدة'), '5 groups · 12 approved reports');
assert.equal(mockWindow.KAM_I18N.t('السعر ١٬٢٥٠ ج.م'), 'السعر 1,250 EGP');
assert.equal(mockWindow.KAM_I18N.t('التبديل إلى الإنجليزية'), 'Switch to English');
mockWindow.KAM_I18N.setLanguage('ar');
assert.equal(mockWindow.KAM_I18N.t('Continue with Google'), 'المتابعة باستخدام Google');
assert.equal(mockWindow.KAM_I18N.t('الدقهلية'), 'الدقهلية');
assert.equal(mockWindow.KAM_I18N.t('Dakahlia'), 'الدقهلية');
mockWindow.KAM_I18N.setLanguage('en');
assert.equal(mockWindow.KAM_I18N.t('المتابعة باستخدام Google'), 'Continue with Google');

const tempData = await mkdtemp(path.join(tmpdir(), 'kam-smoke-'));
const providerPort = await listen(mockProvider);
const appPortServer = createServer();
const appPort = await listen(appPortServer);
await new Promise(resolve => appPortServer.close(resolve));
const adminToken = 'kam-smoke-admin-token-very-long';
const app = spawn(process.execPath, [path.resolve('server.mjs')], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(appPort),
    NODE_ENV: 'test',
    KAM_DATA_DIR: tempData,
    KAM_ADMIN_TOKEN: adminToken,
    KAM_SESSION_SECRET: 'kam-smoke-session-secret-32-bytes-minimum', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
    PUBLIC_BASE_URL: `http://127.0.0.1:${appPort}`,
    PRICELENS_API_KEY: 'mock-provider-key',
    PRICELENS_BASE_URL: `http://127.0.0.1:${providerPort}/api/v1/partner`
  },
  stdio: 'ignore'
});

const base = `http://127.0.0.1:${appPort}`;
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('KAM server did not start');
}

try {
  await waitForServer();
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.integrations.pricelens.configured, true);

  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(config.governorates.length, 27);
  assert.ok(config.categories.length >= 20);
  for (const governorate of config.governorates) assert.notEqual(mockWindow.KAM_I18N.t(governorate), governorate, `Missing English governorate translation: ${governorate}`);
  for (const category of config.categories) assert.notEqual(mockWindow.KAM_I18N.t(category.name), category.name, `Missing English category translation: ${category.name}`);

  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  const homeHtml = await page.text();
  assert.match(homeHtml, /KAM PRICE INTELLIGENCE/);
  assert.match(homeHtml, /id=\"googleSignInButton\" href=\"\/auth\/google\"/);
  for (const id of ['authHeading','authDescription','authAvatar','authPrivacyNote','authStatus','googleSignInText','googleSignOutButton']) assert.match(homeHtml, new RegExp(`id=\"${id}\"`), `Missing Google auth UI element: ${id}`);
  const i18n = await fetch(`${base}/i18n.js`);
  assert.equal(i18n.status, 200);
  assert.match(await i18n.text(), /Before you buy/);
  const authStatus = await (await fetch(`${base}/api/auth/me`)).json();
  assert.equal(authStatus.authenticated, false);
  assert.equal(authStatus.googleConfigured, false);
  const sessionPayload = Buffer.from(JSON.stringify({sub:'google-smoke-sub',email:'smoke@gmail.com',name:'KAM Smoke',picture:'',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  const sessionSignature = createHmac('sha256','kam-smoke-session-secret-32-bytes-minimum').update(sessionPayload).digest('base64url');
  const googleCookie = `kam_session=${sessionPayload}.${sessionSignature}`;
  const signedIn = await (await fetch(`${base}/api/auth/me`,{headers:{cookie:googleCookie}})).json();
  assert.equal(signedIn.authenticated,true);
  assert.equal(signedIn.user.email,'smoke@gmail.com');
  const signInDisabled = await fetch(`${base}/auth/google`, { redirect:'manual' });
  assert.equal(signInDisabled.status, 302);
  assert.match(signInDisabled.headers.get('location') || '', /auth=not-configured/);
  const traversal = await fetch(`${base}/%2e%2e%2f.env`);
  assert.ok([403, 404].includes(traversal.status));

  const market = await (await fetch(`${base}/api/market/search?q=laptop`)).json();
  assert.equal(market.mode, 'live');
  assert.equal(market.products.length, 1);
  assert.equal(market.products[0].offers.length, 2);
  assert.equal(market.products[0].offers[0].link, 'https://www.amazon.eg/dp/test');
  assert.equal(market.products[0].offers[0].price, 19500);
  const deals = await (await fetch(`${base}/api/market/deals`)).json();
  assert.equal(deals.deals.length, 1);
  const stores = await (await fetch(`${base}/api/market/stores`)).json();
  assert.equal(stores.stores.length, 2);

  const userKey = 'kam-smoke-user-123456';
  const today = new Date().toISOString().slice(0, 10);
  const badDate = await fetch(`${base}/api/contributions`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-kam-user': userKey },
    body: JSON.stringify({ userKey, kind: 'product', item_name: 'SSD 1TB', category: 'computers', governorate: 'الدقهلية', price: 2000, date_paid: '2026-02-31' })
  });
  assert.equal(badDate.status, 400);

  for (let i = 0; i < 5; i++) {
    const response = await fetch(`${base}/api/contributions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-kam-user': userKey },
      body: JSON.stringify({ userKey, kind: 'product', item_name: 'SSD 1TB', category: 'computers', governorate: 'الدقهلية', city: 'المنصورة', price: 1800 + i * 100, date_paid: today })
    });
    assert.equal(response.status, 201);
  }

  const linkedReport = await fetch(`${base}/api/contributions`, {
    method:'POST', headers:{'content-type':'application/json','x-kam-user':'forged-browser-id','cookie':googleCookie},
    body:JSON.stringify({userKey:'forged-body-id',kind:'product',item_name:'Google linked contribution',category:'computers',governorate:'الدقهلية',price:1999,date_paid:today})
  });
  assert.equal(linkedReport.status,201);
  const googleMine = await (await fetch(`${base}/api/contributions?mine=1`,{headers:{'x-kam-user':'forged-browser-id','cookie':googleCookie}})).json();
  assert.equal(googleMine.contributions.length,1);
  assert.equal(googleMine.contributions[0].item_name,'Google linked contribution');
  const unauth = await fetch(`${base}/api/admin/queue`);
  assert.equal(unauth.status, 401);
  const adminHeaders = { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' };
  const queue = await (await fetch(`${base}/api/admin/queue`, { headers: adminHeaders })).json();
  assert.equal(queue.contributions.length, 6);
  for (const row of queue.contributions) {
    const response = await fetch(`${base}/api/admin/contributions/${row.id}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'approved' }) });
    assert.equal(response.status, 200);
  }

  const comparison = await (await fetch(`${base}/api/compare/contributions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'product', item_name: 'SSD 1TB', category: 'computers', governorate: 'الدقهلية', price: 2200 })
  })).json();
  assert.equal(comparison.status, 'enough-data');
  assert.equal(comparison.sampleSize, 5);
  const mine = await (await fetch(`${base}/api/contributions?mine=1`, { headers: { 'x-kam-user': userKey } })).json();
  assert.equal(mine.contributions.length, 5);
  const logout = await fetch(`${base}/auth/logout`,{method:'POST',headers:{origin:base,cookie:googleCookie}});
  assert.equal(logout.status,200);
  assert.match(logout.headers.get('set-cookie') || '',/kam_session=.*Max-Age=0/);

  // Verify the configured Google OAuth authorization redirect and PKCE parameters.
  const oauthData = await mkdtemp(path.join(tmpdir(), 'kam-oauth-smoke-'));
  const oauthPortServer = createServer();
  const oauthPort = await listen(oauthPortServer);
  await new Promise(resolve => oauthPortServer.close(resolve));
  const oauthBase = `http://127.0.0.1:${oauthPort}`;
  const oauthApp = spawn(process.execPath, [path.resolve('server.mjs')], {
    cwd: process.cwd(),
    env: { ...process.env, PORT:String(oauthPort), NODE_ENV:'test', KAM_DATA_DIR:oauthData,
      KAM_SESSION_SECRET:'kam-oauth-smoke-session-secret-32-bytes',
      GOOGLE_CLIENT_ID:'kam-smoke.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET:'kam-smoke-client-secret',
      GOOGLE_REDIRECT_URI:`${oauthBase}/auth/google/callback`, PUBLIC_BASE_URL:oauthBase,
      PRICELENS_API_KEY:'', KAM_ADMIN_TOKEN:'oauth-admin-token' },
    stdio:'ignore'
  });
  try {
    let oauthReady = false;
    for (let i=0;i<60;i++) {
      try { if ((await fetch(`${oauthBase}/api/health`)).ok) { oauthReady=true; break; } } catch {}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(oauthReady,true,'Google OAuth test server did not start');
    const oauthStatus = await (await fetch(`${oauthBase}/api/auth/me`)).json();
    assert.equal(oauthStatus.googleConfigured,true);
    const begin = await fetch(`${oauthBase}/auth/google`,{redirect:'manual'});
    assert.equal(begin.status,302);
    const googleUrl = new URL(begin.headers.get('location'));
    assert.equal(googleUrl.origin,'https://accounts.google.com');
    assert.equal(googleUrl.searchParams.get('client_id'),'kam-smoke.apps.googleusercontent.com');
    assert.equal(googleUrl.searchParams.get('scope'),'openid email profile');
    assert.equal(googleUrl.searchParams.get('response_type'),'code');
    assert.equal(googleUrl.searchParams.get('code_challenge_method'),'S256');
    assert.ok(googleUrl.searchParams.get('state'));
    assert.ok(googleUrl.searchParams.get('nonce'));
    assert.ok(googleUrl.searchParams.get('code_challenge'));
    assert.match(begin.headers.get('set-cookie') || '',/kam_oauth_state=.*HttpOnly/);
  } finally {
    oauthApp.kill('SIGTERM');
    await rm(oauthData,{recursive:true,force:true});
  }

  console.log('KAM smoke tests passed: bilingual round-trip coverage, 27 governorates, all categories, Google OAuth PKCE start/session/logout, PriceLens adapter, offers/deals/stores, contributions, moderation, account history, and quote comparison.');
} finally {
  app.kill('SIGTERM');
  mockProvider.close();
  await rm(tempData, { recursive: true, force: true });
}
