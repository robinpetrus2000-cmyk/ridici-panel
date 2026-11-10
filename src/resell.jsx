// Resell tracker pro Řídicí panel R.P.
// Zdroják: src/resell.jsx → zkompilováno do resell.js (React z CDN, žádný build na GitHubu není potřeba).
const { useState, useEffect, useMemo, useRef, useCallback } = React;

const BUCKET = "resell-photos";
const SIZES = ["XS", "S", "M", "L", "XL"];
const STATUSES = ["K prodeji", "Inzerováno", "Prodáno"];
const PROMOS = ["Žádné", "Vinted", "Facebook"];
const CONDITIONS = [
  "Nový s visačkou",
  "Nový / nenošený",
  "Nošené, ale ve velmi dobrém stavu",
  "Nošené, v dobrém stavu",
  "S drobnou vadou (viz fotky)",
];
const ROLE_KEY = "rpresell.role";
const CACHE_KEY = "rpresell.items";
const FILTER_KEY = "rpresell.filter";
const ARCHIVE_DAYS = 30; // po kolika dnech od prodeje jde věc do tabulky a smaže se jí fotka

// Pevné části inzerátu. Změň tady a projeví se ve všech nových inzerátech.
const LISTING_PROMO = "Mrkněte na slevy na sety 🔥🔥";
const LISTING_SHIPPING =
  "Posílám přes Zásilkovnu (+89 Kč) / AlzaBox (+54 Kč) / nebo osobní předání u metra Ládví, konkrétní dny metro Budějovická / dohoda.";

const store = {
  get(k) {
    try {
      const r = localStorage.getItem(k);
      return r == null ? undefined : JSON.parse(r);
    } catch {
      return undefined;
    }
  },
  set(k, v) {
    try {
      v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

function Ico({ name, size = 16, ...p }) {
  const L = window.LucideReact || window.lucideReact || {};
  const C = L[name];
  return C ? <C size={size} strokeWidth={1.9} aria-hidden="true" {...p} /> : null;
}

// ---------- výpočty ----------
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const round2 = (v) => Math.round(v * 100) / 100;

function netProfit(i) {
  const promo = i.promo_channel === "Žádné" ? 0 : num(i.promo_amount) || 0;
  return round2((num(i.sale_price) || 0) - (num(i.purchase_price) || 0) - promo - (num(i.shipping) || 0));
}

function summarize(items) {
  const sold = items.filter((i) => i.status === "Prodáno");
  return { soldCount: sold.length, totalProfit: round2(sold.reduce((s, i) => s + netProfit(i), 0)) };
}

function uniqueBrands(items) {
  const m = new Map();
  for (const { brand } of items) {
    const label = (brand || "").trim();
    if (!label) continue;
    const k = label.toLocaleLowerCase("cs");
    const e = m.get(k);
    e ? e.count++ : m.set(k, { label, count: 1 });
  }
  return [...m.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "cs"))
    .map((e) => e.label);
}

// ---------- archiv ----------
const localDate = (d = new Date()) => d.toLocaleDateString("sv");
function archiveCutoff() {
  const d = new Date();
  d.setDate(d.getDate() - ARCHIVE_DAYS);
  return localDate(d);
}
// Prodané před víc než měsícem (a starší prodeje bez data) patří do tabulky.
const isArchived = (i, cutoff) => i.status === "Prodáno" && (!i.sold_at || i.sold_at <= cutoff);
const shortDate = (iso) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "2-digit" }) : "—");

// ---------- inzerát ----------
const cap = (s) => (s ? s.charAt(0).toLocaleUpperCase("cs") + s.slice(1) : s);
const cleanName = (s) => (s || "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();

const TYPE_LINES = [
  [/rolák/, "Skvěle doplní šatník v chladnějších dnech. Je z příjemného a hřejivého materiálu, který zajistí maximální pohodlí při celodenním nošení."],
  [/mikin/, "Ideální na každý den i na chladnější večery. Měkký a příjemný materiál zajistí pohodlí při celodenním nošení."],
  [/svetr/, "Zahřeje v chladných dnech a hodí se do práce, do školy i na volno."],
  [/polo/, "Klasický střih s límečkem, hodí se na běžné nošení i do společnosti."],
  [/košil/, "Hodí se do práce, na oslavu i na běžné nošení."],
  [/šortk|kraťas/, "Ideální na běh, do posilovny nebo na běžné letní nošení. Lehký a rychleschnoucí materiál zajistí maximální pohodlí při každém pohybu."],
  [/legín/, "Pružný materiál drží tvar a nikde neškrtí, ideální na cvičení i volný čas."],
  [/top/, "Pohodlný na cvičení i na běžné nošení."],
  [/trik|tričk/, "Lehký a příjemný materiál, dobře se nosí samotné i pod mikinu."],
  [/bund|kabát/, "Spolehlivě ochrání před větrem a chladem a hodí se ke všemu."],
  [/kalhot|teplák/, "Pohodlný střih na každý den."],
];

function listingTitle(f) {
  const base = cap(cleanName(f.name)) || "Oblečení";
  const brand = f.brand.trim();
  return [base, brand && !base.toLowerCase().includes(brand.toLowerCase()) ? brand : "", f.size ? "vel. " + f.size : ""]
    .filter(Boolean)
    .join(" ");
}

// 4. pád pro „Prodám …“: mění se jen ženský rod (pánská mikina → pánskou mikinu),
// mužský neživotný, střední rod i množné číslo zůstávají stejné.
function accusative(phrase) {
  const words = phrase.split(" ");
  const last = words.length ? words[words.length - 1] : "";
  if (!/[^aeiouyáéíóúůý]a$/i.test(last)) return phrase;
  return words.map((w, i) => (i === words.length - 1 ? w.slice(0, -1) + "u" : w.replace(/á$/, "ou"))).join(" ");
}

// platform: "vinted" (předloha s rolákem) nebo "fb" (předloha s kraťasy)
function listingText(f, platform) {
  const name = cleanName(f.name).toLocaleLowerCase("cs");
  const brand = f.brand.trim();
  const isSet = /\bset\b|sada/.test(name);
  const typeLine = (TYPE_LINES.find(([re]) => re.test(name)) || [null, "Pohodlný a dobře padnoucí kousek na každý den."])[1];
  const setLine = isSet ? " Lze je zakoupit po jednom kusu nebo jako celou výhodnou sadu." : "";
  const what = (name || "oblečení") + (brand ? " od značky " + brand : "");

  const spec = [
    ["Značka", brand],
    ["Velikost", f.size],
    ["Barva", f.color.trim()],
    ["Materiál", f.material.trim()],
    ["Střih", f.fit.trim()],
    ["Stav", f.condition],
  ].filter(([, v]) => v);

  if (platform === "fb") {
    const price = parse(f.listPrice);
    return [
      `Prodám ${accusative(name || "oblečení")}${brand ? " od značky " + brand : ""}. ${typeLine}${setLine}`,
      "",
      "Specifikace:",
      ...spec.map(([k, v]) => `• ${k}: ${v}`),
      "",
      "📦 Doprava a cena:",
      LISTING_SHIPPING,
      price !== null ? `Cena: ${fmt.format(price)} Kč` : "Cena: … Kč",
    ].join("\n");
  }

  // Vinted: dopravu i cenu řeší Vinted sám
  return [`${cap(what)}. ${typeLine}${setLine}`, LISTING_PROMO, "", "Specifikace:", ...spec.map(([k, v]) => `${k}: ${v}`)].join("\n");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  }
}

const fmt = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 });
const fmtSigned = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2, signDisplay: "exceptZero" });
const czk = (v) => fmt.format(v) + " Kč";
const czkSigned = (v) => fmtSigned.format(v).replace("-", "−") + " Kč";
const toneColor = (v) => (v > 0 ? "var(--ok)" : v < 0 ? "var(--danger)" : "var(--fg)");

// ---------- fotky ----------
async function compressImage(file) {
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
    return blob || file;
  } catch {
    return file;
  }
}

const photoUrl = (client, path) => (path ? client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null);

async function uploadPhoto(client, file) {
  const blob = await compressImage(file);
  const ext = blob.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "img").toLowerCase();
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const path = `${id}.${ext}`;
  const { error } = await client.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: blob.type || file.type, cacheControl: "31536000", upsert: false });
  if (error) throw error;
  return path;
}

async function removePhoto(client, path) {
  if (!path) return;
  const { error } = await client.storage.from(BUCKET).remove([path]);
  if (error) console.warn("Fotku se nepodařilo smazat", error);
}

// ---------- role: owner = ty, member = Lucka ----------
// Vrací "owner" | "member" | "none" | "loading". Role se pamatuje v zařízení,
// aby Lucka po otevření ani na okamžik neviděla zbytek panelu.
function useRole(client, user) {
  const [role, setRole] = useState(() => (store.get(ROLE_KEY) || {}).role || "none");
  const seenUser = useRef(false);

  useEffect(() => {
    if (!client) return;
    if (!user) {
      if (seenUser.current) {
        seenUser.current = false;
        store.set(ROLE_KEY, undefined);
        setRole("none");
      }
      return;
    }
    seenUser.current = true;
    const cached = store.get(ROLE_KEY);
    if (!cached || cached.uid !== user.id) setRole("loading");
    let alive = true;
    const load = async () => {
      const { data, error } = await client.from("resell_members").select("role").eq("user_id", user.id).maybeSingle();
      if (!alive) return;
      if (error) {
        if (!cached || cached.uid !== user.id) setRole("none");
        return;
      }
      const r = data ? data.role : "none";
      store.set(ROLE_KEY, { uid: user.id, role: r });
      setRole(r);
    };
    load();
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [client, user && user.id]);

  return role;
}

// ---------- data ----------
function useItems(client, enabled) {
  const [items, setItems] = useState(() => store.get(CACHE_KEY) || null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!client || !enabled) return;
    const { data, error } = await client.from("resell_items").select("*").order("created_at", { ascending: false });
    if (error) {
      setError(
        navigator.onLine
          ? "Položky se nenačetly: " + error.message
          : "Jsi offline. Ukazuju poslední stažený stav, úpravy půjdou po připojení."
      );
      return;
    }
    setError("");
    setItems(data);
    store.set(CACHE_KEY, data);
  }, [client, enabled]);

  useEffect(() => {
    if (!client || !enabled) return;
    load();
    const ch = client
      .channel("resell-items")
      .on("postgres_changes", { event: "*", schema: "public", table: "resell_items" }, () => load())
      .subscribe();
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", load);
    return () => {
      client.removeChannel(ch);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", load);
    };
  }, [client, enabled, load]);

  return { items, error, reload: load };
}

// ---------- UI ----------
const STATUS_CHIP = { "K prodeji": "chip", Inzerováno: "chip chip-mid", Prodáno: "chip chip-ok" };

function useHeaderOffset() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = document.querySelector("header");
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    setH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  return h;
}

function Stats({ soldCount, totalProfit, inStock }) {
  const top = useHeaderOffset();
  return (
    <div
      className="sticky z-10 -mx-4 px-4 py-3 mb-5 sm:mx-0 sm:px-0"
      style={{ top: `calc(env(safe-area-inset-top, 0px) + ${top}px)`, background: "var(--bg)" }}
    >
      <div
        className="card px-4 py-3 flex items-end justify-between gap-4"
        style={{ borderColor: totalProfit < 0 ? "var(--danger)" : totalProfit > 0 ? "#2a6b43" : "var(--line)" }}
      >
        <div className="min-w-0">
          <div className="text-sm text-muted">{totalProfit < 0 ? "Celková ztráta" : "Celkový profit"}</div>
          <div
            className="font-display font-bold tnum leading-none truncate"
            style={{ fontSize: "clamp(2rem, 9vw, 3.25rem)", color: toneColor(totalProfit) }}
          >
            {czkSigned(totalProfit)}
          </div>
        </div>
        <div className="flex gap-5 shrink-0 text-right">
          <div>
            <div className="font-display text-3xl font-bold tnum leading-none">{soldCount}</div>
            <div className="text-sm text-muted">prodáno</div>
          </div>
          <div className="hidden sm:block">
            <div className="font-display text-3xl font-bold tnum leading-none text-muted">{inStock}</div>
            <div className="text-sm text-muted">skladem</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemCard({ item, client, onOpen }) {
  const sold = item.status === "Prodáno";
  const profit = netProfit(item);
  const url = photoUrl(client, item.photo_path);
  return (
    <button type="button" onClick={onOpen} className="card overflow-hidden text-left flex flex-col min-w-0 hover:border-muted">
      <div className="relative w-full" style={{ aspectRatio: "4 / 5", background: "var(--panel2)" }}>
        {url ? (
          <img
            src={url}
            alt={`${item.brand} ${item.name}`}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            style={sold ? { filter: "grayscale(1)", opacity: 0.55 } : undefined}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center p-3">
            <span className="font-display text-2xl font-bold text-center break-words" style={{ color: "var(--line)" }}>
              {item.brand}
            </span>
          </div>
        )}
        <span className={STATUS_CHIP[item.status] + " absolute left-2 bottom-2"} style={{ background: sold ? undefined : "var(--bg)" }}>
          {item.status}
        </span>
        {item.size && (
          <span className="chip absolute right-2 top-2" style={{ background: "var(--bg)", color: "var(--fg)" }}>
            {item.size}
          </span>
        )}
      </div>
      <div className="p-3 flex flex-col gap-0.5 min-w-0">
        <div className="font-semibold truncate">{item.brand}</div>
        {item.name && <div className="text-sm text-muted truncate">{item.name}</div>}
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 mt-1 text-sm tnum">
          <span className="text-muted">
            {czk(num(item.purchase_price) || 0)}
            {item.sale_price != null && ` → ${czk(num(item.sale_price))}`}
          </span>
          {(sold || item.sale_price != null) && (
            <span className="font-semibold" style={{ color: toneColor(profit) }}>
              {czkSigned(profit)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", k);
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto gutter"
      style={{
        background: "rgba(4,7,11,.72)",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 24px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
      }}
      onClick={onClose}
    >
      <div
        className="card p-5 max-w-lg mx-auto flex flex-col gap-4"
        style={{ background: "var(--panel)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Zavřít">
            <Ico name="X" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const today = () => new Date().toLocaleDateString("sv");
const toInput = (v) => (v === null || v === undefined ? "" : String(num(v)));
const parse = (v) => (String(v).trim() === "" ? null : Number(String(v).replace(",", ".")));

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 min-w-0 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}

function ItemForm({ item, client, brands, onClose }) {
  const [f, setF] = useState(() => ({
    name: item ? item.name : "",
    brand: item ? item.brand : "",
    size: item && item.size ? item.size : "",
    purchase: toInput(item && item.purchase_price),
    sale: toInput(item && item.sale_price),
    status: item ? item.status : "K prodeji",
    channel: item ? item.promo_channel : "Žádné",
    promo: item && num(item.promo_amount) ? toInput(item.promo_amount) : "",
    shipping: item && num(item.shipping) ? toInput(item.shipping) : "",
    boughtAt: item ? item.bought_at || "" : today(),
    soldAt: item && item.sold_at ? item.sold_at : "",
    color: (item && item.color) || "",
    material: (item && item.material) || "",
    fit: (item && item.fit) || "",
    condition: (item && item.condition) || "",
    listPrice: toInput(item && item.list_price),
  }));
  const set = (k) => (e) => {
    const value = e.target.value;
    setF((p) => ({
      ...p,
      [k]: value,
      // Při přepnutí na Prodáno se datum prodeje vyplní dnešním dnem
      ...(k === "status" && value === "Prodáno" && !p.soldAt ? { soldAt: today() } : {}),
    }));
    setError("");
  };
  // Inzerát: dokud ho neupravíš ručně, generuje se z polí formuláře
  const [platform, setPlatform] = useState("vinted");
  const [own, setOwn] = useState(() => ({
    vinted: (item && item.listing_text) || null,
    fb: (item && item.listing_fb_text) || null,
  }));
  const listingEdited = own[platform] !== null;
  const [copied, setCopied] = useState("");
  const listing = listingEdited ? own[platform] : listingText(f, platform);
  const title = listingTitle(f);
  const archived = !!item && isArchived({ status: f.status, sold_at: f.soldAt || null }, archiveCutoff());
  const copy = async (what, text) => {
    if (await copyText(text)) {
      setCopied(what);
      setTimeout(() => setCopied(""), 1500);
    }
  };
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [brandFocus, setBrandFocus] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const suggestions = useMemo(() => {
    const t = f.brand.trim().toLocaleLowerCase("cs");
    return brands
      .filter((b) => {
        const l = b.toLocaleLowerCase("cs");
        return l !== t && l.includes(t);
      })
      .slice(0, 6);
  }, [f.brand, brands]);

  const sale = parse(f.sale);
  const profit = netProfit({
    purchase_price: parse(f.purchase) || 0,
    sale_price: sale,
    promo_channel: f.channel,
    promo_amount: parse(f.promo) || 0,
    shipping: parse(f.shipping) || 0,
  });
  const shown = preview || (photoRemoved ? null : photoUrl(client, item && item.photo_path));

  function problem() {
    if (!f.brand.trim()) return "Vyplň značku.";
    const purchase = parse(f.purchase);
    if (purchase === null) return "Vyplň nákupní cenu.";
    if (f.status === "Prodáno" && sale === null) return "U prodané položky vyplň prodejní cenu.";
    if (f.channel !== "Žádné" && parse(f.promo) === null) return "Vyplň částku za promo.";
    if ([purchase, sale, parse(f.promo), parse(f.shipping), parse(f.listPrice)].some((n) => n !== null && (!Number.isFinite(n) || n < 0)))
      return "Částky musí být čísla od nuly výš.";
    if (!navigator.onLine) return "Jsi offline. Ulož to, až budeš připojený.";
    return null;
  }

  async function save(e) {
    e.preventDefault();
    const p = problem();
    if (p) return setError(p);
    const oldPath = item ? item.photo_path : null;
    let newPath = null;
    try {
      if (file) {
        setBusy("Nahrávám fotku…");
        newPath = await uploadPhoto(client, file);
      }
      setBusy("Ukládám…");
      // Prodané před víc než měsícem fotku nepotřebují
      const photo_path = archived ? null : newPath || (photoRemoved ? null : oldPath);
      const data = {
        photo_path,
        name: f.name.trim(),
        brand: f.brand.trim(),
        size: f.size || null,
        purchase_price: parse(f.purchase),
        sale_price: sale,
        status: f.status,
        promo_channel: f.channel,
        promo_amount: f.channel === "Žádné" ? 0 : parse(f.promo),
        shipping: parse(f.shipping) || 0,
        bought_at: f.boughtAt || null,
        sold_at: f.status === "Prodáno" ? f.soldAt || null : null,
        color: f.color.trim(),
        material: f.material.trim(),
        fit: f.fit.trim(),
        condition: f.condition,
        list_price: parse(f.listPrice),
        listing_text: own.vinted,
        listing_fb_text: own.fb,
        updated_at: new Date().toISOString(),
      };
      const { error } = item
        ? await client.from("resell_items").update(data).eq("id", item.id)
        : await client.from("resell_items").insert(data);
      if (error) throw error;
      if (oldPath && oldPath !== photo_path) await removePhoto(client, oldPath);
      onClose(true);
    } catch (err) {
      console.error(err);
      if (newPath) await removePhoto(client, newPath);
      setError("Uložení se nepovedlo: " + (err.message || "zkontroluj připojení") + ".");
      setBusy(null);
    }
  }

  async function remove() {
    if (!navigator.onLine) return setError("Jsi offline. Smaž to, až budeš připojený.");
    setBusy("Mažu…");
    const { error } = await client.from("resell_items").delete().eq("id", item.id);
    if (error) {
      setError("Smazání se nepovedlo: " + error.message + ".");
      return setBusy(null);
    }
    await removePhoto(client, item.photo_path);
    onClose(true);
  }

  return (
    <Sheet title={item ? "Upravit položku" : "Přidat položku"} onClose={() => onClose(false)}>
      <form onSubmit={save} noValidate className="flex flex-col gap-4">
        {archived && (
          <p className="text-sm text-muted">Prodáno před víc než {ARCHIVE_DAYS} dny, položka je v tabulce prodaných a fotka už je smazaná.</p>
        )}
        {!archived && (
        <div className="flex items-center gap-4">
          <div
            className="w-24 shrink-0 overflow-hidden rounded-lg grid place-items-center border border-line"
            style={{ aspectRatio: "4 / 5", background: "var(--panel2)" }}
          >
            {shown ? <img src={shown} alt="Náhled fotky" className="w-full h-full object-cover" /> : <Ico name="ImagePlus" size={22} className="text-muted" />}
          </div>
          <div className="flex flex-col items-start gap-2">
            <label className="btn cursor-pointer" style={{ position: "relative" }}>
              <Ico name="Camera" size={15} />
              {shown ? "Vyměnit fotku" : "Vybrat fotku"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const s = e.target.files && e.target.files[0];
                  if (s) {
                    setFile(s);
                    setPhotoRemoved(false);
                  }
                  e.target.value = "";
                }}
              />
            </label>
            {shown && (
              <button
                type="button"
                className="text-sm text-muted underline underline-offset-2"
                onClick={() => {
                  setFile(null);
                  setPhotoRemoved(true);
                }}
              >
                Odebrat fotku
              </button>
            )}
          </div>
        </div>
        )}

        <div>
          <Field label="Značka">
            <input
              className="field"
              value={f.brand}
              autoComplete="off"
              onChange={set("brand")}
              onFocus={() => setBrandFocus(true)}
              onBlur={() => setBrandFocus(false)}
            />
          </Field>
          {brandFocus && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="btn"
                  style={{ padding: "4px 10px", fontSize: 13 }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setF((p) => ({ ...p, brand: s }));
                    setBrandFocus(false);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <Field label="Druh oblečení">
          <input className="field" value={f.name} placeholder="např. pánská šedá mikina" onChange={set("name")} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Velikost">
            <select className="field" value={f.size} onChange={set("size")}>
              <option value="">Neuvedeno</option>
              {SIZES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Stav">
            <select className="field" value={f.status} onChange={set("status")}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Nákupní cena (Kč)">
            <input className="field tnum" type="number" min="0" step="any" inputMode="decimal" value={f.purchase} onChange={set("purchase")} />
          </Field>
          <Field label="Prodejní cena (Kč)">
            <input className="field tnum" type="number" min="0" step="any" inputMode="decimal" value={f.sale} onChange={set("sale")} />
          </Field>
          <Field label="Promo">
            <select className="field" value={f.channel} onChange={set("channel")}>
              {PROMOS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Částka za promo (Kč)">
            <input
              className="field tnum"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              disabled={f.channel === "Žádné"}
              style={f.channel === "Žádné" ? { opacity: 0.45 } : undefined}
              value={f.channel === "Žádné" ? "" : f.promo}
              onChange={set("promo")}
            />
          </Field>
          <Field label="Doprava (Kč)">
            <input className="field tnum" type="number" min="0" step="any" inputMode="decimal" value={f.shipping} onChange={set("shipping")} />
          </Field>
          <Field label="Koupeno">
            <input className="field" type="date" value={f.boughtAt} onChange={set("boughtAt")} />
          </Field>
          {f.status === "Prodáno" && (
            <Field label="Prodáno dne">
              <input className="field" type="date" value={f.soldAt} onChange={set("soldAt")} />
            </Field>
          )}
        </div>

        <details className="card p-4 flex flex-col gap-3" style={{ background: "var(--panel2)" }} open={!item || item.status !== "Prodáno"}>
          <summary className="font-display font-semibold cursor-pointer">Inzerát na Vinted a Facebook</summary>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Barva">
              <input className="field" value={f.color} placeholder="např. Šedá" onChange={set("color")} />
            </Field>
            <Field label="Cena na Facebooku (Kč)">
              <input className="field tnum" type="number" min="0" step="any" inputMode="decimal" value={f.listPrice} onChange={set("listPrice")} />
            </Field>
            <Field label="Materiál">
              <input className="field" value={f.material} placeholder="např. bavlna" onChange={set("material")} />
            </Field>
            <Field label="Střih">
              <input className="field" value={f.fit} placeholder="např. s kapucí" onChange={set("fit")} />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Stav oblečení">
              <select className="field" value={f.condition} onChange={set("condition")}>
                <option value="">Neuvedeno</option>
                {CONDITIONS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="seg mt-4" role="group" aria-label="Kam inzerát">
            {[["vinted", "Vinted"], ["fb", "Facebook"]].map(([k, label]) => (
              <button key={k} type="button" aria-pressed={platform === k} onClick={() => setPlatform(k)}>
                {label}
                {own[k] !== null && <span className="text-muted"> (upraveno)</span>}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-sm text-muted">Název</span>
            <button type="button" className="btn" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => copy("title", title)}>
              <Ico name={copied === "title" ? "Check" : "Copy"} size={13} />
              {copied === "title" ? "Zkopírováno" : "Kopírovat"}
            </button>
          </div>
          <p className="field mt-1" style={{ whiteSpace: "normal" }}>{title}</p>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-sm text-muted">{listingEdited ? "Popis (upravený ručně)" : "Popis (vytváří se z polí)"}</span>
            <div className="flex gap-2">
              {listingEdited && (
                <button type="button" className="btn" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => setOwn((o) => ({ ...o, [platform]: null }))}>
                  <Ico name="RotateCcw" size={13} />
                  Vytvořit znovu
                </button>
              )}
              <button type="button" className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => copy("text", listing)}>
                <Ico name={copied === "text" ? "Check" : "Copy"} size={13} />
                {copied === "text" ? "Zkopírováno" : "Kopírovat"}
              </button>
            </div>
          </div>
          <textarea
            className="field mt-1"
            rows={14}
            value={listing}
            onChange={(e) => {
              const v = e.target.value;
              setOwn((o) => ({ ...o, [platform]: v }));
            }}
            style={{ resize: "vertical", lineHeight: 1.45 }}
          />
        </details>

        {item &&
          (confirmDel ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>Smazat položku natrvalo?</span>
              <button type="button" className="btn" style={{ borderColor: "var(--danger)", color: "var(--danger)" }} disabled={!!busy} onClick={remove}>
                Smazat
              </button>
              <button type="button" className="text-muted underline underline-offset-2" onClick={() => setConfirmDel(false)}>
                Nechat
              </button>
            </div>
          ) : (
            <button type="button" className="self-start text-sm underline underline-offset-2" style={{ color: "var(--danger)" }} onClick={() => setConfirmDel(true)}>
              Smazat položku
            </button>
          ))}

        <div className="border-t border-line pt-4 flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-muted">Čistý zisk</div>
              <div className="font-display text-xl font-bold tnum" style={{ color: sale === null ? "var(--muted)" : toneColor(profit) }}>
                {sale === null ? "Zatím bez prodeje" : czkSigned(profit)}
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={!!busy}>
              <Ico name="Check" size={15} />
              {busy || "Uložit"}
            </button>
          </div>
        </div>
      </form>
    </Sheet>
  );
}

const FILTERS = STATUSES;
const MONTHS = ["led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj", "lis", "pro"];
const MONTHS_LONG = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];

// Sloupec s 4px zaoblením jen na konci dat, u nulové osy rovně
function barPath(x, w, y0, y1) {
  const r = Math.min(4, w / 2, Math.abs(y1 - y0));
  if (y1 < y0)
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

function SalesChart({ items }) {
  const sold = items.filter((i) => i.status === "Prodáno");
  const dated = sold.filter((i) => i.sold_at);
  const undated = sold.length - dated.length;

  const months = useMemo(() => {
    if (!dated.length) return [];
    const key = (d) => d.slice(0, 7);
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    const first = dated.map((i) => key(i.sold_at)).sort()[0];
    let start = new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 1);
    const min = new Date(end.getFullYear(), end.getMonth() - 11, 1);
    if (start < min) start = min;
    const out = [];
    for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const inMonth = dated.filter((i) => key(i.sold_at) === k);
      out.push({ k, y: d.getFullYear(), m: d.getMonth(), count: inMonth.length, profit: round2(inMonth.reduce((s, i) => s + netProfit(i), 0)) });
    }
    return out;
  }, [items]);

  const [sel, setSel] = useState(null);
  const active = months.find((m) => m.k === sel) || months[months.length - 1];

  return (
    <div className="card p-4 mb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display font-semibold">Prodeje po měsících</h3>
        {active && (
          <p className="text-sm tnum" aria-live="polite">
            <span className="text-muted">{MONTHS_LONG[active.m]} {active.y}: </span>
            {active.count} ks,{" "}
            <span className="font-semibold">{active.count ? czkSigned(active.profit) : "0 Kč"}</span>
          </p>
        )}
      </div>
      {!months.length ? (
        <p className="text-sm text-muted mt-2">Graf se začne kreslit, až u prodaných věcí bude datum prodeje. Nově se vyplní samo při přepnutí na Prodáno.</p>
      ) : (
        <Bars months={months} active={active} onSelect={setSel} />
      )}
      {undated > 0 && (
        <p className="text-xs text-muted mt-2">
          {undated} {undated === 1 ? "starší prodej nemá" : undated < 5 ? "starší prodeje nemají" : "starších prodejů nemá"} datum prodeje, do grafu se nepočítá. Doplníš ho v tabulce prodaných.
        </p>
      )}
    </div>
  );
}

function Bars({ months, active, onSelect }) {
  // Kreslí se ve skutečných pixelech, aby popisky byly čitelné i na telefonu
  const box = useRef(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(200, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 180, top = 12, bottom = 40;
  const max = Math.max(1, ...months.map((m) => Math.abs(m.profit)));
  const hasNeg = months.some((m) => m.profit < 0);
  const hasPos = months.some((m) => m.profit > 0);
  const plotH = H - top - bottom;
  // nulová osa: nahoře/dole/uprostřed podle toho, jestli jsou v datech zisky i ztráty
  const zero = top + (hasNeg && hasPos ? plotH / 2 : hasNeg ? 0 : plotH);
  const scale = (hasNeg && hasPos ? plotH / 2 : plotH) / max;
  const step = W / months.length;
  const bw = Math.max(6, Math.min(44, step * 0.56));
  return (
    <div ref={box} className="w-full mt-3">
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="Zisk podle měsíce prodeje">
      <line x1="0" x2={W} y1={zero} y2={zero} stroke="var(--line)" strokeWidth="1" />
      {months.map((m, i) => {
        const cx = i * step + step / 2;
        const y1 = zero - m.profit * scale;
        const on = active && active.k === m.k;
        return (
          <g key={m.k} onClick={() => onSelect(m.k)} onMouseEnter={() => onSelect(m.k)} style={{ cursor: "pointer" }}>
            <title>{`${MONTHS_LONG[m.m]} ${m.y}: ${m.count} ks, ${czkSigned(m.profit)}`}</title>
            <rect x={i * step} y="0" width={step} height={H} fill={on ? "rgba(255,255,255,.04)" : "transparent"} />
            {m.count > 0 && Math.abs(y1 - zero) >= 1 && (
              <path d={barPath(cx - bw / 2, bw, zero, y1)} fill={m.profit >= 0 ? "var(--ok)" : "var(--danger)"} opacity={on ? 1 : 0.8} />
            )}
            {m.count > 0 && Math.abs(y1 - zero) < 1 && <rect x={cx - bw / 2} y={zero - 1} width={bw} height="2" fill="var(--muted)" />}
            <text x={cx} y={H - 20} textAnchor="middle" fontSize="12" fill={on ? "var(--fg)" : "var(--muted)"}>
              {MONTHS[m.m]}
            </text>
            <text x={cx} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--muted)" className="tnum">
              {m.count ? `${m.count} ks` : "–"}
            </text>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

function SoldTable({ items, onOpen }) {
  const [open, setOpen] = useState(false);
  const rows = [...items].sort((a, b) => (b.sold_at || "").localeCompare(a.sold_at || ""));
  const total = round2(rows.reduce((s, i) => s + netProfit(i), 0));
  const shown = open ? rows : rows.slice(0, 8);
  if (!rows.length) return null;
  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h3 className="font-display text-lg font-semibold">Prodané před víc než měsícem</h3>
        <span className="text-sm tnum text-muted">
          {rows.length} ks, <span style={{ color: toneColor(total) }}>{czkSigned(total)}</span>
        </span>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm tnum" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="text-left text-muted" style={{ borderBottom: "1px solid var(--line)" }}>
              <th className="font-normal px-3 py-2">Prodáno</th>
              <th className="font-normal px-3 py-2">Věc</th>
              <th className="font-normal px-3 py-2 text-right hidden sm:table-cell">Nákup</th>
              <th className="font-normal px-3 py-2 text-right hidden sm:table-cell">Prodej</th>
              <th className="font-normal px-3 py-2 text-right hidden md:table-cell">Promo + doprava</th>
              <th className="font-normal px-3 py-2 text-right">Zisk</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => {
              const p = netProfit(i);
              const costs = (i.promo_channel === "Žádné" ? 0 : num(i.promo_amount) || 0) + (num(i.shipping) || 0);
              return (
                <tr
                  key={i.id}
                  tabIndex={0}
                  onClick={() => onOpen(i)}
                  onKeyDown={(e) => e.key === "Enter" && onOpen(i)}
                  className="cursor-pointer hover:bg-panel2"
                  style={{ borderTop: "1px solid var(--line)" }}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{shortDate(i.sold_at)}</td>
                  <td className="px-3 py-2" style={{ minWidth: 140 }}>
                    <div className="font-semibold">{i.brand}{i.size ? ` (${i.size})` : ""}</div>
                    {i.name && <div className="text-muted text-xs">{i.name}</div>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap hidden sm:table-cell">{czk(num(i.purchase_price) || 0)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap hidden sm:table-cell">{czk(num(i.sale_price) || 0)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap hidden md:table-cell text-muted">{costs ? czk(costs) : "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-semibold" style={{ color: toneColor(p) }}>
                    {czkSigned(p)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 8 && (
        <button type="button" className="text-sm text-muted underline underline-offset-2 mt-2" onClick={() => setOpen(!open)}>
          {open ? "Zobrazit méně" : `Zobrazit všech ${rows.length}`}
        </button>
      )}
    </div>
  );
}

function ResellTab({ client, user, role, onLogin }) {
  const allowed = !!user && (role === "owner" || role === "member");
  const { items, error, reload } = useItems(client, allowed);
  const [form, setForm] = useState(null);
  const [filter, setFilterState] = useState(() => {
    const saved = store.get(FILTER_KEY);
    return FILTERS.includes(saved) ? saved : "Inzerováno";
  });
  const setFilter = (x) => {
    setFilterState(x);
    store.set(FILTER_KEY, x);
  };

  const all = useMemo(() => (allowed && items) || [], [items, allowed]);
  const cutoff = archiveCutoff();
  const active = all.filter((i) => !isArchived(i, cutoff));
  const archived = all.filter((i) => isArchived(i, cutoff));
  const { soldCount, totalProfit } = useMemo(() => summarize(all), [all]);
  const brands = useMemo(() => uniqueBrands(all), [all]);
  const visible = active.filter((i) => i.status === filter);
  const countFor = (x) => active.filter((i) => i.status === x).length;

  // Úklid: prodaným před víc než měsícem smaže fotku ze Storage, ať nedojde místo
  const cleaning = useRef(new Set());
  useEffect(() => {
    if (!allowed || !items || !navigator.onLine) return;
    const todo = items.filter((i) => i.photo_path && isArchived(i, archiveCutoff()) && !cleaning.current.has(i.id));
    if (!todo.length) return;
    todo.forEach((i) => cleaning.current.add(i.id));
    (async () => {
      const { error } = await client.storage.from(BUCKET).remove(todo.map((i) => i.photo_path));
      if (error) return console.warn("Úklid fotek se nepovedl", error);
      const res = await client.from("resell_items").update({ photo_path: null }).in("id", todo.map((i) => i.id));
      if (res.error) console.warn("Úklid fotek se nepovedl", res.error);
      reload();
    })();
  }, [items, allowed]);

  if (!client)
    return <p className="text-muted">Resell tracker potřebuje synchronizaci se Supabase. Doplň config.js.</p>;
  if (!user)
    return (
      <div className="card p-6 max-w-md flex flex-col gap-3 items-start">
        <p>Tracker se ukazuje jen přihlášeným.</p>
        {onLogin && (
          <button type="button" className="btn btn-primary" onClick={onLogin}>
            <Ico name="LogIn" size={15} />
            Přihlásit
          </button>
        )}
      </div>
    );
  if (role === "loading") return <p className="text-muted">Ověřuji přístup…</p>;
  if (!allowed)
    return (
      <div className="card p-6 max-w-md">
        <p>Tenhle účet k trackeru zatím nemá přístup.</p>
        <p className="text-sm text-muted mt-1">Robin ho musí přidat v Supabase (skript 3-pridat-lucku.sql).</p>
      </div>
    );

  return (
    <section>
      <Stats soldCount={soldCount} totalProfit={totalProfit} inStock={all.length - soldCount} />

      {all.length > 0 && <SalesChart items={all} />}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="seg" role="group" aria-label="Filtr podle stavu">
          {FILTERS.map((x) => (
            <button key={x} type="button" aria-pressed={filter === x} onClick={() => setFilter(x)}>
              {x === "Prodáno" ? "Prodáno tento měsíc" : x} <span className="tnum text-muted">{countFor(x)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setForm({ item: null })}>
          <Ico name="Plus" size={15} />
          Přidat kus
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm mb-4" style={{ color: "var(--accent)" }}>
          {error}
        </p>
      )}
      {items === null && !error && <p className="text-muted">Načítám položky…</p>}
      {items && all.length === 0 && (
        <div className="card border-dashed p-6 text-center text-muted">Sklad je prázdný. Přidej první kus.</div>
      )}
      {all.length > 0 && visible.length === 0 && (
        <p className="text-muted py-6 text-center">
          {filter === "Prodáno" ? `Za posledních ${ARCHIVE_DAYS} dní nic prodaného. Starší prodeje jsou v tabulce níž.` : "V tomhle stavu teď nic nemáš."}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {visible.map((i) => (
          <ItemCard key={i.id} item={i} client={client} onOpen={() => setForm({ item: i })} />
        ))}
      </div>

      <SoldTable items={archived} onOpen={(i) => setForm({ item: i })} />

      {form && (
        <ItemForm
          key={form.item ? form.item.id : "new"}
          item={form.item}
          client={client}
          brands={brands}
          onClose={(changed) => {
            setForm(null);
            changed && reload();
          }}
        />
      )}
    </section>
  );
}

// ---------- samostatná stránka resell.html (pro Lucku) ----------
function LoginCard({ client }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    setMsg("");
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const signIn = (e) => {
    e.preventDefault();
    run(async () => {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password: pw });
      if (error)
        setMsg(/confirm/i.test(error.message) ? "Nejdřív potvrď e‑mail přes odkaz, který ti přišel." : "Přihlášení se nepovedlo. Zkontroluj e‑mail a heslo.");
    });
  };
  const signUp = () =>
    run(async () => {
      if (pw.length < 8) return setMsg("Heslo musí mít aspoň 8 znaků.");
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password: pw,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) return setMsg("Účet se nepodařilo vytvořit: " + error.message);
      setMsg(data.session ? "Účet je hotový. Teď ti Robin musí dát přístup." : "Přišel ti e‑mail. Potvrď ho a pak se přihlas.");
    });
  return (
    <form onSubmit={signIn} className="card p-5 max-w-sm w-full flex flex-col gap-3 text-sm">
      <h1 className="font-display text-2xl font-bold">
        Resell <span className="text-accent">tracker</span>
      </h1>
      <Field label="E‑mail">
        <input className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Heslo">
        <input className="field" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <Ico name="LogIn" size={15} />
          Přihlásit
        </button>
        <button type="button" className="btn" disabled={busy || !email || !pw} onClick={signUp}>
          Vytvořit účet
        </button>
      </div>
      {msg && <p style={{ color: "var(--accent)" }}>{msg}</p>}
    </form>
  );
}

function StandaloneApp() {
  const cfg = window.RP_CONFIG || {};
  const [client] = useState(() =>
    cfg.supabaseUrl && window.supabase
      ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } })
      : null
  );
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    if (!client) return setUser(null);
    client.auth.getSession().then(({ data }) => setUser(data.session ? data.session.user : null));
    const { data } = client.auth.onAuthStateChange((_e, s) => setUser(s ? s.user : null));
    return () => data.subscription.unsubscribe();
  }, [client]);
  const role = useRole(client, user || null);

  if (user === undefined) return null;
  if (!user)
    return (
      <main className="gutter min-h-screen grid place-items-center py-10">
        <LoginCard client={client} />
      </main>
    );
  return (
    <main className="gutter" style={{ paddingBlock: "16px 64px" }}>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h1 className="font-display text-2xl font-bold">
            Resell <span className="text-accent">tracker</span>
          </h1>
          <button type="button" className="btn" onClick={() => client.auth.signOut()}>
            <Ico name="LogOut" size={14} />
            Odhlásit
          </button>
        </div>
        <ResellTab client={client} user={user} role={role} />
      </div>
    </main>
  );
}

window.RPResell = { ResellTab, StandaloneApp, useRole, netProfit, summarize };
