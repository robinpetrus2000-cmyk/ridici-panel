// Resell tracker pro Řídicí panel R.P. Vygenerováno ze src/resell.jsx, ruční úpravy dělej tam.
(() => {
  const { useState, useEffect, useMemo, useRef, useCallback } = React;
  const BUCKET = "resell-photos";
  const SIZES = ["XS", "S", "M", "L", "XL"];
  const STATUSES = ["K prodeji", "Inzerov\xE1no", "Prod\xE1no"];
  const PROMOS = ["\u017D\xE1dn\xE9", "Vinted", "Facebook"];
  const ROLE_KEY = "rpresell.role";
  const CACHE_KEY = "rpresell.items";
  const store = {
    get(k) {
      try {
        const r = localStorage.getItem(k);
        return r == null ? void 0 : JSON.parse(r);
      } catch {
        return void 0;
      }
    },
    set(k, v) {
      try {
        v === void 0 ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v));
      } catch {
      }
    }
  };
  function Ico({ name, size = 16, ...p }) {
    const L = window.LucideReact || window.lucideReact || {};
    const C = L[name];
    return C ? /* @__PURE__ */ React.createElement(C, { size, strokeWidth: 1.9, "aria-hidden": "true", ...p }) : null;
  }
  const num = (v) => v === null || v === void 0 || v === "" ? null : Number(v);
  const round2 = (v) => Math.round(v * 100) / 100;
  function netProfit(i) {
    const promo = i.promo_channel === "\u017D\xE1dn\xE9" ? 0 : num(i.promo_amount) || 0;
    return round2((num(i.sale_price) || 0) - (num(i.purchase_price) || 0) - promo - (num(i.shipping) || 0));
  }
  function summarize(items) {
    const sold = items.filter((i) => i.status === "Prod\xE1no");
    return { soldCount: sold.length, totalProfit: round2(sold.reduce((s, i) => s + netProfit(i), 0)) };
  }
  function uniqueBrands(items) {
    const m = /* @__PURE__ */ new Map();
    for (const { brand } of items) {
      const label = (brand || "").trim();
      if (!label) continue;
      const k = label.toLocaleLowerCase("cs");
      const e = m.get(k);
      e ? e.count++ : m.set(k, { label, count: 1 });
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "cs")).map((e) => e.label);
  }
  const fmt = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 });
  const fmtSigned = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2, signDisplay: "exceptZero" });
  const czk = (v) => fmt.format(v) + " K\u010D";
  const czkSigned = (v) => fmtSigned.format(v).replace("-", "\u2212") + " K\u010D";
  const toneColor = (v) => v > 0 ? "var(--ok)" : v < 0 ? "var(--danger)" : "var(--fg)";
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
  const photoUrl = (client, path) => path ? client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;
  async function uploadPhoto(client, file) {
    const blob = await compressImage(file);
    const ext = blob.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "img").toLowerCase();
    const id = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    const path = `${id}.${ext}`;
    const { error } = await client.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || file.type, cacheControl: "31536000", upsert: false });
    if (error) throw error;
    return path;
  }
  async function removePhoto(client, path) {
    if (!path) return;
    const { error } = await client.storage.from(BUCKET).remove([path]);
    if (error) console.warn("Fotku se nepoda\u0159ilo smazat", error);
  }
  function useRole(client, user) {
    const [role, setRole] = useState(() => (store.get(ROLE_KEY) || {}).role || "none");
    const seenUser = useRef(false);
    useEffect(() => {
      if (!client) return;
      if (!user) {
        if (seenUser.current) {
          seenUser.current = false;
          store.set(ROLE_KEY, void 0);
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
  function useItems(client, enabled) {
    const [items, setItems] = useState(() => store.get(CACHE_KEY) || null);
    const [error, setError] = useState("");
    const load = useCallback(async () => {
      if (!client || !enabled) return;
      const { data, error: error2 } = await client.from("resell_items").select("*").order("created_at", { ascending: false });
      if (error2) {
        setError(
          navigator.onLine ? "Polo\u017Eky se nena\u010Detly: " + error2.message : "Jsi offline. Ukazuju posledn\xED sta\u017Een\xFD stav, \xFApravy p\u016Fjdou po p\u0159ipojen\xED."
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
      const ch = client.channel("resell-items").on("postgres_changes", { event: "*", schema: "public", table: "resell_items" }, () => load()).subscribe();
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
  const STATUS_CHIP = { "K prodeji": "chip", Inzerov\u00E1no: "chip chip-mid", Prod\u00E1no: "chip chip-ok" };
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
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "sticky z-10 -mx-4 px-4 py-3 mb-5 sm:mx-0 sm:px-0",
        style: { top: `calc(env(safe-area-inset-top, 0px) + ${top}px)`, background: "var(--bg)" }
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "card px-4 py-3 flex items-end justify-between gap-4",
          style: { borderColor: totalProfit < 0 ? "var(--danger)" : totalProfit > 0 ? "#2a6b43" : "var(--line)" }
        },
        /* @__PURE__ */ React.createElement("div", { className: "min-w-0" }, /* @__PURE__ */ React.createElement("div", { className: "text-sm text-muted" }, totalProfit < 0 ? "Celkov\xE1 ztr\xE1ta" : "Celkov\xFD profit"), /* @__PURE__ */ React.createElement(
          "div",
          {
            className: "font-display font-bold tnum leading-none truncate",
            style: { fontSize: "clamp(2rem, 9vw, 3.25rem)", color: toneColor(totalProfit) }
          },
          czkSigned(totalProfit)
        )),
        /* @__PURE__ */ React.createElement("div", { className: "flex gap-5 shrink-0 text-right" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "font-display text-3xl font-bold tnum leading-none" }, soldCount), /* @__PURE__ */ React.createElement("div", { className: "text-sm text-muted" }, "prod\xE1no")), /* @__PURE__ */ React.createElement("div", { className: "hidden sm:block" }, /* @__PURE__ */ React.createElement("div", { className: "font-display text-3xl font-bold tnum leading-none text-muted" }, inStock), /* @__PURE__ */ React.createElement("div", { className: "text-sm text-muted" }, "skladem")))
      )
    );
  }
  function ItemCard({ item, client, onOpen }) {
    const sold = item.status === "Prod\xE1no";
    const profit = netProfit(item);
    const url = photoUrl(client, item.photo_path);
    return /* @__PURE__ */ React.createElement("button", { type: "button", onClick: onOpen, className: "card overflow-hidden text-left flex flex-col min-w-0 hover:border-muted" }, /* @__PURE__ */ React.createElement("div", { className: "relative w-full", style: { aspectRatio: "4 / 5", background: "var(--panel2)" } }, url ? /* @__PURE__ */ React.createElement(
      "img",
      {
        src: url,
        alt: `${item.brand} ${item.name}`,
        loading: "lazy",
        className: "absolute inset-0 w-full h-full object-cover",
        style: sold ? { filter: "grayscale(1)", opacity: 0.55 } : void 0
      }
    ) : /* @__PURE__ */ React.createElement("div", { className: "absolute inset-0 grid place-items-center p-3" }, /* @__PURE__ */ React.createElement("span", { className: "font-display text-2xl font-bold text-center break-words", style: { color: "var(--line)" } }, item.brand)), /* @__PURE__ */ React.createElement("span", { className: STATUS_CHIP[item.status] + " absolute left-2 bottom-2", style: { background: sold ? void 0 : "var(--bg)" } }, item.status), item.size && /* @__PURE__ */ React.createElement("span", { className: "chip absolute right-2 top-2", style: { background: "var(--bg)", color: "var(--fg)" } }, item.size)), /* @__PURE__ */ React.createElement("div", { className: "p-3 flex flex-col gap-0.5 min-w-0" }, /* @__PURE__ */ React.createElement("div", { className: "font-semibold truncate" }, item.brand), item.name && /* @__PURE__ */ React.createElement("div", { className: "text-sm text-muted truncate" }, item.name), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-baseline justify-between gap-x-2 mt-1 text-sm tnum" }, /* @__PURE__ */ React.createElement("span", { className: "text-muted" }, czk(num(item.purchase_price) || 0), item.sale_price != null && ` \u2192 ${czk(num(item.sale_price))}`), (sold || item.sale_price != null) && /* @__PURE__ */ React.createElement("span", { className: "font-semibold", style: { color: toneColor(profit) } }, czkSigned(profit)))));
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
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "fixed inset-0 z-50 overflow-y-auto gutter",
        style: {
          background: "rgba(4,7,11,.72)",
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 24px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)"
        },
        onClick: onClose
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "card p-5 max-w-lg mx-auto flex flex-col gap-4",
          style: { background: "var(--panel)" },
          onClick: (e) => e.stopPropagation(),
          role: "dialog",
          "aria-modal": "true",
          "aria-label": title
        },
        /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("h2", { className: "font-display text-xl font-semibold" }, title), /* @__PURE__ */ React.createElement("button", { type: "button", className: "icon-btn", onClick: onClose, "aria-label": "Zav\u0159\xEDt" }, /* @__PURE__ */ React.createElement(Ico, { name: "X", size: 18 }))),
        children
      )
    );
  }
  const today = () => (/* @__PURE__ */ new Date()).toLocaleDateString("sv");
  const toInput = (v) => v === null || v === void 0 ? "" : String(num(v));
  const parse = (v) => String(v).trim() === "" ? null : Number(String(v).replace(",", "."));
  function Field({ label, children }) {
    return /* @__PURE__ */ React.createElement("label", { className: "flex flex-col gap-1 min-w-0 text-sm" }, /* @__PURE__ */ React.createElement("span", { className: "text-muted" }, label), children);
  }
  function ItemForm({ item, client, brands, onClose }) {
    const [f, setF] = useState(() => ({
      name: item ? item.name : "",
      brand: item ? item.brand : "",
      size: item && item.size ? item.size : "",
      purchase: toInput(item && item.purchase_price),
      sale: toInput(item && item.sale_price),
      status: item ? item.status : "K prodeji",
      channel: item ? item.promo_channel : "\u017D\xE1dn\xE9",
      promo: item && num(item.promo_amount) ? toInput(item.promo_amount) : "",
      shipping: item && num(item.shipping) ? toInput(item.shipping) : "",
      boughtAt: item ? item.bought_at || "" : today()
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
      return brands.filter((b) => {
        const l = b.toLocaleLowerCase("cs");
        return l !== t && l.includes(t);
      }).slice(0, 6);
    }, [f.brand, brands]);
    const sale = parse(f.sale);
    const profit = netProfit({
      purchase_price: parse(f.purchase) || 0,
      sale_price: sale,
      promo_channel: f.channel,
      promo_amount: parse(f.promo) || 0,
      shipping: parse(f.shipping) || 0
    });
    const shown = preview || (photoRemoved ? null : photoUrl(client, item && item.photo_path));
    function problem() {
      if (!f.brand.trim()) return "Vypl\u0148 zna\u010Dku.";
      const purchase = parse(f.purchase);
      if (purchase === null) return "Vypl\u0148 n\xE1kupn\xED cenu.";
      if (f.status === "Prod\xE1no" && sale === null) return "U prodan\xE9 polo\u017Eky vypl\u0148 prodejn\xED cenu.";
      if (f.channel !== "\u017D\xE1dn\xE9" && parse(f.promo) === null) return "Vypl\u0148 \u010D\xE1stku za promo.";
      if ([purchase, sale, parse(f.promo), parse(f.shipping)].some((n) => n !== null && (!Number.isFinite(n) || n < 0)))
        return "\u010C\xE1stky mus\xED b\xFDt \u010D\xEDsla od nuly v\xFD\u0161.";
      if (!navigator.onLine) return "Jsi offline. Ulo\u017E to, a\u017E bude\u0161 p\u0159ipojen\xFD.";
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
          setBusy("Nahr\xE1v\xE1m fotku\u2026");
          newPath = await uploadPhoto(client, file);
        }
        setBusy("Ukl\xE1d\xE1m\u2026");
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
          promo_amount: f.channel === "\u017D\xE1dn\xE9" ? 0 : parse(f.promo),
          shipping: parse(f.shipping) || 0,
          bought_at: f.boughtAt || null,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        };
        const { error: error2 } = item ? await client.from("resell_items").update(data).eq("id", item.id) : await client.from("resell_items").insert(data);
        if (error2) throw error2;
        if (oldPath && oldPath !== photo_path) await removePhoto(client, oldPath);
        onClose(true);
      } catch (err) {
        console.error(err);
        if (newPath) await removePhoto(client, newPath);
        setError("Ulo\u017Een\xED se nepovedlo: " + (err.message || "zkontroluj p\u0159ipojen\xED") + ".");
        setBusy(null);
      }
    }
    async function remove() {
      if (!navigator.onLine) return setError("Jsi offline. Sma\u017E to, a\u017E bude\u0161 p\u0159ipojen\xFD.");
      setBusy("Ma\u017Eu\u2026");
      const { error: error2 } = await client.from("resell_items").delete().eq("id", item.id);
      if (error2) {
        setError("Smaz\xE1n\xED se nepovedlo: " + error2.message + ".");
        return setBusy(null);
      }
      await removePhoto(client, item.photo_path);
      onClose(true);
    }
    return /* @__PURE__ */ React.createElement(Sheet, { title: item ? "Upravit polo\u017Eku" : "P\u0159idat polo\u017Eku", onClose: () => onClose(false) }, /* @__PURE__ */ React.createElement("form", { onSubmit: save, noValidate: true, className: "flex flex-col gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-4" }, /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "w-24 shrink-0 overflow-hidden rounded-lg grid place-items-center border border-line",
        style: { aspectRatio: "4 / 5", background: "var(--panel2)" }
      },
      shown ? /* @__PURE__ */ React.createElement("img", { src: shown, alt: "N\xE1hled fotky", className: "w-full h-full object-cover" }) : /* @__PURE__ */ React.createElement(Ico, { name: "ImagePlus", size: 22, className: "text-muted" })
    ), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col items-start gap-2" }, /* @__PURE__ */ React.createElement("label", { className: "btn cursor-pointer", style: { position: "relative" } }, /* @__PURE__ */ React.createElement(Ico, { name: "Camera", size: 15 }), shown ? "Vym\u011Bnit fotku" : "Vybrat fotku", /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "file",
        accept: "image/*",
        className: "sr-only",
        onChange: (e) => {
          const s = e.target.files && e.target.files[0];
          if (s) {
            setFile(s);
            setPhotoRemoved(false);
          }
          e.target.value = "";
        }
      }
    )), shown && /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "text-sm text-muted underline underline-offset-2",
        onClick: () => {
          setFile(null);
          setPhotoRemoved(true);
        }
      },
      "Odebrat fotku"
    ))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(Field, { label: "Zna\u010Dka" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "field",
        value: f.brand,
        autoComplete: "off",
        onChange: set("brand"),
        onFocus: () => setBrandFocus(true),
        onBlur: () => setBrandFocus(false)
      }
    )), brandFocus && suggestions.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-2 mt-2" }, suggestions.map((s) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: s,
        type: "button",
        className: "btn",
        style: { padding: "4px 10px", fontSize: 13 },
        onMouseDown: (e) => {
          e.preventDefault();
          setF((p) => ({ ...p, brand: s }));
          setBrandFocus(false);
        }
      },
      s
    )))), /* @__PURE__ */ React.createElement(Field, { label: "Popis (nepovinn\xE9)" }, /* @__PURE__ */ React.createElement("input", { className: "field", value: f.name, placeholder: "nap\u0159. \u010Dern\xE1 mikina", onChange: set("name") })), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 gap-3" }, /* @__PURE__ */ React.createElement(Field, { label: "Velikost" }, /* @__PURE__ */ React.createElement("select", { className: "field", value: f.size, onChange: set("size") }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Neuvedeno"), SIZES.map((s) => /* @__PURE__ */ React.createElement("option", { key: s }, s)))), /* @__PURE__ */ React.createElement(Field, { label: "Stav" }, /* @__PURE__ */ React.createElement("select", { className: "field", value: f.status, onChange: set("status") }, STATUSES.map((s) => /* @__PURE__ */ React.createElement("option", { key: s }, s)))), /* @__PURE__ */ React.createElement(Field, { label: "N\xE1kupn\xED cena (K\u010D)" }, /* @__PURE__ */ React.createElement("input", { className: "field tnum", type: "number", min: "0", step: "any", inputMode: "decimal", value: f.purchase, onChange: set("purchase") })), /* @__PURE__ */ React.createElement(Field, { label: "Prodejn\xED cena (K\u010D)" }, /* @__PURE__ */ React.createElement("input", { className: "field tnum", type: "number", min: "0", step: "any", inputMode: "decimal", value: f.sale, onChange: set("sale") })), /* @__PURE__ */ React.createElement(Field, { label: "Promo" }, /* @__PURE__ */ React.createElement("select", { className: "field", value: f.channel, onChange: set("channel") }, PROMOS.map((s) => /* @__PURE__ */ React.createElement("option", { key: s }, s)))), /* @__PURE__ */ React.createElement(Field, { label: "\u010C\xE1stka za promo (K\u010D)" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "field tnum",
        type: "number",
        min: "0",
        step: "any",
        inputMode: "decimal",
        disabled: f.channel === "\u017D\xE1dn\xE9",
        style: f.channel === "\u017D\xE1dn\xE9" ? { opacity: 0.45 } : void 0,
        value: f.channel === "\u017D\xE1dn\xE9" ? "" : f.promo,
        onChange: set("promo")
      }
    )), /* @__PURE__ */ React.createElement(Field, { label: "Doprava (K\u010D)" }, /* @__PURE__ */ React.createElement("input", { className: "field tnum", type: "number", min: "0", step: "any", inputMode: "decimal", value: f.shipping, onChange: set("shipping") })), /* @__PURE__ */ React.createElement(Field, { label: "Koupeno" }, /* @__PURE__ */ React.createElement("input", { className: "field", type: "date", value: f.boughtAt, onChange: set("boughtAt") }))), item && (confirmDel ? /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-3 text-sm" }, /* @__PURE__ */ React.createElement("span", null, "Smazat polo\u017Eku natrvalo?"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", style: { borderColor: "var(--danger)", color: "var(--danger)" }, disabled: !!busy, onClick: remove }, "Smazat"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "text-muted underline underline-offset-2", onClick: () => setConfirmDel(false) }, "Nechat")) : /* @__PURE__ */ React.createElement("button", { type: "button", className: "self-start text-sm underline underline-offset-2", style: { color: "var(--danger)" }, onClick: () => setConfirmDel(true) }, "Smazat polo\u017Eku")), /* @__PURE__ */ React.createElement("div", { className: "border-t border-line pt-4 flex flex-col gap-2" }, error && /* @__PURE__ */ React.createElement("p", { role: "alert", className: "text-sm", style: { color: "var(--danger)" } }, error), /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "text-sm text-muted" }, "\u010Cist\xFD zisk"), /* @__PURE__ */ React.createElement("div", { className: "font-display text-xl font-bold tnum", style: { color: sale === null ? "var(--muted)" : toneColor(profit) } }, sale === null ? "Zat\xEDm bez prodeje" : czkSigned(profit))), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "btn btn-primary", disabled: !!busy }, /* @__PURE__ */ React.createElement(Ico, { name: "Check", size: 15 }), busy || "Ulo\u017Eit")))));
  }
  const FILTERS = ["V\u0161e", ...STATUSES];
  function ResellTab({ client, user, role, onLogin }) {
    const allowed = !!user && (role === "owner" || role === "member");
    const { items, error, reload } = useItems(client, allowed);
    const [form, setForm] = useState(null);
    const [filter, setFilter] = useState("V\u0161e");
    const all = useMemo(() => allowed && items || [], [items, allowed]);
    const { soldCount, totalProfit } = useMemo(() => summarize(all), [all]);
    const brands = useMemo(() => uniqueBrands(all), [all]);
    const visible = filter === "V\u0161e" ? all : all.filter((i) => i.status === filter);
    const countFor = (x) => x === "V\u0161e" ? all.length : all.filter((i) => i.status === x).length;
    if (!client)
      return /* @__PURE__ */ React.createElement("p", { className: "text-muted" }, "Resell tracker pot\u0159ebuje synchronizaci se Supabase. Dopl\u0148 config.js.");
    if (!user)
      return /* @__PURE__ */ React.createElement("div", { className: "card p-6 max-w-md flex flex-col gap-3 items-start" }, /* @__PURE__ */ React.createElement("p", null, "Tracker se ukazuje jen p\u0159ihl\xE1\u0161en\xFDm."), onLogin && /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-primary", onClick: onLogin }, /* @__PURE__ */ React.createElement(Ico, { name: "LogIn", size: 15 }), "P\u0159ihl\xE1sit"));
    if (role === "loading") return /* @__PURE__ */ React.createElement("p", { className: "text-muted" }, "Ov\u011B\u0159uji p\u0159\xEDstup\u2026");
    if (!allowed)
      return /* @__PURE__ */ React.createElement("div", { className: "card p-6 max-w-md" }, /* @__PURE__ */ React.createElement("p", null, "Tenhle \xFA\u010Det k trackeru zat\xEDm nem\xE1 p\u0159\xEDstup."), /* @__PURE__ */ React.createElement("p", { className: "text-sm text-muted mt-1" }, "Robin ho mus\xED p\u0159idat v Supabase (skript 3-pridat-lucku.sql)."));
    return /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement(Stats, { soldCount, totalProfit, inStock: all.length - soldCount }), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center justify-between gap-3 mb-4" }, /* @__PURE__ */ React.createElement("div", { className: "seg", role: "group", "aria-label": "Filtr podle stavu" }, FILTERS.map((x) => /* @__PURE__ */ React.createElement("button", { key: x, type: "button", "aria-pressed": filter === x, onClick: () => setFilter(x) }, x, " ", /* @__PURE__ */ React.createElement("span", { className: "tnum text-muted" }, countFor(x))))), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-primary", onClick: () => setForm({ item: null }) }, /* @__PURE__ */ React.createElement(Ico, { name: "Plus", size: 15 }), "P\u0159idat kus")), error && /* @__PURE__ */ React.createElement("p", { role: "alert", className: "text-sm mb-4", style: { color: "var(--accent)" } }, error), items === null && !error && /* @__PURE__ */ React.createElement("p", { className: "text-muted" }, "Na\u010D\xEDt\xE1m polo\u017Eky\u2026"), items && all.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "card border-dashed p-6 text-center text-muted" }, "Sklad je pr\xE1zdn\xFD. P\u0159idej prvn\xED kus."), all.length > 0 && visible.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "text-muted py-6 text-center" }, "V tomhle stavu te\u010F nic nem\xE1\u0161."), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" }, visible.map((i) => /* @__PURE__ */ React.createElement(ItemCard, { key: i.id, item: i, client, onOpen: () => setForm({ item: i }) }))), form && /* @__PURE__ */ React.createElement(
      ItemForm,
      {
        item: form.item,
        client,
        brands,
        onClose: (changed) => {
          setForm(null);
          changed && reload();
        }
      }
    ));
  }
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
          setMsg(/confirm/i.test(error.message) ? "Nejd\u0159\xEDv potvr\u010F e\u2011mail p\u0159es odkaz, kter\xFD ti p\u0159i\u0161el." : "P\u0159ihl\xE1\u0161en\xED se nepovedlo. Zkontroluj e\u2011mail a heslo.");
      });
    };
    const signUp = () => run(async () => {
      if (pw.length < 8) return setMsg("Heslo mus\xED m\xEDt aspo\u0148 8 znak\u016F.");
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password: pw,
        options: { emailRedirectTo: location.origin + location.pathname }
      });
      if (error) return setMsg("\xDA\u010Det se nepoda\u0159ilo vytvo\u0159it: " + error.message);
      setMsg(data.session ? "\xDA\u010Det je hotov\xFD. Te\u010F ti Robin mus\xED d\xE1t p\u0159\xEDstup." : "P\u0159i\u0161el ti e\u2011mail. Potvr\u010F ho a pak se p\u0159ihlas.");
    });
    return /* @__PURE__ */ React.createElement("form", { onSubmit: signIn, className: "card p-5 max-w-sm w-full flex flex-col gap-3 text-sm" }, /* @__PURE__ */ React.createElement("h1", { className: "font-display text-2xl font-bold" }, "Resell ", /* @__PURE__ */ React.createElement("span", { className: "text-accent" }, "tracker")), /* @__PURE__ */ React.createElement(Field, { label: "E\u2011mail" }, /* @__PURE__ */ React.createElement("input", { className: "field", type: "email", autoComplete: "email", value: email, onChange: (e) => setEmail(e.target.value), required: true })), /* @__PURE__ */ React.createElement(Field, { label: "Heslo" }, /* @__PURE__ */ React.createElement("input", { className: "field", type: "password", autoComplete: "current-password", value: pw, onChange: (e) => setPw(e.target.value), required: true })), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-2" }, /* @__PURE__ */ React.createElement("button", { type: "submit", className: "btn btn-primary", disabled: busy }, /* @__PURE__ */ React.createElement(Ico, { name: "LogIn", size: 15 }), "P\u0159ihl\xE1sit"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", disabled: busy || !email || !pw, onClick: signUp }, "Vytvo\u0159it \xFA\u010Det")), msg && /* @__PURE__ */ React.createElement("p", { style: { color: "var(--accent)" } }, msg));
  }
  function StandaloneApp() {
    const cfg = window.RP_CONFIG || {};
    const [client] = useState(
      () => cfg.supabaseUrl && window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null
    );
    const [user, setUser] = useState(void 0);
    useEffect(() => {
      if (!client) return setUser(null);
      client.auth.getSession().then(({ data: data2 }) => setUser(data2.session ? data2.session.user : null));
      const { data } = client.auth.onAuthStateChange((_e, s) => setUser(s ? s.user : null));
      return () => data.subscription.unsubscribe();
    }, [client]);
    const role = useRole(client, user || null);
    if (user === void 0) return null;
    if (!user)
      return /* @__PURE__ */ React.createElement("main", { className: "gutter min-h-screen grid place-items-center py-10" }, /* @__PURE__ */ React.createElement(LoginCard, { client }));
    return /* @__PURE__ */ React.createElement("main", { className: "gutter", style: { paddingBlock: "16px 64px" } }, /* @__PURE__ */ React.createElement("div", { className: "max-w-6xl mx-auto" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between gap-3 mb-1" }, /* @__PURE__ */ React.createElement("h1", { className: "font-display text-2xl font-bold" }, "Resell ", /* @__PURE__ */ React.createElement("span", { className: "text-accent" }, "tracker")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", onClick: () => client.auth.signOut() }, /* @__PURE__ */ React.createElement(Ico, { name: "LogOut", size: 14 }), "Odhl\xE1sit")), /* @__PURE__ */ React.createElement(ResellTab, { client, user, role })));
  }
  window.RPResell = { ResellTab, StandaloneApp, useRole, netProfit, summarize };
})();
