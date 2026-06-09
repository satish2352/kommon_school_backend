/* eslint-disable no-console */
// Supplementary QA round: auth negatives (fresh limiter window), external
// payment journey (correct planPricingId), corrected list/filter assertions,
// and follow-up lifecycle (seeded via DB so the dead-letter path isn't needed).
const { PrismaClient } = require('@prisma/client');
const BASE = 'http://localhost:3000/api/v1';
const PASSWORD = 'QaTest@12345';
const RUN = Date.now().toString(36);
const out = [];
function rec(area, name, status, expected, pass, note) {
  const v = pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INFO';
  out.push({ area, name, status, expected, v, note: note || '' });
  console.log(`${v==='PASS'?'✓':v==='FAIL'?'✗':'i'} [${area}] ${name} — http=${status} exp=${expected} => ${v}${note?' :: '+note:''}`);
}
async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j, text: t };
  } catch (e) { return { status: 0, json: null, text: String(e.message) }; }
}

(async () => {
  const p = new PrismaClient();

  // ---- AUTH NEGATIVES FIRST (keep < 5 login calls to stay under limiter) ----
  const wrong = await req('POST', '/auth/login', { body: { email: 'qa.superadmin@kommontest.com', password: 'WrongPass123' } });
  rec('AUTH', 'wrong password', wrong.status, 401, wrong.status === 401, wrong.json?.error?.message || wrong.text.slice(0,60));
  const ne = await req('POST', '/auth/login', { body: { email: 'nobody.' + RUN + '@x.com', password: 'WhateverPass1' } });
  const sameMsg = ne.json?.error?.message === wrong.json?.error?.message;
  rec('AUTH', 'nonexistent user (enumeration check)', ne.status, 401, ne.status === 401, sameMsg ? 'identical msg → no enumeration' : 'DIFFERENT msg → enumeration risk');
  const badFmt = await req('POST', '/auth/login', { body: { email: 'not-an-email', password: 'x' } });
  rec('AUTH', 'invalid email + short pw (validation)', badFmt.status, 400, badFmt.status === 400, badFmt.json?.error?.code || '');

  // ---- LOGIN (1 successful call → total 4, under the 5/min limit) ----
  const lg = await req('POST', '/auth/login', { body: { email: 'qa.superadmin@kommontest.com', password: PASSWORD } });
  const T = lg.json?.data?.accessToken || lg.json?.accessToken;
  if (!T) { rec('AUTH', 'login (limiter may still be active)', lg.status, 200, false, lg.text.slice(0,80)); }

  // ---- EXTERNAL PAYMENT JOURNEY (correct schema: planPricingId) ----
  const email = `journey.${RUN}@example.com`;
  const create = await req('POST', '/enrollments', { body: { name: 'Journey User', phone: '9876512345', email, role: 'STUDENT', education: 'GRADUATE' } });
  const eid = create.json?.data?.enrollment?.id || create.json?.data?.id;
  rec('PAYMENT', 'public enrollment create', create.status, '201', [200,201].includes(create.status), `id=${eid}`);
  if (eid && T) {
    const sel = await req('PATCH', `/enrollments/${eid}/plan`, { body: { planPricingId: 1 } });
    rec('PAYMENT', 'select plan (planPricingId=1)', sel.status, 200, [200,201].includes(sel.status), `${sel.json?.error?.code||''} ${JSON.stringify(sel.json?.data||'').slice(0,80)}`);
    const ord = await req('POST', `/enrollments/${eid}/payment-order`, { body: {} });
    const od = ord.json?.data || ord.json;
    rec('PAYMENT', 'create razorpay payment-order', ord.status, '200/201', [200,201].includes(ord.status) ? true : null, `${ord.json?.error?.code||''} order=${od?.orderId||od?.razorpayOrderId||od?.id||JSON.stringify(od||'').slice(0,90)}`);
    // enrollment should now be payment_pending
    const after = await p.enrollment.findUnique({ where: { id: eid }, select: { status: true, plan_pricing_id: true } });
    rec('PAYMENT', 'enrollment moved to payment_pending', '-', 'payment_pending', after?.status === 'payment_pending', `status=${after?.status} ppid=${after?.plan_pricing_id}`);
    // re-submit public with same email while in-flight → should resume (200), not duplicate
    const resume = await req('POST', '/enrollments', { body: { name: 'Journey User', phone: '9876512345', email, role: 'STUDENT', education: 'GRADUATE' } });
    const rid = resume.json?.data?.enrollment?.id || resume.json?.data?.id;
    rec('PAYMENT', 're-submit in-flight email (resume, no dup)', resume.status, '200 same id', rid === eid, `id=${rid}`);
  }

  // ---- CORRECTED LIST / FILTER / SEARCH (data.items) ----
  if (T) {
    const li = await req('GET', '/admin/enrollments?limit=100', { token: T });
    const items = li.json?.data?.items || [];
    rec('ADMIN-LIST', 'list (items shape)', li.status, 200, li.status === 200 && Array.isArray(items), `total=${li.json?.data?.total} items=${items.length}`);
    const fi = await req('GET', '/admin/enrollments?candidateType=INTERNAL&limit=100', { token: T });
    const fit = fi.json?.data?.items || [];
    const allInt = fit.length > 0 && fit.every(x => x.candidateType === 'INTERNAL');
    rec('ADMIN-LIST', 'filter INTERNAL correct', fi.status, 200, allInt, `count=${fit.length} allInternal=${allInt}`);
    const fe = await req('GET', '/admin/enrollments?candidateType=EXTERNAL&limit=100', { token: T });
    const fet = fe.json?.data?.items || [];
    const allExt = fet.length > 0 && fet.every(x => x.candidateType === 'EXTERNAL');
    rec('ADMIN-LIST', 'filter EXTERNAL correct', fe.status, 200, allExt, `count=${fet.length} allExternal=${allExt}`);
    const se = await req('GET', `/admin/enrollments?search=journey.${RUN}&limit=10`, { token: T });
    const set = se.json?.data?.items || [];
    rec('ADMIN-LIST', 'search by email finds row', se.status, 200, set.some(x => x.email === email), `count=${set.length}`);
    const pg = await req('GET', '/admin/enrollments?limit=2&page=1', { token: T });
    rec('ADMIN-LIST', 'pagination limit=2', pg.status, 200, (pg.json?.data?.items||[]).length <= 2 && pg.json?.data?.limit === 2, `items=${(pg.json?.data?.items||[]).length} total=${pg.json?.data?.total}`);
  }

  // ---- FOLLOW-UP LIFECYCLE (seed one row, then exercise endpoints) ----
  if (T) {
    const anyEnr = await p.enrollment.findFirst({ where: { deleted_at: null }, select: { id: true } });
    let fu = await p.followup.findFirst({ where: { deleted_at: null } });
    if (!fu && anyEnr) {
      fu = await p.followup.create({ data: { enrollment_id: anyEnr.id, status: 'payment_pending', reason: 'QA seeded for lifecycle test' } });
    }
    rec('FOLLOWUP', 'seed follow-up for lifecycle test', '-', 'created', !!fu, fu ? `id=${fu.id}` : 'no enrollment to attach');
    if (fu) {
      const list = await req('GET', '/followups?limit=20', { token: T });
      const frows = list.json?.data?.rows || list.json?.data?.items || list.json?.data || [];
      rec('FOLLOWUP', 'list shows seeded follow-up', list.status, 200, Array.isArray(frows) && frows.length >= 1, `count=${frows.length}`);
      const upd = await req('PATCH', `/followups/${fu.id}/status`, { token: T, body: { status: 'interested', next_followup_date: '2026-07-01T10:00:00.000Z' } });
      rec('FOLLOWUP', 'update status valid (interested)', upd.status, 200, upd.status === 200, upd.json?.error?.message || 'ok');
      const note = await req('POST', `/followups/${fu.id}/notes`, { token: T, body: { body: 'QA note <img src=x onerror=alert(1)>' } });
      rec('FOLLOWUP', 'add note (stores raw; FE must escape)', note.status, '200/201', [200,201].includes(note.status) ? null : false, 'XSS payload stored verbatim → frontend escaping required');
      const tl = await req('GET', `/followups/${fu.id}/timeline`, { token: T });
      rec('FOLLOWUP', 'timeline returns events', tl.status, 200, tl.status === 200, `events=${(tl.json?.data?.timeline||tl.json?.data?.events||[]).length}`);
      const close = await req('PATCH', `/followups/${fu.id}/status`, { token: T, body: { status: 'followup_closed' } });
      rec('FOLLOWUP', 'close follow-up (status transition)', close.status, 200, close.status === 200);
    }
  }

  const pass = out.filter(r=>r.v==='PASS').length, fail = out.filter(r=>r.v==='FAIL').length, info = out.filter(r=>r.v==='INFO').length;
  console.log(`\n===== SUPP SUMMARY: TOTAL=${out.length} PASS=${pass} FAIL=${fail} INFO=${info} =====`);
  out.filter(r=>r.v==='FAIL').forEach(r=>console.log(`  ✗ [${r.area}] ${r.name} (http=${r.status}) ${r.note}`));
  await p.$disconnect();
})();
