// Resell tracker pro Řídicí panel R.P.
// Zdroják: src/resell.jsx → zkompilováno do resell.js (React z CDN, žádný build na GitHubu není potřeba).
const { useState, useEffect, useMemo, useRef, useCallback } = React;

const BUCKET = "resell-photos";
const SIZES = ["XS", "S", "M", "L", "XL"];
const STATUSES = ["K prodeji", "Inzerováno", "Prodáno"];
const PROMOS = ["Žádné", "Vinted", "Facebook"];
const ROLE_KEY = "rpresell.role";
const CACHE_KEY = "rpresell.items";

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
  }));
  const set = (k) => (e) => {
    setF((p) => ({ ...p, [k]: e.target.value }));
    setError("");
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
    if ([purchase, sale, parse(f.promo), parse(f.shipping)].some((n) => n !== null && (!Number.isFinite(n) || n < 0)))
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
      const photo_path = newPath || (photoRemoved ? null : oldPath);
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

        <Field label="Popis (nepovinné)">
          <input className="field" value={f.name} placeholder="např. černá mikina" onChange={set("name")} />
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
        </div>

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

const FILTERS = ["Vše", ...STATUSES];

function ResellTab({ client, user, role, onLogin }) {
  const allowed = !!user && (role === "owner" || role === "member");
  const { items, error, reload } = useItems(client, allowed);
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState("Vše");

  const all = useMemo(() => (allowed && items) || [], [items, allowed]);
  const { soldCount, totalProfit } = useMemo(() => summarize(all), [all]);
  const brands = useMemo(() => uniqueBrands(all), [all]);
  const visible = filter === "Vše" ? all : all.filter((i) => i.status === filter);
  const countFor = (x) => (x === "Vše" ? all.length : all.filter((i) => i.status === x).length);

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

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="seg" role="group" aria-label="Filtr podle stavu">
          {FILTERS.map((x) => (
            <button key={x} type="button" aria-pressed={filter === x} onClick={() => setFilter(x)}>
              {x} <span className="tnum text-muted">{countFor(x)}</span>
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
      {all.length > 0 && visible.length === 0 && <p className="text-muted py-6 text-center">V tomhle stavu teď nic nemáš.</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {visible.map((i) => (
          <ItemCard key={i.id} item={i} client={client} onOpen={() => setForm({ item: i })} />
        ))}
      </div>

      {form && (
        <ItemForm
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
