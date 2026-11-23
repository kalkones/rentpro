const USERS = [
  {
    email: "owner@rentpro.test",
    pw: "owner123",
    name: "Pemilik Rental",
    role: "owner",
  },
  {
    email: "admin@rentpro.test",
    pw: "admin123",
    name: "Admin Operasional",
    role: "admin",
  },
];
const K = "rentpro_v1",
  ST = {
    available: "Tersedia",
    rented: "Disewa",
    damaged: "Rusak",
    in_service: "Dalam Servis",
  },
  RS = { active: "Aktif", returned: "Dikembalikan", cancelled: "Dibatalkan" },
  CO = {
    good: "Baik",
    minor_damage: "Rusak Ringan",
    major_damage: "Rusak Berat",
  };
const CHK = [
  "Kondisi fisik/bodi",
  "Kelengkapan aksesori",
  "Fungsi menyala/berjalan",
  "Kebersihan",
];
const SOON_H = 24;
let db = {
    assets: [],
    customers: [],
    rentals: [],
    insp: [],
    fines: [],
    hist: [],
    fs: {},
    seq: 0,
  },
  me = null,
  page = "",
  st = {},
  flash = null;

const save = () => {};
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const idr = (n) => "Rp" + Math.round(n).toLocaleString("id-ID");
const dt = (d) =>
  d
    ? new Date(d).toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "–";
const dur = (m) =>
  m <= 0
    ? "–"
    : `${Math.floor(m / 1440)}h ${Math.floor((m % 1440) / 60)}j ${m % 60}m`;
const bd = (c, t) => `<span class="b ${c}">${t}</span>`;
const asset = (id) => db.assets.find((a) => a.id == id) || {},
  cust = (id) => db.customers.find((c) => c.id == id) || {};
const late = (r) =>
  Math.max(0, Math.floor((Date.now() - new Date(r.due_at)) / 60000));
const ROUTES = {
  owner: [
    "dashboard",
    "assets",
    "rentals",
    "inspections",
    "monitoring",
    "reports",
  ],
  admin: ["assets", "rentals", "inspections"],
};
const NAMES = {
  dashboard: "Dashboard",
  assets: "Inventaris Aset",
  rentals: "Transaksi Sewa",
  inspections: "Riwayat Inspeksi",
  monitoring: "Monitoring & Denda",
  reports: "Laporan",
};

const ck = (r) => {
  if (r.error) throw r.error.message;
  return r.data;
};

async function loadAll() {
  const R = await Promise.all([
    sb.from("assets").select("*").order("code"),
    sb.from("customers").select("*"),
    sb.from("rentals").select("*").order("handed_at"),
    sb.from("inspections").select("*").order("inspected_at"),
    sb.from("fines").select("*"),
    sb.from("fine_settings").select("*").eq("id", 1).single(),
  ]);
  const [a, c, r, i, f, s] = R.map(ck);
  db.assets = a;
  db.customers = c;
  db.rentals = r;
  db.insp = i.map((x) => ({
    id: x.id,
    tx: x.rental_id,
    asset_id: x.asset_id,
    at: x.inspected_at,
    cond: x.condition,
    checklist: x.checklist,
    notes: x.notes,
    res: x.result_status,
  }));
  db.fines = f.map((x) => ({
    id: x.id,
    tx: x.rental_id,
    late: x.late_minutes,
    units: x.units,
    amount: x.amount,
    status: x.status,
  }));
  db.fs = {
    rate: s.rate,
    unit: s.unit,
    grace: s.grace_minutes,
    round: s.round,
    max: s.max_amount,
  };
}
async function startSession() {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) {
    me = null;
    return;
  }
  const { data: p, error: pe } = await sb
    .from("profiles")
    .select("name,role")
    .eq("id", session.user.id)
    .single();
  if (pe || !p) {
    console.error("Gagal baca profil:", pe, "user id:", session.user.id);
    await sb.auth.signOut();
    me = null;
    return;
  }
  me = { email: session.user.email, name: p.name, role: p.role };
  await loadAll();
}
async function login() {
  const { error } = await sb.auth.signInWithPassword({
    email: val("em").trim(),
    password: val("pw"),
  });
  if (error) {
    msg("Email atau kata sandi salah", "e");
    return render();
  }
  await startSession();
  if (!me) {
    msg("Akun belum punya profil peran", "e");
    return render();
  }
  go(me.role == "owner" ? "dashboard" : "rentals");
  render();
}
async function logout() {
  await sb.auth.signOut();
  me = null;
  go("login");
  render();
}

const createRental = (f) =>
  sb
    .rpc("create_rental", {
      p_asset: f.asset,
      p_name: f.name,
      p_phone: f.phone,
      p_ident: f.ident,
      p_address: f.address,
      p_due: new Date(f.due).toISOString(),
      p_price: f.price === "" ? null : +f.price,
      p_notes: f.notes,
    })
    .then(ck);
const processReturn = async (id, f) => {
  const d = ck(
    await sb.rpc("process_return", {
      p_rental: id,
      p_cond: f.cond,
      p_result: f.res,
      p_checklist: f.chk,
      p_notes: f.notes,
    }),
  );
  return { m: d.late_minutes, fs: d.fine_status };
};
const cancelRental = (id, reason) =>
  sb.rpc("cancel_rental", { p_rental: id, p_reason: reason }).then(ck);
async function archiveAsset(id) {
  ck(await sb.from("assets").update({ archived: true }).eq("id", id));
  msg("Aset diarsipkan");
}
async function chStatus(id, s) {
  ck(await sb.from("assets").update({ status: s }).eq("id", id));
  msg("Status diperbarui");
}

(async () => {
  await startSession();
  addEventListener("hashchange", render);
  render();
})();

// Logika denda: tidak ada nilai bawaan, aturan harus diisi Pemilik
function fine(m) {
  const s = db.fs;
  if (s.rate == null || !s.unit || s.grace == null || !s.round)
    return { conf: false };
  const um = s.unit == "hour" ? 60 : 1440,
    bill = Math.max(0, m - s.grace),
    u = s.round == "ceil" ? Math.ceil(bill / um) : Math.floor(bill / um);
  let a = u * s.rate;
  if (s.max != null) a = Math.min(a, s.max);
  return { conf: true, units: u, amount: a, snap: { ...s } };
}

function go(p) {
  location.hash = p;
}
function msg(t, k = "s") {
  flash = { t, k };
}
async function act(fn){
 try{await fn();await loadAll()}
 catch(e){let m=typeof e=='string'?e:(e.message||'Terjadi kesalahan');if(/assets_code_uq/.test(m))m='Kode unit sudah dipakai';msg(m,'e')}
 render()}

function modal(h) {
  document.getElementById("modal").innerHTML = h
    ? `<div class="modal"><div class="card">${h}</div></div>`
    : "";
}
const val = (id) => document.getElementById(id)?.value ?? "";

function render() {
  page = location.hash.slice(1) || "";
  const app = document.getElementById("app");
  if (!me) {
    app.innerHTML = `<div class="login"><div class="card"><h2 style="color:var(--ac)">RentPro</h2><p class="sm">Sistem Informasi Manajemen Aset Rental</p>${fl()}<label for="em">Email</label><input id="em" type="email" style="width:100%" autocomplete="username"><label for="pw">Kata sandi</label><input id="pw" type="password" style="width:100%" autocomplete="current-password" onkeydown="if(event.key=='Enter')login()"><p><button class="p" style="width:100%" onclick="login()">Masuk</button></p><p class="sm">Akun uji: owner@rentpro.test / owner123 · admin@rentpro.test / admin123</p></div></div>`;
    flash = null;
    return;
  }
  const ok = ROUTES[me.role];
  if (!ok.includes(page)) {
    if (page && page != "login") {
      app.innerHTML = shell(
        `<div class="card"><h2>403 – Akses ditolak</h2><p>Peran ${me.role == "owner" ? "Pemilik" : "Admin"} tidak berhak membuka halaman ini.</p></div>`,
      );
      return;
    }
    page = ok[0];
  }
  const v = { dashboard, assets, rentals, inspections, monitoring, reports }[
    page
  ]();
  app.innerHTML = shell(fl() + v);
  flash = null;
}
const fl = () =>
  flash ? `<div class="msg ${flash.k}" role="alert">${esc(flash.t)}</div>` : "";
const shell = (c) =>
  `<div class="shell"><nav><h1>RentPro</h1>${ROUTES[me.role].map((r) => `<a href="#${r}" class="${r == page ? "on" : ""}">${NAMES[r]}</a>`).join("")}<div class="who">${esc(me.name)} (${me.role == "owner" ? "Pemilik" : "Admin"})</div><a href="#" onclick="logout();return false">Keluar</a></nav><main>${c}</main></div>`;

function overdueInfo(r) {
  const m = late(r),
    soon = !m && new Date(r.due_at) - Date.now() <= SOON_H * 3600e3;
  return m > 0
    ? bd("late", "Terlambat")
    : soon
      ? bd("soon", "Jatuh tempo ≤ " + SOON_H + " jam")
      : bd("ok", "Normal");
}
function est(r) {
  const m = late(r);
  if (!m) return "–";
  const f = fine(m);
  return f.conf ? idr(f.amount) + " (estimasi)" : "Menunggu aturan";
}

function dashboard() {
  const A = db.assets.filter((a) => !a.archived),
    n = (s) => A.filter((a) => a.status == s).length,
    act = db.rentals.filter((r) => r.status == "active"),
    od = act.filter((r) => late(r) > 0),
    soon = act.filter(
      (r) => !late(r) && new Date(r.due_at) - Date.now() <= SOON_H * 3600e3,
    );
  const tot = db.fines
      .filter((f) => f.status == "calculated")
      .reduce((s, f) => s + f.amount, 0),
    pend = db.fines.filter((f) => f.status == "pending_rule").length;
  const k = (l, v) =>
    `<div class="card kpi"><b>${v}</b><span>${l}</span></div>`;
  return `<h2>Dashboard</h2><div class="kpis">${k("Tersedia", n("available"))}${k("Disewa", n("rented"))}${k("Rusak", n("damaged"))}${k("Dalam Servis", n("in_service"))}${k("Terlambat", od.length)}${k("Jatuh tempo ≤ " + SOON_H + " jam", soon.length)}${k("Denda final", idr(tot))}${k("Denda menunggu aturan", pend)}</div>
 <div class="card"><h3 style="margin-top:0">Perlu perhatian</h3>${
   [...od, ...soon]
     .slice(0, 10)
     .map(
       (r) =>
         `<div class="row"><div><b>${esc(asset(r.asset_id).code)}</b> ${esc(asset(r.asset_id).name)}<div class="sm">${esc(cust(r.customer_id).name)}</div></div><div>${overdueInfo(r)}<div class="sm">Tenggat ${dt(r.due_at)}</div></div></div>`,
     )
     .join("") ||
   '<div class="empty">Tidak ada transaksi terlambat atau mendekati tenggat.</div>'
 }<a href="#monitoring">Buka Monitoring →</a></div>`;
}

function assets() {
  const adm = me.role == "admin",
    q = (st.aq || "").toLowerCase(),
    fs = st.af || "";
  let L = db.assets.filter(
    (a) =>
      !a.archived &&
      (!fs || a.status == fs) &&
      (a.code + " " + a.name).toLowerCase().includes(q),
  );
  const form =
    adm && st.addA
      ? `<div class="card"><h3 style="margin-top:0">${st.editA ? "Ubah" : "Tambah"} aset</h3><div class="g"><div><label for="ac">Kode unit *</label><input id="ac" value="${esc(st.editA ? asset(st.editA).code : "")}"></div><div><label for="an">Nama *</label><input id="an" value="${esc(st.editA ? asset(st.editA).name : "")}"></div><div><label for="acat">Kategori</label><input id="acat" value="${esc(st.editA ? asset(st.editA).category : "")}"></div><div><label for="ab">Merek</label><input id="ab" value="${esc(st.editA ? asset(st.editA).brand : "")}"></div></div><p><button class="p" onclick="saveAsset()">Simpan</button> <button onclick="st.addA=0;st.editA=null;render()">Batal</button></p></div>`
      : "";
  return `<h2>Inventaris Aset</h2>${form}<div class="bar"><input placeholder="Cari kode/nama" value="${esc(st.aq || "")}" oninput="st.aq=this.value;render();document.querySelector('.bar input').focus()"><select onchange="st.af=this.value;render()"><option value="">Semua status</option>${Object.entries(
    ST,
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${fs == k ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select>${adm ? '<button class="p" onclick="st.addA=1;st.editA=null;render()">+ Tambah aset</button>' : ""}</div>
 <div class="card">${
   L.map(
     (a) =>
       `<div class="row"><div><b>${esc(a.code)}</b> · ${esc(a.name)}<div class="sm">${esc([a.category, a.brand].filter(Boolean).join(" · "))}</div></div><div>${bd(a.status, ST[a.status])}</div>${
         adm
           ? `<div style="text-align:right">${
               a.status != "rented"
                 ? `<select onchange="act(()=>chStatus('${a.id}',this.value))"><option>Ubah status…</option>${[
                     "available",
                     "damaged",
                     "in_service",
                   ]
                     .filter((s) => s != a.status)
                     .map((s) => `<option value="${s}">${ST[s]}</option>`)
                     .join("")}</select> `
                 : ""
             }<button onclick="st.addA=1;st.editA='${a.id}';render()">Ubah</button> ${a.status != "rented" ? `<button class="d" onclick="act(()=>archiveAsset('${a.id}'))">Arsipkan</button>` : ""}</div>`
           : ""
       }</div>`,
   ).join("") ||
   '<div class="empty">Belum ada aset. ' +
     (adm ? "Tambahkan aset pertama." : "") +
     "</div>"
 }</div>`;
}
function chStatus(id, s) {
  const a = asset(id);
  if (a.status == "rented") throw "Status Disewa hanya berubah lewat transaksi";
  setAsset(a, s, null);
  save();
  msg("Status diperbarui");
}
function saveAsset() {
  act(async () => {
    const c = val("ac").trim(),
      n = val("an").trim();
    if (!c || !n) throw "Kode dan nama wajib diisi";
    const row = { code: c, name: n, category: val("acat"), brand: val("ab") };
    ck(
      st.editA
        ? await sb.from("assets").update(row).eq("id", st.editA)
        : await sb.from("assets").insert(row),
    );
    st.addA = 0;
    st.editA = null;
    msg("Aset tersimpan");
  });
}

function rentals() {
  if (st.ret) return retForm();
  const adm = me.role == "admin",
    fs = st.rf || "";
  let L = db.rentals
    .filter((r) => !fs || r.status == fs)
    .slice()
    .reverse();
  const av = db.assets.filter((a) => !a.archived && a.status == "available");
  const form =
    adm && st.newR
      ? `<div class="card"><h3 style="margin-top:0">Serah terima baru</h3><div class="g"><div><label for="ra">Unit * (hanya Tersedia)</label><select id="ra">${av.map((a) => `<option value="${a.id}">${esc(a.code)} – ${esc(a.name)}</option>`).join("") || '<option value="">Tidak ada unit tersedia</option>'}</select></div><div><label for="rn">Nama penyewa *</label><input id="rn"></div><div><label for="rp">No. HP *</label><input id="rp" type="tel"></div><div><label for="ri">No. identitas</label><input id="ri"></div><div><label for="rad">Alamat</label><input id="rad"></div><div><label for="rd">Tenggat *</label><input id="rd" type="datetime-local"></div><div><label for="rpr">Harga sewa (opsional)</label><input id="rpr" type="number" min="0"></div><div><label for="rno">Catatan</label><input id="rno"></div></div><p><button class="p" onclick="saveRental()">Catat Serah Terima</button> <button onclick="st.newR=0;render()">Batal</button></p></div>`
      : "";
  return `<h2>Transaksi Sewa</h2>${form}<div class="bar"><select onchange="st.rf=this.value;render()"><option value="">Semua status</option>${Object.entries(
    RS,
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${fs == k ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select>${adm ? '<button class="p" onclick="st.newR=1;render()">+ Serah terima baru</button>' : ""}</div>
 <div class="card">${L.map((r) => `<div class="row"><div><b>${r.code}</b><div class="sm">${esc(asset(r.asset_id).code)} · ${esc(cust(r.customer_id).name)} (${esc(cust(r.customer_id).phone)})</div></div><div>${bd(r.status, RS[r.status])} ${r.status == "active" ? overdueInfo(r) : ""}<div class="sm">Tenggat ${dt(r.due_at)}${r.returned_at ? " · Kembali " + dt(r.returned_at) : ""}</div>${r.cancel_reason ? `<div class="sm">Alasan batal: ${esc(r.cancel_reason)}</div>` : ""}</div>${adm && r.status == "active" ? `<div><button class="p" onclick="st.ret='${r.id}';render()">Catat Pengembalian</button> <button class="d" onclick="askCancel('${r.id}')">Batalkan</button></div>` : ""}</div>`).join("") || '<div class="empty">Belum ada transaksi.</div>'}</div>`;
}
function saveRental() {
  act(async () => {
    await createRental({
      asset: val("ra"),
      name: val("rn"),
      phone: val("rp"),
      ident: val("ri"),
      address: val("rad"),
      due: val("rd"),
      price: val("rpr"),
      notes: val("rno"),
    });
    st.newR = 0;
    msg("Serah terima tercatat");
  });
}
function askCancel(id) {
  modal(
    `<h3 style="margin-top:0">Batalkan transaksi</h3><label for="cr">Alasan (wajib)</label><input id="cr" style="width:100%"><p><button class="d" onclick="const r=val('cr');modal('');act(async()=>{await cancelRental('${id}',r);msg('Transaksi dibatalkan')})">Batalkan transaksi</button> <button onclick="modal('')">Tutup</button></p>`,
  );
}
function retForm() {
  const r = db.rentals.find((x) => x.id == st.ret),
    m = late(r);
  return `<h2>Pengembalian &amp; Inspeksi</h2><div class="card"><b>${r.code}</b> · ${esc(asset(r.asset_id).code)} ${esc(asset(r.asset_id).name)}<div class="sm">Penyewa ${esc(cust(r.customer_id).name)} · Tenggat ${dt(r.due_at)}</div>${m ? `<p>${bd("late", "Terlambat " + dur(m))} Estimasi denda: ${est(r)}</p>` : ""}</div>
 <div class="card"><h3 style="margin-top:0">Checklist</h3>${CHK.map((c, i) => `<div class="row"><div>${c}</div><div><select id="k${i}"><option value="ok">OK</option><option value="bermasalah">Bermasalah</option></select> <input id="kn${i}" placeholder="Catatan"></div></div>`).join("")}
 <div class="g"><div><label for="co">Kondisi keseluruhan</label><select id="co">${Object.entries(
   CO,
 )
   .map(([k, v]) => `<option value="${k}">${v}</option>`)
   .join(
     "",
   )}</select></div><div><label for="rs">Status unit setelahnya</label><select id="rs"><option value="available">Tersedia</option><option value="damaged">Rusak</option><option value="in_service">Dalam Servis</option></select></div></div><label for="no">Catatan</label><textarea id="no" style="width:100%"></textarea>
 <p class="sm">Pengembalian tidak dapat dibatalkan setelah diselesaikan.</p><button class="p" onclick="doReturn()">Selesaikan Pengembalian</button> <button onclick="st.ret=null;render()">Kembali</button></div>`;
}
function doReturn() {
  act(async () => {
    const chk = CHK.map((c, i) => ({
      label: c,
      result: val("k" + i),
      note: val("kn" + i),
    }));
    const x = await processReturn(st.ret, {
      cond: val("co"),
      res: val("rs"),
      chk,
      notes: val("no"),
    });
    st.ret = null;
    const fm = {
      none: "tanpa denda",
      pending_rule: "denda menunggu aturan (belum ditetapkan Pemilik)",
      calculated: "denda final tercatat",
      within_grace: "dalam masa toleransi, tanpa denda",
    }[x.fs];
    msg(
      "Pengembalian selesai: " +
        (x.m ? "terlambat " + dur(x.m) + ", " : "tepat waktu, ") +
        fm,
    );
  });
}


function inspections() {
  const L = db.insp.slice().reverse();
  return `<h2>Riwayat Inspeksi</h2><div class="card">${
    L.map((i) => {
      const r = db.rentals.find((x) => x.id == i.tx) || {};
      return `<div class="row"><div><b>${esc(asset(i.asset_id).code)}</b> ${esc(asset(i.asset_id).name)}<div class="sm">${r.code} · ${dt(i.at)} · oleh ${esc(i.by)}</div><div class="sm">${i.checklist.map((c) => esc(c.label) + ": " + (c.result == "ok" ? "OK" : "Bermasalah") + (c.note ? " (" + esc(c.note) + ")" : "")).join(" · ")}</div>${i.notes ? `<div class="sm">Catatan: ${esc(i.notes)}</div>` : ""}</div><div>${bd(i.cond == "good" ? "ok" : i.cond == "minor_damage" ? "soon" : "late", CO[i.cond])} ${bd(i.res, ST[i.res])}</div></div>`;
    }).join("") || '<div class="empty">Belum ada inspeksi.</div>'
  }</div>`;
}

function monitoring() {
  const t = st.mt || "a",
    s = db.fs,
    conf = s.rate != null && s.unit && s.grace != null && s.round;
  const act = db.rentals
    .filter((r) => r.status == "active")
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  const tab =
    t == "a"
      ? `<div class="card">${act.map((r) => `<div class="row" ${late(r) ? 'style="background:var(--erb)"' : ""}><div><b>${r.code}</b> ${esc(asset(r.asset_id).code)} ${esc(asset(r.asset_id).name)}<div class="sm">${esc(cust(r.customer_id).name)} · ${esc(cust(r.customer_id).phone)}</div></div><div>${overdueInfo(r)}<div class="sm">Tenggat ${dt(r.due_at)}${late(r) ? " · lewat " + dur(late(r)) : ""}</div></div><div>${est(r)}</div></div>`).join("") || '<div class="empty">Tidak ada transaksi aktif.</div>'}</div>`
      : `<div class="card">${
          db.fines
            .slice()
            .reverse()
            .map((f) => {
              const r = db.rentals.find((x) => x.id == f.tx) || {};
              return `<div class="row"><div><b>${r.code}</b><div class="sm">${esc(asset(r.asset_id).code)} · terlambat ${dur(f.late)}</div></div><div>${bd(f.status, f.status == "calculated" ? "Final" : "Menunggu Aturan")}</div><div>${f.amount != null ? idr(f.amount) : "–"}</div></div>`;
            })
            .join("") || '<div class="empty">Belum ada denda.</div>'
        }</div>`;
  return `<h2>Monitoring Tenggat &amp; Denda</h2>${conf ? "" : '<div class="msg w">Aturan denda belum ditetapkan – denda ditandai Menunggu Aturan.</div>'}<div class="bar tabs"><button class="${t == "a" ? "on" : ""}" onclick="st.mt='a';render()">Aktif</button><button class="${t == "f" ? "on" : ""}" onclick="st.mt='f';render()">Denda</button></div>${tab}
 <details class="card" ${conf ? "" : "open"}><summary><b>Pengaturan aturan denda</b></summary><div class="g"><div><label for="fr">Tarif (Rp)</label><input id="fr" type="number" min="0" value="${s.rate ?? ""}"></div><div><label for="fu">Per</label><select id="fu"><option value="hour" ${s.unit == "hour" ? "selected" : ""}>Jam</option><option value="day" ${s.unit == "day" ? "selected" : ""}>Hari</option></select></div><div><label for="fg">Toleransi (menit)</label><input id="fg" type="number" min="0" value="${s.grace ?? ""}"></div><div><label for="fo">Pembulatan</label><select id="fo"><option value="ceil" ${s.round == "ceil" ? "selected" : ""}>Ke atas</option><option value="floor" ${s.round == "floor" ? "selected" : ""}>Ke bawah</option></select></div><div><label for="fm">Batas maksimum (opsional)</label><input id="fm" type="number" min="0" value="${s.max ?? ""}"></div></div><p><button class="p" onclick="saveFS()">Simpan aturan</button> <button onclick="act(recalc)">Hitung ulang denda tertunda</button></p></details>`;
}
function saveFS() {
  act(async () => {
    if (val("fr") === "" || val("fg") === "")
      throw "Tarif dan toleransi wajib diisi";
    ck(
      await sb
        .from("fine_settings")
        .update({
          rate: +val("fr"),
          unit: val("fu"),
          grace_minutes: +val("fg"),
          round: val("fo"),
          max_amount: val("fm") === "" ? null : +val("fm"),
        })
        .eq("id", 1),
    );
    msg("Aturan denda disimpan");
  });
}
async function recalc() {
  const n = ck(await sb.rpc("recalc_pending_fines"));
  msg(n + " denda tertunda dihitung ulang");
}

function reports() {
  const f = st.rp || {};
  let L = db.rentals
    .filter(
      (r) =>
        (!f.s || r.status == f.s) &&
        (!f.from || r.handed_at >= new Date(f.from).toISOString()) &&
        (!f.to || r.handed_at <= new Date(f.to + "T23:59:59").toISOString()),
    )
    .map((r) => ({
      r,
      fn: db.fines.find((x) => x.tx == r.id),
      ins: db.insp.find((x) => x.tx == r.id),
      wl:
        r.status == "returned" && new Date(r.returned_at) > new Date(r.due_at),
    }))
    .filter((x) => !f.late || x.wl)
    .reverse();
  const tot = L.reduce(
    (s, x) => s + (x.fn && x.fn.status == "calculated" ? x.fn.amount : 0),
    0,
  );
  return `<h2>Laporan Transaksi Sewa</h2><div class="bar"><input type="date" id="pf" value="${f.from || ""}" aria-label="Dari"><input type="date" id="pt" value="${f.to || ""}" aria-label="Sampai"><select id="ps"><option value="">Semua status</option>${Object.entries(
    RS,
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${f.s == k ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select><label style="margin:0;display:flex;align-items:center;gap:6px"><input type="checkbox" id="pl" ${f.late ? "checked" : ""}>Terlambat saja</label><button class="p" onclick="st.rp={from:val('pf'),to:val('pt'),s:val('ps'),late:document.getElementById('pl').checked};render()">Terapkan</button></div>
 <div class="kpis"><div class="card kpi"><b>${L.length}</b><span>Transaksi</span></div><div class="card kpi"><b>${L.filter((x) => x.wl).length}</b><span>Terlambat</span></div><div class="card kpi"><b>${idr(tot)}</b><span>Total denda final</span></div></div>
 <div class="card">${L.map(({ r, fn, ins, wl }) => `<div class="row"><div><b>${r.code}</b><div class="sm">${esc(asset(r.asset_id).code)} · ${esc(cust(r.customer_id).name)}</div></div><div class="sm">Serah ${dt(r.handed_at)}<br>Tenggat ${dt(r.due_at)}<br>Kembali ${dt(r.returned_at)}</div><div>${bd(r.status, RS[r.status])} ${wl ? bd("late", "Terlambat") : ""}${ins ? '<div class="sm">' + CO[ins.cond] + "</div>" : ""}</div><div>${fn ? (fn.amount != null ? idr(fn.amount) : "Menunggu aturan") : "–"}</div></div>`).join("") || '<div class="empty">Tidak ada data sesuai filter.</div>'}</div>`;
}
