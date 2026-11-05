/* 계정 저장 창구 (웹판) — Supabase 로그인 + 진도 + 영상 요청.
   설정(config.js)이 비어 있거나 supabase-js를 못 불러오면 Cloud는 null → 기기에만 저장. */
window.Cloud = (() => {
  const cfg = window.CLOUD_CONFIG;
  if (!cfg || !cfg.url || !cfg.anonKey || !window.supabase) return null;
  const sb = window.supabase.createClient(cfg.url, cfg.anonKey);
  const PREFIX = "dictation:v2:";
  const YT_RE = /^https:\/\/(www\.|m\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[A-Za-z0-9_-]{11}([&?][A-Za-z0-9_=&%.-]*)?$/;   // schema.sql과 같은 규칙
  const CLOUD_EVENTS = 500;   // 계정에는 최근 채점 기록 500개만 (기기에는 3000개까지) — 한 줄 512KB 제한 안쪽
  const slim = d => d && Array.isArray(d.events) && d.events.length > CLOUD_EVENTS ? { ...d, events: d.events.slice(-CLOUD_EVENTS) } : d;
  let user = null;
  const rows = async q => { const { data, error } = await q; if (error) throw error; return data || []; };
  const C = {
    async init() {
      try {
        const { data } = await sb.auth.getSession();
        const u = data && data.session && data.session.user;
        user = u ? { id: u.id, email: u.email || "" } : null;
      } catch (e) { user = null; }
      return user;
    },
    user: () => user,
    signIn: () => sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href } }),
    async signOut() { try { await sb.auth.signOut(); } finally { location.reload(); } },
    async load(key) {
      const r = await rows(sb.from("progress").select("data").eq("video_id", key));
      return r.length ? r[0].data : null;
    },
    async save(key, data) {
      if (!user) return false;
      try {
        const { error } = await sb.from("progress").upsert({ user_id: user.id, video_id: key, data: slim(data), updated_at: new Date().toISOString() });
        return !error;
      } catch (e) { return false; }
    },
    /* 저장할 때마다: 계정 진도를 먼저 읽어 합친 뒤 저장 (다른 기기·탭에서 푼 것을 덮어쓰지 않게).
       합친 결과를 돌려준다. 실패하면 null (이 기기 저장은 이미 끝난 상태). */
    async sync(key, data, merge) {
      if (!user) return null;
      try {
        const m = merge(await C.load(key), data);
        const { error } = await sb.from("progress").upsert({ user_id: user.id, video_id: key, data: slim(m), updated_at: new Date().toISOString() });
        return error ? null : m;
      } catch (e) { return null; }
    },
    async loadAll() {
      const r = await rows(sb.from("progress").select("video_id,data"));
      return Object.fromEntries(r.map(x => [x.video_id, x.data]));
    },
    /* 로그인 직후: 이 기기의 모든 진도(빈칸 단계 포함)와 계정 진도를 합쳐 양쪽에 저장 */
    async mergeAll(merge) {
      const cloud = await C.loadAll();
      const local = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) try { local[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k)); } catch (e) {}
      }
      for (const key of new Set([...Object.keys(cloud), ...Object.keys(local)])) {
        const m = merge(cloud[key] || null, local[key] || null);
        if (!m) continue;
        try { localStorage.setItem(PREFIX + key, JSON.stringify(m)); } catch (e) {}
        if (JSON.stringify(m) !== JSON.stringify(cloud[key])) await C.save(key, m);
      }
    },
    /* 영상 요청: 유튜브 링크 + 한 줄 메모. 이 브라우저에서 하루 3번까지 */
    async request(url, note) {
      url = String(url || "").trim(); note = String(note || "").trim().slice(0, 200);
      if (!YT_RE.test(url)) return { ok: false, error: "유튜브 영상 링크를 넣어 주세요 (예: https://youtu.be/…)" };
      const day = "dictation:req:" + new Date().toISOString().slice(0, 10);
      let n = 0; try { n = +(localStorage.getItem(day) || 0); } catch (e) {}
      if (n >= 3) return { ok: false, error: "오늘은 요청을 3번까지 보낼 수 있어요. 내일 다시 보내 주세요" };
      try {
        const { error } = await sb.from("requests").insert({ url, note });
        if (error) return { ok: false, error: /잠시 후/.test(error.message || "") ? error.message : "요청을 보내지 못했어요. 잠시 후 다시 해 주세요" };
      } catch (e) { return { ok: false, error: "요청을 보내지 못했어요. 인터넷 연결을 확인해 주세요" }; }
      try { localStorage.setItem(day, String(n + 1)); } catch (e) {}
      return { ok: true };
    },
  };
  return C;
})();
