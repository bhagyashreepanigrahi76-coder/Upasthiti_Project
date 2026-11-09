// Auth and role-access smoke test. Needs a running server and freshly seeded data:
//   npm run db:seed && npm run build && npm start   (then, in another terminal)
//   npm run test:e2e
// Note: the last check locks account T1003 for 15 minutes. Run npm run db:seed afterwards.
const BASE = process.argv[2] ?? "http://localhost:3000";
let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);
  if (!ok) failures++;
};

function hiddenActionFields(html, formIndex = 0) {
  const forms = [...html.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0]);
  const form = forms[formIndex] ?? "";
  const fields = {};
  for (const m of form.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = m[0].match(/name="([^"]*)"/)?.[1];
    const value = m[0].match(/value="([^"]*)"/)?.[1] ?? "";
    if (name && name.startsWith("$ACTION")) fields[name.replace(/&amp;/g, "&")] = value.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  }
  return fields;
}

async function login(collegeId, password, next = "") {
  const page = await fetch(`${BASE}/login`).then((r) => r.text());
  const fd = new FormData();
  for (const [k, v] of Object.entries(hiddenActionFields(page))) fd.append(k, v);
  fd.append("next", next);
  fd.append("collegeId", collegeId);
  fd.append("password", password);
  const res = await fetch(`${BASE}/login`, { method: "POST", body: fd, redirect: "manual" });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.match(/cas_session=[^;]+/)?.[0] ?? null;
  return { status: res.status, location: res.headers.get("location"), cookie, body: await res.text() };
}

const get = (path, cookie) =>
  fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" }).then(async (r) => ({
    status: r.status,
    location: r.headers.get("location"),
    body: (await r.text()).replace(/<!-- -->/g, ""), // React text separators
  }));

// 1. Wrong password
const bad = await login("S26CS001", "wrong-password");
check(bad.status === 200 && bad.body.includes("Invalid college ID or password"), "wrong password shows generic error");
const unknown = await login("NOPE999", "whatever");
check(unknown.body.includes("Invalid college ID or password"), "unknown ID shows the same generic error");

// 2. Student login, lower-case ID accepted
const stu = await login("s26cs001", "Demo@1234");
check(stu.status === 303 && stu.location?.endsWith("/student") && stu.cookie, "student logs in → /student", `${stu.status} ${stu.location}`);
const stuPage = await get("/student", stu.cookie);
check(stuPage.status === 200 && stuPage.body.includes("S26CS001") && stuPage.body.includes("Programming in C"), "student dashboard shows own roll no and subjects");
check(stuPage.body.includes("Rahul Verma"), "student sees class coordinator name");
const stuAdmin = await get("/admin", stu.cookie);
check(stuAdmin.status === 307 && stuAdmin.location?.endsWith("/forbidden"), "student blocked from /admin", `${stuAdmin.status} ${stuAdmin.location}`);
const stuLogin = await get("/login", stu.cookie);
check(stuLogin.status === 307 && stuLogin.location?.endsWith("/student"), "signed-in student visiting /login goes to portal");

// 3. Admin
const adm = await login("ADMIN01", "Demo@1234");
check(adm.location?.endsWith("/admin"), "admin logs in → /admin");
const admPage = await get("/admin", adm.cookie);
check(admPage.status === 200 && admPage.body.includes("Active students") && admPage.body.includes("LOGIN_FAILED"), "admin dashboard shows counts and audit log entries");
check(/Active students<\/p><p[^>]*>28</.test(admPage.body), "admin sees 28 active students");

// 4. Multi-role user (Teacher + HOD)
const hod = await login("T1001", "Demo@1234");
check(hod.location?.endsWith("/select-role"), "Teacher+HOD lands on portal picker", hod.location);
const pick = await get("/select-role", hod.cookie);
check(pick.body.includes("HOD portal") && pick.body.includes("Teacher portal") && !pick.body.includes("Admin portal"), "picker lists HOD and Teacher only");
const hodPage = await get("/hod", hod.cookie);
check(hodPage.status === 200 && hodPage.body.includes("B.Sc. Computer Science") && !hodPage.body.includes("B.Com."), "HOD sees only own department");
const hodTeach = await get("/teacher", hod.cookie);
check(hodTeach.status === 200 && hodTeach.body.includes("Data Structures"), "HOD can open teacher portal with own classes");
check((await get("/admin", hod.cookie)).location?.endsWith("/forbidden"), "HOD blocked from /admin");

// 5. Mentor sees mentees, teacher sees only assigned classes
const men = await login("T1002", "Demo@1234");
const menPage = await get("/teacher", (await men).cookie ?? men.cookie);
check(menPage.body.includes("My mentees") && menPage.body.includes("Aarav Sharma"), "class coordinator sees mentees");
check(!menPage.body.includes("Operating Systems"), "teacher does not see unassigned subjects");

// 6. Parent with two children
const par = await login("P26CS001", "Demo@1234");
const parPage = await get("/parent", par.cookie);
check(par.location?.endsWith("/parent") && parPage.body.includes("S26CS001") && parPage.body.includes("S24CS001"), "parent sees both linked children");

// 7. ?next handling
const nextOk = await login("T1001", "Demo@1234", "/hod");
check(nextOk.location?.endsWith("/hod"), "valid ?next=/hod honoured");
const nextEvil = await login("S26CS002", "Demo@1234", "//evil.example.com");
check(nextEvil.location?.endsWith("/student"), "open redirect //evil.example.com ignored", nextEvil.location);
const nextForbidden = await login("S26CS002", "Demo@1234", "/admin");
check(nextForbidden.location?.endsWith("/student"), "?next to a forbidden portal ignored", nextForbidden.location);

// 8. Tampered cookie
const tampered = stu.cookie.slice(0, -4) + "AAAA";
const tamperedRes = await get("/student", tampered);
check(tamperedRes.status === 307 && tamperedRes.location?.includes("/login"), "tampered session cookie rejected");

// 9. Logout
const logoutPage = await get("/student", stu.cookie);
const logoutFormIdx = [...logoutPage.body.matchAll(/<form[\s\S]*?<\/form>/g)].findIndex((m) => m[0].includes("Sign out"));
const fd = new FormData();
for (const [k, v] of Object.entries(hiddenActionFields(logoutPage.body, logoutFormIdx))) fd.append(k, v);
const out = await fetch(`${BASE}/student`, { method: "POST", body: fd, redirect: "manual", headers: { cookie: stu.cookie } });
const cleared = (out.headers.get("set-cookie") ?? "").match(/cas_session=;|cas_session=[^;]*;[^,]*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
check(out.status === 303 && out.headers.get("location")?.endsWith("/login") && cleared, "sign out clears cookie → /login", `${out.status} ${out.headers.get("location")}`);

// 10. Lockout after 5 failures
for (let i = 0; i < 5; i++) await login("T1003", "bad-" + i);
const locked = await login("T1003", "Demo@1234");
check(locked.body.includes("Too many failed attempts") && !locked.cookie, "account locked after 5 failed attempts, even with correct password");

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures ? 1 : 0);
