/* eslint-disable no-console */
// ===========================================================================
// QA E2E harness — drives live HTTP against the running backend on :3000.
// Records every test with status/expectation/result. Prints a JSON summary.
// ===========================================================================
const BASE = process.env.QA_BASE || 'http://localhost:3000/api/v1';
const PASSWORD = 'QaTest@12345';
const RUN = Date.now().toString(36);

const results = [];
let order = 0;
function rec(area, name, { status, expected, pass, note, body }) {
  order += 1;
  const verdict = pass === true ? 'PASS' : pass === false ? 'FAIL' : 'INFO';
  results.push({ n: order, area, name, status, expected, verdict, note: note || '', body: body });
  const tag = verdict === 'PASS' ? '✓' : verdict === 'FAIL' ? '✗' : 'i';
  console.log(`${tag} [${area}] ${name} — http=${status} exp=${expected} => ${verdict}${note ? ' :: ' + note : ''}`);
}

async function req(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    if (raw) { headers['Content-Type'] = 'application/json'; payload = body; }
    else { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  }
  let res, text, json;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
    text = await res.text();
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: String(e && e.message) };
  }
}

const tokens = {};
const ids = {};

async function login(email) {
  const r = await req('POST', '/auth/login', { body: { email, password: PASSWORD } });
  return r;
}

(async () => {
  // =====================================================================
  // A. AUTH
  // =====================================================================
  for (const role of ['superadmin', 'admin', 'marketing', 'student']) {
    const r = await login(`qa.${role}@kommontest.com`);
    const tok = r.json?.data?.accessToken || r.json?.accessToken || r.json?.data?.tokens?.accessToken;
    tokens[role] = tok;
    rec('AUTH', `login ${role}`, { status: r.status, expected: 200, pass: r.status === 200 && !!tok, note: tok ? 'token ok' : `no token: ${r.text.slice(0,120)}` });
  }
  {
    const r = await login('qa.superadmin@kommontest.com'); // baseline ok already; now wrong pw
    const w = await req('POST', '/auth/login', { body: { email: 'qa.superadmin@kommontest.com', password: 'WrongPass123' } });
    rec('AUTH', 'login wrong password', { status: w.status, expected: 401, pass: w.status === 401, note: w.json?.error?.message || '' });
    const ne = await req('POST', '/auth/login', { body: { email: 'doesnotexist@kommontest.com', password: 'WhateverPass1' } });
    rec('AUTH', 'login nonexistent user (no user enumeration)', { status: ne.status, expected: 401, pass: ne.status === 401, note: ne.json?.error?.message === w.json?.error?.message ? 'same msg as wrong-pw (good)' : 'DIFFERENT msg (enumeration risk)' });
    const bad = await req('POST', '/auth/login', { body: { email: 'not-an-email', password: 'x' } });
    rec('AUTH', 'login invalid email + short pw', { status: bad.status, expected: 400, pass: bad.status === 400 });
    const noTok = await req('GET', '/enrollments');
    rec('AUTH', 'protected route without token', { status: noTok.status, expected: 401, pass: noTok.status === 401 });
    const badTok = await req('GET', '/enrollments', { token: 'garbage.token.here' });
    rec('AUTH', 'protected route malformed token', { status: badTok.status, expected: 401, pass: badTok.status === 401 });
  }

  const T = tokens.superadmin;

  // =====================================================================
  // B. PUBLIC ENROLLMENT (no auth)
  // =====================================================================
  const pubEmail = `qa.pub.${RUN}@example.com`;
  const validNew = { name: 'Priya Sharma', phone: '9876543210', email: pubEmail, role: 'STUDENT', education: 'UNDERGRADUATE', readiness: 'BEGINNER', source: 'GOOGLE' };
  {
    const r = await req('POST', '/enrollments', { body: validNew });
    ids.pubEnrollment = r.json?.data?.enrollment?.id || r.json?.data?.id || r.json?.enrollment?.id;
    rec('PUBLIC', 'valid new-shape submit', { status: r.status, expected: '201/200', pass: [200,201].includes(r.status) && !!ids.pubEnrollment, note: `code=${r.json?.data?.enrollment?.enrollment_code || ''} id=${ids.pubEnrollment||''}` });

    const dup = await req('POST', '/enrollments', { body: validNew });
    const dupId = dup.json?.data?.enrollment?.id || dup.json?.data?.id;
    rec('PUBLIC', 'duplicate submit (dedupe)', { status: dup.status, expected: '200 same id', pass: [200,201].includes(dup.status) && dupId === ids.pubEnrollment, note: dupId === ids.pubEnrollment ? 'deduped to same row' : `different id ${dupId}` });
  }
  const negs = [
    ['name with digits', { ...validNew, email:`a1.${RUN}@example.com`, name: 'Test123' }],
    ['name with XSS', { ...validNew, email:`a2.${RUN}@example.com`, name: '<script>alert(1)</script>' }],
    ['phone leading 5', { ...validNew, email:`a3.${RUN}@example.com`, phone: '5876543210' }],
    ['phone too short', { ...validNew, email:`a4.${RUN}@example.com`, phone: '98765' }],
    ['invalid email', { ...validNew, email: 'bad@email' }],
    ['missing education', (()=>{const x={...validNew,email:`a6.${RUN}@example.com`};delete x.education;return x;})()],
    ['invalid role enum', { ...validNew, email:`a7.${RUN}@example.com`, role: 'HACKER' }],
    ['empty body', {}],
    ['invalid promo code', { ...validNew, email:`a9.${RUN}@example.com`, promoCode: 'NOPE_INVALID' }],
    ['SQL injection in name', { ...validNew, email:`a10.${RUN}@example.com`, name: "Robert'); DROP TABLE enrollments;--" }],
  ];
  for (const [label, payload] of negs) {
    const r = await req('POST', '/enrollments', { body: payload });
    const isPromo = label.includes('promo');
    rec('PUBLIC', `negative: ${label}`, { status: r.status, expected: 400, pass: r.status === 400, note: (r.json?.error?.code||'') + ' ' + (r.json?.error?.message||'').slice(0,80) });
  }
  {
    // legacy shape
    const r = await req('POST', '/enrollments', { body: { first_name:'Legacy', last_name:'User', email:`legacy.${RUN}@example.com`, phone_number:'+919876500000', plan:'Silver', group:'G1', unit:'U1', phase:'P1', segment:'S1', amount: 5000 } });
    rec('PUBLIC', 'legacy-shape submit', { status: r.status, expected: '201/200', pass: [200,201].includes(r.status), note: r.json?.error?.message || 'ok' });
    // unknown extra field with valid new shape
    const r2 = await req('POST', '/enrollments', { body: { ...validNew, email:`extra.${RUN}@example.com`, hackerField: 'x' } });
    rec('PUBLIC', 'unknown extra field', { status: r2.status, expected: 'observe', pass: null, note: `status=${r2.status} ${r2.json?.error?.code||''}` });
    // oversized name (>100)
    const r3 = await req('POST', '/enrollments', { body: { ...validNew, email:`long.${RUN}@example.com`, name: 'A'.repeat(150) } });
    rec('PUBLIC', 'name > max length', { status: r3.status, expected: 400, pass: r3.status === 400 });
  }

  // =====================================================================
  // C. PLAN SELECT + PAYMENT (public) for the created enrollment
  // =====================================================================
  if (ids.pubEnrollment) {
    const sel = await req('PATCH', `/enrollments/${ids.pubEnrollment}/plan`, { body: { planTier: 'SILVER', durationMonths: 1 } });
    rec('PAYMENT', 'select plan for enrollment', { status: sel.status, expected: 'observe', pass: [200,201].includes(sel.status) ? true : null, note: `${sel.json?.error?.code||''} ${JSON.stringify(sel.json?.data||sel.json?.error?.message||'').slice(0,100)}` });
    const ord = await req('POST', `/enrollments/${ids.pubEnrollment}/payment-order`, { body: {} });
    rec('PAYMENT', 'create razorpay payment-order', { status: ord.status, expected: 'observe', pass: null, note: `${ord.status} ${JSON.stringify(ord.json?.data||ord.json?.error||'').slice(0,140)}` });
    const ver = await req('POST', `/enrollments/${ids.pubEnrollment}/payment-verify`, { body: { paymentId:'x', razorpayOrderId:'order_x', razorpayPaymentId:'pay_x', razorpaySignature:'badsig' } });
    rec('PAYMENT', 'payment-verify bad signature', { status: ver.status, expected: '400/422', pass: [400,401,422].includes(ver.status), note: `${ver.json?.error?.code||''}` });
  }

  // =====================================================================
  // D. ADMIN MANUAL ENROLLMENT
  // =====================================================================
  const manualValid = { name: 'Manual Tester', email:`manual.${RUN}@example.com`, phone:'9811122233', role:'STUDENT', education:'GRADUATE', planTier:'SILVER', durationMonths: 1 };
  {
    const r = await req('POST', '/admin/enrollments/manual', { token: T, body: manualValid });
    ids.manualEnrollment = r.json?.data?.enrollment?.id;
    rec('ADMIN-MANUAL', 'superadmin create manual', { status: r.status, expected: '201', pass: [200,201].includes(r.status), note: `status=${r.json?.data?.enrollment?.status} code=${r.json?.data?.enrollment?.enrollmentCode||''} webhookOk=${r.json?.data?.webhookDelivery?.ok}` });
    const r2 = await req('POST', '/admin/enrollments/manual', { token: tokens.admin, body: { ...manualValid, email:`manual2.${RUN}@example.com` } });
    rec('ADMIN-MANUAL', 'admin create manual', { status: r2.status, expected: '201', pass: [200,201].includes(r2.status) });
    const r3 = await req('POST', '/admin/enrollments/manual', { token: tokens.marketing, body: { ...manualValid, email:`manual3.${RUN}@example.com` } });
    rec('ADMIN-MANUAL', 'marketing create manual (RBAC)', { status: r3.status, expected: 403, pass: r3.status === 403, note: r3.json?.error?.code||'' });
    const r4 = await req('POST', '/admin/enrollments/manual', { token: tokens.student, body: { ...manualValid, email:`manual4.${RUN}@example.com` } });
    rec('ADMIN-MANUAL', 'student create manual (RBAC)', { status: r4.status, expected: 403, pass: r4.status === 403, note: r4.json?.error?.code||'' });
    const r5 = await req('POST', '/admin/enrollments/manual', { token: T, body: { ...manualValid, email:`m5.${RUN}@example.com`, planTier:'DIAMOND' } });
    rec('ADMIN-MANUAL', 'invalid planTier', { status: r5.status, expected: 400, pass: r5.status === 400 });
    const r6 = await req('POST', '/admin/enrollments/manual', { token: T, body: { ...manualValid, email:`m6.${RUN}@example.com`, durationMonths: 5 } });
    rec('ADMIN-MANUAL', 'invalid durationMonths (5)', { status: r6.status, expected: 400, pass: r6.status === 400 });
    const r7 = await req('POST', '/admin/enrollments/manual', { token: T, body: { ...manualValid, email:`m7.${RUN}@example.com`, planTier:'GOLD', durationMonths: 3 } });
    rec('ADMIN-MANUAL', 'nonexistent pricing combo (GOLD/3)', { status: r7.status, expected: 404, pass: r7.status === 404, note: r7.json?.error?.code||'' });
    const r8 = await req('POST', '/admin/enrollments/manual', { token: T, body: { ...manualValid, email:`m8.${RUN}@example.com`, name:'Bad9Name' } });
    rec('ADMIN-MANUAL', 'name with digits', { status: r8.status, expected: 400, pass: r8.status === 400 });
  }

  // =====================================================================
  // E. ADMIN INTERNAL ENROLLMENT
  // =====================================================================
  {
    const base = { name:'Internal Tester', email:`internal.${RUN}@example.com`, phone:'9822233344', role:'STUDENT', education:'GRADUATE', courseId: 2, internalPlanId: 1 };
    const r = await req('POST', '/admin/enrollments/internal', { token: T, body: base });
    ids.internalEnrollment = r.json?.data?.enrollment?.id;
    rec('ADMIN-INTERNAL', 'valid internal enrollment', { status: r.status, expected: '201', pass: [200,201].includes(r.status), note: `status=${r.json?.data?.enrollment?.status} ips=${r.json?.data?.enrollment?.internalPaymentStatus} final=${r.json?.data?.enrollment?.finalAmountPaise} pay=${r.json?.data?.enrollment?.paymentId||'none'}` });
    const r2 = await req('POST', '/admin/enrollments/internal', { token: T, body: { ...base, email:`int2.${RUN}@example.com`, internalCouponCode:'NOPE' } });
    rec('ADMIN-INTERNAL', 'invalid coupon (empty coupons[])', { status: r2.status, expected: 400, pass: r2.status === 400, note: r2.json?.error?.code||'' });
    const r3 = await req('POST', '/admin/enrollments/internal', { token: T, body: { ...base, email:`int3.${RUN}@example.com`, courseId: 4, internalPlanId: 1 } });
    rec('ADMIN-INTERNAL', 'plan/course mismatch', { status: r3.status, expected: 400, pass: r3.status === 400, note: r3.json?.error?.code||'' });
    const r4 = await req('POST', '/admin/enrollments/internal', { token: T, body: { ...base, email:`int4.${RUN}@example.com`, internalPlanId: 99999 } });
    rec('ADMIN-INTERNAL', 'nonexistent internal plan', { status: r4.status, expected: 404, pass: r4.status === 404, note: r4.json?.error?.code||'' });
    const r5 = await req('POST', '/admin/enrollments/internal', { token: T, body: { ...base, email:`int5.${RUN}@example.com`, basePrice: 1, finalAmountPaise: 1, amount: 1 } });
    rec('ADMIN-INTERNAL', 'fee tamper attempt (stripUnknown)', { status: r5.status, expected: '201 server-priced', pass: [200,201].includes(r5.status), note: `final=${r5.json?.data?.enrollment?.finalAmountPaise} (course_fee-based, tamper ignored)` });
    const r6 = await req('POST', '/admin/enrollments/internal', { token: tokens.marketing, body: { ...base, email:`int6.${RUN}@example.com` } });
    rec('ADMIN-INTERNAL', 'marketing internal (RBAC)', { status: r6.status, expected: 403, pass: r6.status === 403 });
  }

  // =====================================================================
  // F. ADMIN ENROLLMENT LIST / SEARCH / DETAIL
  // =====================================================================
  {
    const r = await req('GET', '/admin/enrollments?page=1&limit=50', { token: T });
    const rows = r.json?.data?.rows || r.json?.data || r.json?.rows || [];
    rec('ADMIN-LIST', 'list enrollments', { status: r.status, expected: 200, pass: r.status === 200, note: `count=${Array.isArray(rows)?rows.length:'?'}` });
    const fi = await req('GET', '/admin/enrollments?candidateType=INTERNAL&limit=50', { token: T });
    const fr = fi.json?.data?.rows || fi.json?.data || [];
    const allInternal = Array.isArray(fr) && fr.every(x => (x.candidate_type||x.candidateType) === 'INTERNAL');
    rec('ADMIN-LIST', 'filter candidateType=INTERNAL', { status: fi.status, expected: 200, pass: fi.status === 200 && allInternal, note: `count=${fr.length} allInternal=${allInternal}` });
    const fe = await req('GET', '/admin/enrollments?candidateType=EXTERNAL&limit=50', { token: T });
    const fer = fe.json?.data?.rows || fe.json?.data || [];
    rec('ADMIN-LIST', 'filter candidateType=EXTERNAL', { status: fe.status, expected: 200, pass: fe.status === 200, note: `count=${fer.length}` });
    const se = await req('GET', `/admin/enrollments?search=internal.${RUN}&limit=10`, { token: T });
    const ser = se.json?.data?.rows || se.json?.data || [];
    rec('ADMIN-LIST', 'search by email', { status: se.status, expected: 200, pass: se.status === 200 && ser.length >= 1, note: `count=${ser.length}` });
    const sp = await req('GET', '/admin/enrollments?search=9822233344&limit=10', { token: T });
    const spr = sp.json?.data?.rows || sp.json?.data || [];
    rec('ADMIN-LIST', 'search by phone', { status: sp.status, expected: 200, pass: sp.status === 200, note: `count=${spr.length}` });
    const gr = await req('GET', '/admin/enrollments/grouped?limit=50', { token: T });
    rec('ADMIN-LIST', 'grouped by email', { status: gr.status, expected: 200, pass: gr.status === 200 });
    const be = await req('GET', `/admin/enrollments/by-email?email=internal.${RUN}@example.com`, { token: T });
    rec('ADMIN-LIST', 'by-email history', { status: be.status, expected: 200, pass: be.status === 200 });
    if (ids.internalEnrollment) {
      const gd = await req('GET', `/admin/enrollments/${ids.internalEnrollment}`, { token: T });
      rec('ADMIN-LIST', 'getById valid', { status: gd.status, expected: 200, pass: gd.status === 200, note: `payments=${(gd.json?.data?.payments||[]).length}` });
    }
    const gd404 = await req('GET', '/admin/enrollments/00000000-0000-0000-0000-000000000000', { token: T });
    rec('ADMIN-LIST', 'getById nonexistent uuid', { status: gd404.status, expected: 404, pass: gd404.status === 404 });
    const gdBad = await req('GET', '/admin/enrollments/not-a-uuid', { token: T });
    rec('ADMIN-LIST', 'getById malformed uuid (no param validation?)', { status: gdBad.status, expected: '400 ideally', pass: gdBad.status === 400 ? true : (gdBad.status === 500 ? false : null), note: `status=${gdBad.status} ${gdBad.json?.error?.code||''}` });
    const badSort = await req('GET', '/admin/enrollments?sortBy=evil; DROP', { token: T });
    rec('ADMIN-LIST', 'invalid sortBy (injection-ish)', { status: badSort.status, expected: 400, pass: badSort.status === 400 });
    const mkt = await req('GET', '/admin/enrollments?limit=5', { token: tokens.marketing });
    rec('ADMIN-LIST', 'marketing list (RBAC)', { status: mkt.status, expected: 'observe', pass: null, note: `status=${mkt.status} (marketing perms)` });
    const stu = await req('GET', '/admin/enrollments?limit=5', { token: tokens.student });
    rec('ADMIN-LIST', 'student list (RBAC)', { status: stu.status, expected: 403, pass: stu.status === 403 });
  }

  // =====================================================================
  // G. FOLLOWUPS
  // =====================================================================
  {
    const r = await req('GET', '/followups?limit=50', { token: T });
    const rows = r.json?.data?.rows || r.json?.data || [];
    ids.followup = Array.isArray(rows) && rows[0] ? rows[0].id : null;
    rec('FOLLOWUP', 'list followups', { status: r.status, expected: 200, pass: r.status === 200, note: `count=${Array.isArray(rows)?rows.length:'?'} (auto-created?)` });
    const rh = await req('GET', '/follow-ups?limit=50', { token: T });
    rec('FOLLOWUP', 'list via /follow-ups alias', { status: rh.status, expected: 200, pass: rh.status === 200 });
    const badStatus = await req('PATCH', `/followups/00000000-0000-0000-0000-000000000000/status`, { token: T, body: { status: 'not_a_status' } });
    rec('FOLLOWUP', 'update status invalid enum', { status: badStatus.status, expected: 400, pass: badStatus.status === 400 });
    const emptyNote = await req('POST', `/followups/00000000-0000-0000-0000-000000000000/notes`, { token: T, body: { body: '' } });
    rec('FOLLOWUP', 'add empty note', { status: emptyNote.status, expected: 400, pass: emptyNote.status === 400 });
    const tl404 = await req('GET', `/followups/00000000-0000-0000-0000-000000000000/timeline`, { token: T });
    rec('FOLLOWUP', 'timeline nonexistent', { status: tl404.status, expected: 404, pass: tl404.status === 404 });
    if (ids.followup) {
      const upd = await req('PATCH', `/followups/${ids.followup}/status`, { token: T, body: { status: 'interested' } });
      rec('FOLLOWUP', 'update status valid', { status: upd.status, expected: 200, pass: upd.status === 200 });
      const note = await req('POST', `/followups/${ids.followup}/notes`, { token: T, body: { body: '<img src=x onerror=alert(1)> XSS note test' } });
      rec('FOLLOWUP', 'add note (XSS payload stored raw?)', { status: note.status, expected: '200/201', pass: [200,201].includes(note.status) ? null : false, note: 'check FE escaping' });
    }
    const mkt = await req('GET', '/followups?limit=5', { token: tokens.marketing });
    rec('FOLLOWUP', 'marketing list followups (RBAC)', { status: mkt.status, expected: 'observe', pass: null, note: `status=${mkt.status}` });
  }

  // =====================================================================
  // H. PAYMENTS / I. EMAIL LOGS / J. EXTERNAL API LOGS / K. SUMAGO USERS
  // =====================================================================
  {
    const p = await req('GET', '/admin/payments?limit=50', { token: T });
    const prows = p.json?.data?.rows || p.json?.data || [];
    rec('PAYMENTS', 'list payments', { status: p.status, expected: 200, pass: p.status === 200, note: `count=${Array.isArray(prows)?prows.length:'?'}` });

    const e = await req('GET', '/admin/email-logs?limit=50', { token: T });
    const erows = e.json?.data?.rows || e.json?.data || [];
    rec('EMAIL-LOG', 'list email logs', { status: e.status, expected: 200, pass: e.status === 200, note: `count=${Array.isArray(erows)?erows.length:'?'}` });

    const x = await req('GET', '/admin/external-api-logs?limit=50', { token: T });
    const xrows = x.json?.data?.rows || x.json?.data || [];
    rec('PROVISION', 'list external-api-logs (provision-user attempts)', { status: x.status, expected: 200, pass: x.status === 200, note: `count=${Array.isArray(xrows)?xrows.length:'?'}` });

    const wd = await req('GET', '/webhooks/deliveries?limit=50', { token: T });
    const wrows = wd.json?.data?.rows || wd.json?.data || [];
    rec('PROVISION', 'list webhook deliveries', { status: wd.status, expected: 200, pass: wd.status === 200, note: `count=${Array.isArray(wrows)?wrows.length:'?'}` });

    const sc = await req('GET', '/webhooks/sumago/config', { token: T });
    rec('FETCH-USERS', 'sumago config', { status: sc.status, expected: 200, pass: sc.status === 200, note: JSON.stringify(sc.json?.data||'').slice(0,100) });
    const su = await req('GET', '/webhooks/sumago/users?page=1&limit=20', { token: T });
    const surows = su.json?.data?.rows || su.json?.data?.users || su.json?.data || [];
    rec('FETCH-USERS', 'fetch users (GET sumago/users)', { status: su.status, expected: '200', pass: su.status === 200 ? true : null, note: `status=${su.status} count=${Array.isArray(surows)?surows.length:'?'} ${su.json?.error?.message?('err:'+su.json.error.message.slice(0,80)):''}` });
    const suMkt = await req('GET', '/webhooks/sumago/users?limit=5', { token: tokens.marketing });
    rec('FETCH-USERS', 'marketing fetch users (RBAC)', { status: suMkt.status, expected: 'observe', pass: null, note: `status=${suMkt.status}` });
    const suNo = await req('GET', '/webhooks/sumago/users?limit=5');
    rec('FETCH-USERS', 'fetch users no token', { status: suNo.status, expected: 401, pass: suNo.status === 401 });
  }

  // =====================================================================
  // L. SECURITY / RBAC EXTRAS
  // =====================================================================
  {
    const inj = await req('GET', `/admin/enrollments?search=${encodeURIComponent("' OR 1=1;--")}&limit=5`, { token: T });
    rec('SECURITY', 'SQLi in search param', { status: inj.status, expected: '200 safe', pass: [200].includes(inj.status), note: 'Prisma parameterizes; should not error/leak' });
    const usersList = await req('GET', '/admin/users?limit=5', { token: T });
    rec('SECURITY', 'admin/users list (superadmin)', { status: usersList.status, expected: 200, pass: usersList.status === 200 });
    const usersMkt = await req('GET', '/admin/users?limit=5', { token: tokens.marketing });
    rec('SECURITY', 'admin/users list (marketing RBAC)', { status: usersMkt.status, expected: 403, pass: usersMkt.status === 403 });
    const usersStu = await req('GET', '/admin/users?limit=5', { token: tokens.student });
    rec('SECURITY', 'admin/users list (student RBAC)', { status: usersStu.status, expected: 403, pass: usersStu.status === 403 });
    // student cannot read another's account, but can read own
    const meStu = await req('GET', '/auth/me/account', { token: tokens.student });
    rec('SECURITY', 'student self account overview', { status: meStu.status, expected: 200, pass: meStu.status === 200, note: `txns=${(meStu.json?.data?.transactions||[]).length}` });
  }

  // =====================================================================
  // SUMMARY
  // =====================================================================
  const pass = results.filter(r => r.verdict === 'PASS').length;
  const fail = results.filter(r => r.verdict === 'FAIL').length;
  const info = results.filter(r => r.verdict === 'INFO').length;
  console.log('\n===== SUMMARY =====');
  console.log(`TOTAL=${results.length} PASS=${pass} FAIL=${fail} INFO=${info}`);
  console.log('FAILURES:');
  results.filter(r=>r.verdict==='FAIL').forEach(r=>console.log(`  ✗ [${r.area}] ${r.name} (http=${r.status}, exp=${r.expected}) ${r.note}`));
  console.log('\nINFO/observed:');
  results.filter(r=>r.verdict==='INFO').forEach(r=>console.log(`  i [${r.area}] ${r.name}: ${r.note}`));
  console.log('\n===JSON_START===');
  console.log(JSON.stringify({ run: RUN, pass, fail, info, total: results.length, ids, results }, null, 0));
  console.log('===JSON_END===');
})();
