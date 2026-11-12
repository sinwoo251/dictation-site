/* 학습 기록 모으기 (웹판) — 채점 기록을 이름 없이(anon 번호만) 30초마다 Worker로 보낸다.
   config.js의 collectFrom 날짜가 됐고, 이 기기에서 끄지 않았고, 저장소가 열려 있을 때만 동작한다.
   서재·Mac 파일에는 config.js가 없어 이 스크립트가 아예 안 불러와진다. */
window.Collect = (() => {
  const cfg = window.CLOUD_CONFIG || {};
  const URL_EVENTS = "https://dictation-transcript.sinwoo0617.workers.dev/api/events";
  const K_ANON = "dictation:anon:v1", K_ON = "dictation:collect:v1";
  const MAX_QUEUE = 500, BATCH = 50, EVERY = 30000;
  const queue = [];
  let lastAuth = null;   // 마지막으로 받은 로그인 표: 숨김 전송이 기다리지 않고 쓴다
  let stopped = false, busy = false;   // stopped: 한도(429) 등으로 이번 방문은 더 안 보냄

  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  // 날짜가 됐는지: collectFrom 형식이 틀리면 꺼진 것으로 본다
  const reached = () => /^\d{4}-\d{2}-\d{2}$/.test(cfg.collectFrom || "") && today() >= cfg.collectFrom;
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return undefined; } };   // undefined = 저장소 막힘
  const put = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const storageOk = () => get(K_ON) !== undefined;
  const enabled = () => !window.__signingOut && reached() && storageOk() && get(K_ON) !== "off";

  const anon = () => {
    let a = get(K_ANON);
    if (!a || !/^[0-9a-f-]{36}$/.test(a)) { a = crypto.randomUUID(); if (!put(K_ANON, a)) return null; }
    return a;
  };
  const dev = () => { try { return matchMedia("(pointer: coarse)").matches && innerWidth < 900 ? "m" : "d"; } catch (e) { return "d"; } };

  function add(e) {
    try {
      if (!enabled() || stopped || !e || !e.video || !anon()) return;   // anon 번호는 첫 기록 때 만든다
      const row = { eid: crypto.randomUUID().slice(0, 12), at: e.at || Date.now(), video: String(e.video).slice(0, 11), lv: e.lv || null, kind: e.kind };
      for (const f of ["k", "n", "seg", "score", "miss", "sub", "extra", "alt"]) if (e[f] !== undefined) row[f] = e[f];
      queue.push(row);
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    } catch (err) { /* 기록 때문에 공부가 멈추면 안 됨 */ }
  }

  // 한 번에 보낼 줄: 50줄 이하, 숨김 전송(keepalive)이면 본문 60,000바이트 이하 (브라우저 한도 64KB)
  function pick(hidden) {
    const part = [];
    for (const r of queue) {
      if (part.length >= BATCH) break;
      if (hidden && part.length && JSON.stringify(part.concat(r)).length > 60000) break;
      part.push(r);
    }
    return part;
  }

  async function flush(hidden) {
    if (busy || stopped || !queue.length || !enabled()) return;
    const a = anon();
    if (!a) return;
    busy = true;
    try {
      let auth = null;
      if (hidden) auth = lastAuth;   // 모바일은 페이지가 먼저 얼 수 있어 표를 기다리지 않는다
      else {
        try { const t = window.Cloud && await window.Cloud.token(); if (t) auth = lastAuth = "Bearer " + t; else lastAuth = null; } catch (e) {}
      }
      while (queue.length && !stopped && enabled()) {
        const part = pick(hidden);
        const headers = { "Content-Type": "application/json" };
        if (auth) headers.Authorization = auth;
        let r;
        try { r = await fetch(URL_EVENTS, { method: "POST", headers, keepalive: !!hidden, body: JSON.stringify({ anon: a, dev: dev(), events: part }) }); }
        catch (e) { break; }                                     // 네트워크 오류: 다음 주기에 같은 줄을 다시 (eid로 중복 방지)
        if (r.status === 401 && auth) { auth = null; lastAuth = null; continue; } // 만료된 로그인 표: 표 없이 같은 줄을 다시 (이름 없는 기록이라 괜찮음)
        if (r.status >= 500) break;                              // 서버 오류: 다음 주기에 다시
        if (!(r.status >= 200 && r.status < 300) && r.status !== 400) { stopped = true; break; }   // 429·403·401·404·413 등: 이번 방문은 중단, 줄은 보관
        for (let i = queue.length - 1; i >= 0; i--) if (part.includes(queue[i])) queue.splice(i, 1);   // 보낸 줄만 (200/204/400) 비움
      }
    } finally { busy = false; }
  }

  function set(on) {
    put(K_ON, on ? "on" : "off");
    if (!on) queue.length = 0;
    paint();
  }

  // ── 화면: 안내 띠, 변경 공지, 기록 설정 스위치 ──
  const BAR = "display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:8px 16px;font-size:13px;background:#f3efe6;color:#3a352c;border-bottom:1px solid #ddd6c6";
  const BTN = "font:inherit;padding:2px 10px;border-radius:6px;border:1px solid #bdb5a2;background:#fff;color:inherit;cursor:pointer";
  const bar = (id, html) => { const d = document.createElement("div"); d.id = id; d.setAttribute("role", "status"); d.style.cssText = BAR; d.innerHTML = html; document.body.prepend(d); return d; };

  function paint() {
    const t = document.getElementById("collectToggle");
    if (t) {
      const row = document.getElementById("collectRow");
      if (row) row.hidden = !(reached() && storageOk());
      t.checked = enabled();
    }
    const n = document.getElementById("collectNotice");
    if (n && !(reached() && storageOk() && get(K_ON) === null)) n.remove();
  }

  function ui() {
    if (reached() && storageOk() && get(K_ON) === null) {
      const n = bar("collectNotice", '<span>더 나은 학습 자료를 만들기 위해 이름 없는 채점 기록을 모아요.</span> <a href="privacy.html#collect">자세히</a> <button type="button" data-a="off" style="' + BTN + '">끄기</button> <button type="button" data-a="on" style="' + BTN + '">확인</button>');
      n.onclick = ev => { const a = ev.target.dataset && ev.target.dataset.a; if (a) set(a === "on"); };
    }
    // 시행 전에는 첫 화면에만 변경 공지
    if (!reached() && /^\d{4}-\d{2}-\d{2}$/.test(cfg.collectFrom || "") && document.getElementById("grid")) {
      const d = document.createElement("span"); d.textContent = cfg.collectFrom;
      bar("policyNotice", "<span>개인정보처리방침과 이용약관이 " + d.innerHTML + '부터 바뀌어요: 이름 없는 채점 기록 수집, 이용약관 신설.</span> <a href="privacy.html">방침 보기</a>');
    }
    const t = document.getElementById("collectToggle");
    if (t) t.onchange = () => set(t.checked);
    paint();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ui); else ui();
  setInterval(() => { flush(); }, EVERY);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });
  return { add, enabled, set, flush };
})();
