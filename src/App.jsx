import React, { useState, useEffect, useCallback } from "react";
import {
  Package, Star, ChevronRight, Search, Home, User, ListOrdered,
  Wallet, Bell, Navigation, CheckCircle2, Phone, Power, Plus,
  GitBranch, Layers, Trash2, LogOut, Eye, EyeOff, ArrowLeft,
  Clock, MapPin, ShieldCheck, Check, Camera, Receipt, X, AlertCircle
} from "lucide-react";
import { supabase } from "./supabaseClient";
import LocationPickerModal, { haversineDistance } from "./LocationPicker";

/* ===========================================================
   MANHÏA — prototype fonctionnel (Supabase)
   Comptes réels, courses persistées en base, temps réel
=========================================================== */

const C = {
  sand: "#F2E9DC",
  sandDeep: "#E8DBC6",
  lagoon: "#1F5D50",
  lagoonDeep: "#153F37",
  clay: "#C86A3E",
  zem: "#F0B429",
  ink: "#22201B",
  inkSoft: "#5B564C",
  line: "#D8CBB0",
  white: "#FFFDF9",
  danger: "#B4432E",
};

const FONT_DISPLAY = "'Space Grotesk', sans-serif";
const FONT_BODY = "'Inter', sans-serif";

const NEIGHBORHOODS = [
  "Cadjehoun", "Akpakpa", "Fidjrossè", "Marché Dantokpa", "Godomey",
  "Sainte-Rita", "Zogbo", "Vêdoko", "Gbégamey", "Aïbatin",
];

const BASE_PRICE = 300;
const PRICE_PER_KM = 70;
const PRICE_PER_EXTRA_COURSE_KM_BONUS = 0; // réservé pour ajustement futur

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------- Supabase helpers ---------------- */

async function findUserByPhone(phone) {
  const { data, error } = await supabase.from("users").select("*").eq("phone", phone).maybeSingle();
  if (error) return null;
  return data;
}

async function createUser(user) {
  const { data, error } = await supabase
    .from("users")
    .insert({
      name: user.name,
      phone: user.phone,
      password: user.password,
      role: user.role,
      rating: 5.0,
      balance: 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateUserBalance(userId, balance) {
  await supabase.from("users").update({ balance }).eq("id", userId);
}

async function createCourse(course) {
  const { data, error } = await supabase
    .from("courses")
    .insert({
      client_id: course.clientId,
      client_name: course.clientName,
      client_phone: course.clientPhone,
      mode: course.mode,
      item: course.item,
      stops: course.stops,
      price: course.price,
      distance_km: course.distanceKm ?? null,
      needs_purchase: course.needsPurchase || false,
      purchase_budget: course.needsPurchase ? course.purchaseBudget : null,
      status: "en_attente",
      history: course.history,
    })
    .select()
    .single();
  if (error) throw error;
  return mapCourseFromDb(data);
}

function mapCourseFromDb(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    livreurId: row.livreur_id,
    livreurName: row.livreur_name,
    mode: row.mode,
    item: row.item,
    stops: row.stops,
    price: Number(row.price),
    distanceKm: row.distance_km != null ? Number(row.distance_km) : null,
    needsPurchase: row.needs_purchase || false,
    purchaseBudget: row.purchase_budget != null ? Number(row.purchase_budget) : null,
    purchaseActual: row.purchase_actual != null ? Number(row.purchase_actual) : null,
    receiptPhotoUrl: row.receipt_photo_url || null,
    status: row.status,
    history: row.history || [],
    createdAt: new Date(row.created_at).getTime(),
  };
}

async function fetchAllCourses() {
  const { data, error } = await supabase.from("courses").select("*").order("created_at", { ascending: false });
  if (error) return [];
  return data.map(mapCourseFromDb);
}

async function updateCourse(courseId, patch) {
  const dbPatch = {};
  if (patch.status) dbPatch.status = patch.status;
  if (patch.livreurId !== undefined) dbPatch.livreur_id = patch.livreurId;
  if (patch.livreurName !== undefined) dbPatch.livreur_name = patch.livreurName;
  if (patch.history) dbPatch.history = patch.history;
  if (patch.purchaseActual !== undefined) dbPatch.purchase_actual = patch.purchaseActual;
  if (patch.receiptPhotoUrl !== undefined) dbPatch.receipt_photo_url = patch.receiptPhotoUrl;
  const { error } = await supabase.from("courses").update(dbPatch).eq("id", courseId);
  if (error) throw error;
}

async function uploadReceiptPhoto(courseId, file) {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${courseId}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("receipts").upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("receipts").getPublicUrl(path);
  return data.publicUrl;
}

async function cancelCourseRequest(courseId, cancelledBy, reason, history) {
  const { error } = await supabase
    .from("courses")
    .update({
      status: "annulee",
      cancelled_by: cancelledBy,
      cancel_reason: reason,
      history: [...history, { label: `Course annulée (${cancelledBy})`, at: Date.now() }],
    })
    .eq("id", courseId);
  if (error) throw error;
}

async function submitPasswordRequest(name, phone, message) {
  const { error } = await supabase.from("password_requests").insert({ name, phone, message });
  if (error) throw error;
}

async function submitComplaint({ courseId, reporterId, reporterName, reporterRole, reason, description }) {
  const { error } = await supabase.from("complaints").insert({
    course_id: courseId,
    reporter_id: reporterId,
    reporter_name: reporterName,
    reporter_role: reporterRole,
    reason,
    description,
  });
  if (error) throw error;
}



/* ---------------- small UI atoms ---------------- */

function Tag({ children, tone = "lagoon" }) {
  const map = {
    lagoon: [C.lagoon, C.white],
    clay: [C.clay, C.white],
    zem: [C.zem, C.ink],
    ink: [C.ink, C.white],
    danger: [C.danger, C.white],
  };
  const [bg, fg] = map[tone] || map.lagoon;
  return (
    <span
      className="px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ background: bg, color: fg, fontFamily: FONT_DISPLAY }}
    >
      {children}
    </span>
  );
}

function RouteDots({ width = 300 }) {
  return (
    <svg width="100%" height="40" viewBox={`0 0 ${width} 40`} fill="none">
      <circle cx="16" cy="8" r="5.5" fill={C.lagoon} />
      <line x1="16" y1="15" x2="16" y2="28" stroke={C.line} strokeWidth="2" strokeDasharray="1 6" strokeLinecap="round" />
      <path d={`M16 28 Q16 34 22 34 L${width - 20} 34`} stroke={C.line} strokeWidth="2" strokeDasharray="1 6" fill="none" strokeLinecap="round" />
      <circle cx={width - 20} cy="34" r="5.5" fill={C.clay} />
    </svg>
  );
}

function PrimaryButton({ children, onClick, tone = "clay", disabled, full = true }) {
  const bg = disabled ? C.line : tone === "clay" ? C.clay : tone === "lagoon" ? C.lagoon : C.ink;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${full ? "w-full" : ""} py-3.5 rounded-2xl text-sm font-bold transition active:scale-[0.98]`}
      style={{ background: bg, color: disabled ? C.inkSoft : C.white, fontFamily: FONT_DISPLAY }}
    >
      {children}
    </button>
  );
}

function TextField({ label, value, onChange, type = "text", placeholder, icon: Icon }) {
  const [show, setShow] = useState(false);
  const isPwd = type === "password";
  return (
    <div>
      <label className="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: C.white, border: `1px solid ${C.line}` }}>
        {Icon && <Icon size={16} color={C.inkSoft} />}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={isPwd && !show ? "password" : "text"}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: C.ink, fontFamily: FONT_BODY }}
        />
        {isPwd && (
          <button onClick={() => setShow((s) => !s)} type="button">
            {show ? <EyeOff size={15} color={C.inkSoft} /> : <Eye size={15} color={C.inkSoft} />}
          </button>
        )}
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div>
      <label className="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl px-3.5 py-3 text-sm outline-none"
        style={{ background: C.white, border: `1px solid ${C.line}`, color: C.ink, fontFamily: FONT_BODY }}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

function TopBar({ title, onBack, right }) {
  return (
    <div className="px-5 pt-6 pb-4 flex items-center justify-between sticky top-0 z-10" style={{ background: C.white, borderBottom: `1px solid ${C.line}` }}>
      <div className="flex items-center gap-3">
        {onBack && (
          <button onClick={onBack}>
            <ArrowLeft size={18} color={C.ink} />
          </button>
        )}
        <h1 className="text-lg font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{title}</h1>
      </div>
      {right}
    </div>
  );
}

function BottomNav({ tab, setTab, tone = "lagoon" }) {
  const items = [
    { key: "home", icon: Home, label: "Accueil" },
    { key: "courses", icon: ListOrdered, label: "Courses" },
    { key: "wallet", icon: Wallet, label: "Portefeuille" },
    { key: "profile", icon: User, label: "Profil" },
  ];
  const accent = tone === "lagoon" ? C.lagoon : C.clay;
  return (
    <div className="sticky bottom-0 left-0 right-0 flex justify-around items-center py-3 border-t" style={{ background: C.white, borderColor: C.line }}>
      {items.map((it) => {
        const active = tab === it.key;
        return (
          <button key={it.key} onClick={() => setTab(it.key)} className="flex flex-col items-center gap-1">
            <it.icon size={20} color={active ? accent : C.inkSoft} strokeWidth={active ? 2.4 : 1.8} />
            <span className="text-[10px]" style={{ color: active ? accent : C.inkSoft, fontWeight: active ? 700 : 500, fontFamily: FONT_DISPLAY }}>
              {it.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({ icon: Icon, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: C.sandDeep }}>
        <Icon size={22} color={C.inkSoft} />
      </div>
      <p className="text-sm font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{title}</p>
      <p className="text-xs mt-1.5 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{sub}</p>
    </div>
  );
}

/* ===========================================================
   AUTH
=========================================================== */

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login"); // login | signup
  const [role, setRole] = useState("client");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const submit = async () => {
    setError("");
    if (!phone || !password || (mode === "signup" && !name)) {
      setError("Merci de remplir tous les champs.");
      return;
    }
    setLoading(true);
    try {
      const existing = await findUserByPhone(phone);

      if (mode === "signup") {
        if (existing) {
          setError("Un compte existe déjà avec ce numéro.");
          setLoading(false);
          return;
        }
        const created = await createUser({ name, phone, password, role });
        setLoading(false);
        onAuth({
          id: created.id,
          name: created.name,
          phone: created.phone,
          role: created.role,
          rating: created.rating,
          balance: created.balance,
        });
      } else {
        if (!existing) {
          setError("Aucun compte avec ce numéro. Créez un compte.");
          setLoading(false);
          return;
        }
        if (existing.password !== password) {
          setError("Mot de passe incorrect.");
          setLoading(false);
          return;
        }
        setLoading(false);
        onAuth({
          id: existing.id,
          name: existing.name,
          phone: existing.phone,
          role: existing.role,
          rating: existing.rating,
          balance: existing.balance,
        });
      }
    } catch (e) {
      setError("Une erreur est survenue. Vérifiez votre connexion.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center px-6 py-10" style={{ background: C.sand }}>
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full" style={{ background: C.lagoon }} />
          <span className="text-[11px] font-bold tracking-[0.3em] uppercase" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
            Cotonou · Bénin
          </span>
          <div className="w-2 h-2 rounded-full" style={{ background: C.clay }} />
        </div>
        <h1 className="text-4xl font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Manhïa</h1>
        <p className="text-xs mt-2" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          Vos colis et courses, livrés avec un prix fixe et un suivi en temps réel.
        </p>
      </div>

      <div className="max-w-sm w-full mx-auto">
        <div className="flex rounded-full p-1 mb-6" style={{ background: C.sandDeep }}>
          {["login", "signup"].map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); }}
              className="flex-1 py-2.5 rounded-full text-xs font-bold"
              style={{
                background: mode === m ? C.ink : "transparent",
                color: mode === m ? C.white : C.inkSoft,
                fontFamily: FONT_DISPLAY,
              }}
            >
              {m === "login" ? "Connexion" : "Créer un compte"}
            </button>
          ))}
        </div>

        {mode === "signup" && (
          <div className="mb-4">
            <label className="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
              Je suis...
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: "client", label: "Client", sub: "J'envoie des colis" },
                { key: "livreur", label: "Livreur", sub: "Je fais des courses" },
              ].map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRole(r.key)}
                  className="rounded-xl p-3 text-left"
                  style={{
                    background: C.white,
                    border: `2px solid ${role === r.key ? (r.key === "client" ? C.lagoon : C.clay) : C.line}`,
                  }}
                >
                  <p className="text-xs font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{r.label}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{r.sub}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {mode === "signup" && (
            <TextField label="Nom complet" value={name} onChange={setName} placeholder="Ex: Aïcha Bello" icon={User} />
          )}
          <TextField label="Numéro de téléphone" value={phone} onChange={setPhone} placeholder="Ex: 97 00 00 00" icon={Phone} />
          <TextField label="Mot de passe" value={password} onChange={setPassword} type="password" placeholder="••••••" />
        </div>

        {mode === "login" && (
          <button onClick={() => setShowForgot(true)} className="mt-3">
            <span className="text-xs font-semibold underline" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
              Mot de passe oublié ?
            </span>
          </button>
        )}

        {error && (
          <p className="text-xs mt-3 font-semibold" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>
        )}

        <div className="mt-6">
          <PrimaryButton onClick={submit} disabled={loading} tone={role === "livreur" && mode === "signup" ? "clay" : "lagoon"}>
            {loading ? "Un instant..." : mode === "login" ? "Se connecter" : "Créer mon compte"}
          </PrimaryButton>
        </div>

        <p className="text-[11px] text-center mt-4 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          Prototype de démonstration — vos données restent dans cet environnement de test.
        </p>
      </div>

      {showForgot && <ForgotPasswordModal onClose={() => setShowForgot(false)} />}
    </div>
  );
}

function ForgotPasswordModal({ onClose }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!name || !phone) {
      setError("Indiquez au moins votre nom et votre numéro.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await submitPasswordRequest(name, phone, message);
      setDone(true);
    } catch {
      setError("Erreur d'envoi. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(34,32,27,0.5)" }}>
      <div className="w-full rounded-t-3xl p-5 pb-8" style={{ background: C.white }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Mot de passe oublié</h2>
          <button onClick={onClose}><X size={18} color={C.inkSoft} /></button>
        </div>

        {done ? (
          <div className="py-4 text-center">
            <CheckCircle2 size={32} color={C.lagoon} className="mx-auto mb-3" />
            <p className="text-sm font-semibold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Demande envoyée</p>
            <p className="text-xs mt-2 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
              L'équipe Manhïa vous contactera bientôt pour réinitialiser votre accès.
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs mb-4 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
              Indiquez vos informations, l'équipe Manhïa vous recontactera pour réinitialiser votre mot de passe.
            </p>
            <div className="space-y-3">
              <TextField label="Nom complet" value={name} onChange={setName} placeholder="Votre nom" icon={User} />
              <TextField label="Numéro de téléphone" value={phone} onChange={setPhone} placeholder="Votre numéro" icon={Phone} />
              <TextField label="Message (optionnel)" value={message} onChange={setMessage} placeholder="Précisez si besoin" />
            </div>
            {error && <p className="text-xs mt-3" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}
            <div className="mt-5">
              <PrimaryButton onClick={submit} disabled={submitting}>
                {submitting ? "Envoi..." : "Envoyer la demande"}
              </PrimaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ===========================================================
   CLIENT APP
=========================================================== */

function computeTotalDistance(stops) {
  // stops: array of {lat, lng, label}
  let total = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    total += haversineDistance(stops[i], stops[i + 1]);
  }
  return total;
}

function computePrice(stops, mode) {
  const distanceKm = computeTotalDistance(stops);
  const distancePrice = Math.round(distanceKm * PRICE_PER_KM);
  const price = BASE_PRICE + distancePrice;
  return { price, distanceKm };
}

function NewCourseFlow({ user, onCreated, onCancel }) {
  const [step, setStep] = useState("mode"); // mode | build
  const [mode, setMode] = useState("tournee");
  const [stops, setStops] = useState([null, null]); // {label, lat, lng} | null
  const [item, setItem] = useState("Petit colis");
  const [needsPurchase, setNeedsPurchase] = useState(false);
  const [purchaseBudget, setPurchaseBudget] = useState("2000");
  const [posting, setPosting] = useState(false);
  const [pickerIndex, setPickerIndex] = useState(null); // index en cours d'édition sur la carte

  const addStop = () => {
    if (stops.length >= 5) return;
    const next = [...stops];
    next.splice(next.length - 1, 0, null); // insère avant la destination finale
    setStops(next);
  };
  const removeStop = (i) => {
    if (stops.length <= 2) return;
    setStops(stops.filter((_, idx) => idx !== i));
  };

  const allSet = stops.every((s) => s && s.lat);
  const { price, distanceKm } = allSet ? computePrice(stops, mode) : { price: 0, distanceKm: 0 };
  const budgetValue = needsPurchase ? Math.max(0, parseInt(purchaseBudget, 10) || 0) : 0;
  const totalToPay = price + budgetValue;

  const confirmBooking = async () => {
    if (!allSet) return;
    setPosting(true);
    try {
      const created = await createCourse({
        clientId: user.id,
        clientName: user.name,
        clientPhone: user.phone,
        mode,
        item,
        stops,
        price,
        distanceKm,
        needsPurchase,
        purchaseBudget: budgetValue,
        history: [{ label: "Course créée", at: Date.now() }],
      });
      setPosting(false);
      onCreated(created);
    } catch (e) {
      setPosting(false);
    }
  };

  if (step === "mode") {
    return (
      <div className="pb-6">
        <TopBar title="Nouvelle course" onBack={onCancel} />
        <p className="text-xs px-5 mt-3" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          Plusieurs destinations ? Choisissez comment organiser votre course.
        </p>
        <div className="px-5 mt-5 space-y-3">
          <button
            onClick={() => { setMode("tournee"); setStep("build"); }}
            className="w-full text-left rounded-2xl p-4"
            style={{ background: C.white, border: `2px solid ${C.lagoon}` }}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: `${C.lagoon}1A` }}>
                <GitBranch size={18} color={C.lagoon} />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Une tournée, plusieurs arrêts</p>
                <p className="text-xs mt-1 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                  Un seul livreur passe par tous vos points. Un seul prix, un seul suivi.
                </p>
              </div>
            </div>
          </button>
          <button
            onClick={() => { setMode("multiple"); setStep("build"); }}
            className="w-full text-left rounded-2xl p-4"
            style={{ background: C.white, border: `2px solid ${C.clay}` }}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: `${C.clay}1A` }}>
                <Layers size={18} color={C.clay} />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Plusieurs courses séparées</p>
                <p className="text-xs mt-1 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                  Chaque trajet est indépendant, avec son propre livreur. Idéal si c'est urgent.
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-28">
      <TopBar
        title={mode === "multiple" ? "Courses séparées" : "Tournée multi-arrêts"}
        onBack={() => setStep("mode")}
        right={<Tag tone={mode === "multiple" ? "clay" : "lagoon"}>{stops.length - 1} {mode === "multiple" ? "course(s)" : "arrêt(s)"}</Tag>}
      />

      <div className="px-5 mt-4">
        <div className="rounded-2xl p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
          {stops.map((s, i) => {
            const isFirst = i === 0;
            const isLast = i === stops.length - 1;
            const dotColor = isFirst ? C.lagoon : isLast ? C.clay : C.zem;
            return (
              <div key={i}>
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dotColor }} />
                  <button
                    onClick={() => setPickerIndex(i)}
                    className="flex-1 text-left"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
                      {isFirst ? "Départ" : isLast ? "Arrivée" : `Arrêt ${i}`}
                      {mode === "multiple" && i > 0 ? ` · Course ${i}` : ""}
                    </p>
                    <p className="text-sm truncate" style={{ color: s ? C.ink : C.inkSoft, fontFamily: FONT_BODY }}>
                      {s ? s.label : "Toucher pour choisir sur la carte"}
                    </p>
                  </button>
                  {!isFirst && !isLast && (
                    <button onClick={() => removeStop(i)}>
                      <Trash2 size={14} color={C.inkSoft} />
                    </button>
                  )}
                </div>
                {i < stops.length - 1 && <div className="h-px my-3" style={{ background: C.line }} />}
              </div>
            );
          })}
          <button onClick={addStop} disabled={stops.length >= 5} className="w-full flex items-center justify-center gap-1.5 mt-3 py-2 rounded-xl" style={{ border: `1px dashed ${C.line}`, opacity: stops.length >= 5 ? 0.4 : 1 }}>
            <Plus size={13} color={C.inkSoft} />
            <span className="text-xs font-semibold" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
              {mode === "multiple" ? "Ajouter une course" : "Ajouter un arrêt"}
            </span>
          </button>
        </div>
      </div>

      <div className="px-5 mt-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] mb-3" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
          Que transportez-vous ?
        </p>
        <div className="flex gap-2 flex-wrap">
          {["Document", "Petit colis", "Courses pharmacie/boutique"].map((t) => (
            <button
              key={t}
              onClick={() => setItem(t)}
              className="px-3.5 py-2 rounded-full text-xs font-semibold"
              style={{
                background: item === t ? C.lagoon : C.white,
                color: item === t ? C.white : C.ink,
                border: `1px solid ${item === t ? C.lagoon : C.line}`,
                fontFamily: FONT_BODY,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 mt-5">
        <button
          onClick={() => setNeedsPurchase((v) => !v)}
          className="w-full rounded-2xl p-4 flex items-start gap-3 text-left"
          style={{ background: C.white, border: `2px solid ${needsPurchase ? C.zem : C.line}` }}
        >
          <div
            className="w-5 h-5 rounded-md shrink-0 mt-0.5 flex items-center justify-center"
            style={{ background: needsPurchase ? C.zem : C.sandDeep, border: `1px solid ${needsPurchase ? C.zem : C.line}` }}
          >
            {needsPurchase && <Check size={13} color={C.ink} strokeWidth={3} />}
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>
              Le livreur doit acheter quelque chose pour moi
            </p>
            <p className="text-xs mt-1 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
              Ex : médicaments à la pharmacie, articles au supermarché. Le livreur avance l'argent, vous êtes remboursé ou réglez la différence à la livraison.
            </p>
          </div>
        </button>

        {needsPurchase && (
          <div className="mt-3 rounded-2xl p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
            <label className="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
              Budget estimé pour l'achat
            </label>
            <div className="flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: C.sand, border: `1px solid ${C.line}` }}>
              <input
                type="number"
                inputMode="numeric"
                value={purchaseBudget}
                onChange={(e) => setPurchaseBudget(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: C.ink, fontFamily: FONT_BODY }}
              />
              <span className="text-xs font-semibold" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>FCFA</span>
            </div>
            <p className="text-[10px] mt-2 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
              Ce montant est mis de côté pour l'achat. Le montant réel sera ajusté après la course, avec le reçu du livreur comme preuve.
            </p>
          </div>
        )}
      </div>

      <div className="px-5 mt-6">
        <div className="rounded-2xl p-4" style={{ background: C.lagoonDeep }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px]" style={{ color: "#BFE0D6", fontFamily: FONT_BODY }}>
                {allSet ? "Total à payer" : "Choisissez tous les points"}
              </p>
              <p className="text-2xl font-bold" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>
                {allSet ? `${totalToPay.toLocaleString()} FCFA` : "—"}
              </p>
            </div>
            <ShieldCheck size={26} color={C.zem} />
          </div>
          <div className="h-px my-3" style={{ background: "#2C7166" }} />
          <div className="flex justify-between text-[11px]" style={{ fontFamily: FONT_BODY }}>
            <span style={{ color: "#BFE0D6" }}>Trajet · {allSet ? price.toLocaleString() : "—"} FCFA</span>
            <span style={{ color: C.zem }}>
              {allSet ? `${distanceKm.toFixed(1)} km · ${PRICE_PER_KM} FCFA/km` : "en attente des points"}
            </span>
          </div>
          {needsPurchase && (
            <div className="flex justify-between text-[11px] mt-1.5" style={{ fontFamily: FONT_BODY }}>
              <span style={{ color: "#BFE0D6" }}>Dépôt achat</span>
              <span style={{ color: C.zem }}>{budgetValue.toLocaleString()} FCFA (estimé)</span>
            </div>
          )}
        </div>
      </div>

      <div className="px-5 mt-5">
        <PrimaryButton onClick={confirmBooking} disabled={posting || !allSet}>
          {posting ? "Publication..." : !allSet ? "Complétez tous les points" : "Confirmer et publier la course"}
        </PrimaryButton>
      </div>

      {pickerIndex !== null && (
        <LocationPickerModal
          label={pickerIndex === 0 ? "Point de départ" : pickerIndex === stops.length - 1 ? "Point d'arrivée" : `Arrêt ${pickerIndex}`}
          color={pickerIndex === 0 ? "depart" : pickerIndex === stops.length - 1 ? "arrivee" : "arret"}
          initialPosition={stops[pickerIndex]}
          onClose={() => setPickerIndex(null)}
          onConfirm={(place) => {
            const next = [...stops];
            next[pickerIndex] = place;
            setStops(next);
            setPickerIndex(null);
          }}
        />
      )}
    </div>
  );
}

function shortLabel(stop) {
  if (!stop) return "";
  const text = typeof stop === "string" ? stop : stop.label || "";
  const parts = text.split(",");
  return parts.slice(0, 2).join(",").trim() || text;
}

function CourseCard({ course, highlight, onCancel, onReport }) {
  const statusTone = {
    en_attente: "zem",
    acceptee: "lagoon",
    en_cours: "clay",
    livree: "ink",
    annulee: "danger",
  }[course.status];
  const statusLabel = {
    en_attente: "En attente d'un livreur",
    acceptee: "Livreur en route",
    en_cours: "Livraison en cours",
    livree: "Livrée",
    annulee: "Annulée",
  }[course.status];

  const canCancel = onCancel && (course.status === "en_attente" || course.status === "acceptee");
  const canReport = onReport && course.status === "livree";

  return (
    <div className="rounded-2xl p-4" style={{ background: C.white, border: `1px solid ${highlight ? C.zem : C.line}`, borderWidth: highlight ? 2 : 1 }}>
      <div className="flex items-center justify-between mb-2">
        <Tag tone={statusTone}>{statusLabel}</Tag>
        <span className="text-sm font-bold" style={{ color: C.clay, fontFamily: FONT_DISPLAY }}>{course.price.toLocaleString()} F</span>
      </div>
      <RouteDots />
      <div className="flex justify-between text-xs mt-1 gap-2" style={{ fontFamily: FONT_BODY }}>
        <span style={{ color: C.ink }} className="truncate">{shortLabel(course.stops[0])}</span>
        <span style={{ color: C.ink }} className="truncate text-right">{shortLabel(course.stops[course.stops.length - 1])}</span>
      </div>
      {course.distanceKm != null && (
        <p className="text-[10px] mt-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          {course.distanceKm.toFixed(1)} km
        </p>
      )}
      {course.stops.length > 2 && (
        <p className="text-[10px] mt-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          + {course.stops.length - 2} arrêt(s) intermédiaire(s)
        </p>
      )}
      {course.livreurName && (
        <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
          <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: C.sandDeep }}>
            <User size={13} color={C.inkSoft} />
          </div>
          <span className="text-xs font-semibold" style={{ color: C.ink, fontFamily: FONT_BODY }}>{course.livreurName}</span>
        </div>
      )}
      {course.needsPurchase && (
        <div className="mt-3 pt-3 rounded-xl" style={{ borderTop: `1px solid ${C.line}` }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
            Achat pour vous
          </p>
          {course.purchaseActual == null ? (
            <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
              Dépôt de {(course.purchaseBudget || 0).toLocaleString()} FCFA — en attente de l'achat
            </p>
          ) : (
            (() => {
              const diff = course.purchaseActual - (course.purchaseBudget || 0);
              return (
                <p className="text-xs" style={{ color: diff > 0 ? C.clay : C.lagoon, fontFamily: FONT_BODY }}>
                  Dépensé : {course.purchaseActual.toLocaleString()} FCFA —{" "}
                  {diff > 0
                    ? `${diff.toLocaleString()} FCFA à régler`
                    : diff < 0
                    ? `${Math.abs(diff).toLocaleString()} FCFA à rembourser`
                    : "montant exact"}
                </p>
              );
            })()
          )}
        </div>
      )}
      {course.status === "annulee" && course.cancel_reason && (
        <p className="text-xs mt-3 pt-3" style={{ color: C.inkSoft, fontFamily: FONT_BODY, borderTop: `1px solid ${C.line}` }}>
          Motif : {course.cancel_reason}
        </p>
      )}
      {(canCancel || canReport) && (
        <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
          {canCancel && (
            <button
              onClick={() => onCancel(course)}
              className="flex-1 py-2 rounded-xl text-xs font-bold"
              style={{ background: C.white, border: `1px solid ${C.danger}`, color: C.danger, fontFamily: FONT_DISPLAY }}
            >
              Annuler la course
            </button>
          )}
          {canReport && (
            <button
              onClick={() => onReport(course)}
              className="flex-1 py-2 rounded-xl text-xs font-bold"
              style={{ background: C.white, border: `1px solid ${C.line}`, color: C.inkSoft, fontFamily: FONT_DISPLAY }}
            >
              Signaler un problème
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CancelCourseModal({ course, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const reasons = ["Changement de plan", "Trop long à trouver un livreur", "Erreur dans la commande", "Autre"];

  const confirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm(reason || "Non précisé");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(34,32,27,0.5)" }}>
      <div className="w-full rounded-t-3xl p-5 pb-8" style={{ background: C.white }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Annuler la course</h2>
          <button onClick={onClose}><X size={18} color={C.inkSoft} /></button>
        </div>
        <p className="text-xs mb-4" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Pourquoi annulez-vous cette course ?</p>
        <div className="space-y-2 mb-5">
          {reasons.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className="w-full text-left px-4 py-3 rounded-xl text-sm"
              style={{
                background: reason === r ? C.sandDeep : C.white,
                border: `1px solid ${reason === r ? C.clay : C.line}`,
                color: C.ink,
                fontFamily: FONT_BODY,
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <button
          onClick={confirm}
          disabled={submitting}
          className="w-full py-3.5 rounded-2xl text-sm font-bold"
          style={{ background: C.danger, color: C.white, fontFamily: FONT_DISPLAY }}
        >
          {submitting ? "..." : "Confirmer l'annulation"}
        </button>
      </div>
    </div>
  );
}

function ReportComplaintModal({ course, reporter, onClose, onSubmitted }) {
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const reasons = ["Retard important", "Colis endommagé", "Comportement inapproprié", "Montant incorrect", "Autre"];

  const submit = async () => {
    if (!reason) {
      setError("Choisissez un motif.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await submitComplaint({
        courseId: course.id,
        reporterId: reporter.id,
        reporterName: reporter.name,
        reporterRole: reporter.role,
        reason,
        description,
      });
      setDone(true);
    } catch {
      setError("Erreur d'envoi. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(34,32,27,0.5)" }}>
      <div className="w-full rounded-t-3xl p-5 pb-8" style={{ background: C.white, maxHeight: "85vh", overflowY: "auto" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Signaler un problème</h2>
          <button onClick={() => { onClose(); if (done) onSubmitted?.(); }}><X size={18} color={C.inkSoft} /></button>
        </div>

        {done ? (
          <div className="py-4 text-center">
            <CheckCircle2 size={32} color={C.lagoon} className="mx-auto mb-3" />
            <p className="text-sm font-semibold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Signalement envoyé</p>
            <p className="text-xs mt-2 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
              L'équipe Manhïa va examiner votre signalement.
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs mb-3" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Quel est le problème ?</p>
            <div className="space-y-2 mb-4">
              {reasons.map((r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className="w-full text-left px-4 py-3 rounded-xl text-sm"
                  style={{
                    background: reason === r ? C.sandDeep : C.white,
                    border: `1px solid ${reason === r ? C.clay : C.line}`,
                    color: C.ink,
                    fontFamily: FONT_BODY,
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
            <TextField label="Détails (optionnel)" value={description} onChange={setDescription} placeholder="Décrivez ce qui s'est passé" />
            {error && <p className="text-xs mt-3" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}
            <div className="mt-5">
              <PrimaryButton onClick={submit} disabled={submitting}>
                {submitting ? "Envoi..." : "Envoyer le signalement"}
              </PrimaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ClientApp({ user, onLogout }) {
  const [tab, setTab] = useState("home");
  const [booking, setBooking] = useState(false);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);

  const loadCourses = useCallback(async () => {
    const all = await fetchAllCourses();
    const mine = all.filter((c) => c.clientId === user.id);
    setCourses(mine);
    setLoading(false);
  }, [user.id]);

  useEffect(() => {
    loadCourses();
    const channel = supabase
      .channel("courses-client")
      .on("postgres_changes", { event: "*", schema: "public", table: "courses" }, () => {
        loadCourses();
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadCourses]);

  const handleCancel = async (reason) => {
    await cancelCourseRequest(cancelTarget.id, "client", reason, cancelTarget.history);
    setCancelTarget(null);
    loadCourses();
  };

  if (booking) {
    return (
      <div style={{ background: C.sand, minHeight: "100vh" }}>
        <NewCourseFlow
          user={user}
          onCancel={() => setBooking(false)}
          onCreated={() => { setBooking(false); loadCourses(); setTab("courses"); }}
        />
      </div>
    );
  }

  const active = courses.filter((c) => c.status !== "livree" && c.status !== "annulee");
  const past = courses.filter((c) => c.status === "livree");

  return (
    <div style={{ background: C.sand, minHeight: "100vh" }} className="flex flex-col">
      <div className="flex-1">
        {tab === "home" && (
          <div className="pb-6">
            <div className="px-5 pt-6 pb-6" style={{ background: C.lagoon }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: "#BFE0D6", fontFamily: FONT_DISPLAY }}>Bonjour</p>
                  <h1 className="text-xl font-bold" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>{user.name.split(" ")[0]}</h1>
                </div>
                <button onClick={onLogout} className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#2C7166" }}>
                  <LogOut size={16} color={C.white} />
                </button>
              </div>
            </div>

            <div className="px-5 -mt-3">
              <button
                onClick={() => setBooking(true)}
                className="w-full rounded-2xl p-4 shadow-md flex items-center gap-3"
                style={{ background: C.white }}
              >
                <Search size={18} color={C.inkSoft} />
                <span className="text-sm" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Où envoyez-vous votre colis ?</span>
              </button>
            </div>

            <div className="px-5 mt-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
                  Courses en cours
                </p>
                {active.length > 0 && <Tag tone="zem">{active.length}</Tag>}
              </div>
              {loading ? (
                <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Chargement...</p>
              ) : active.length === 0 ? (
                <EmptyState icon={Package} title="Aucune course en cours" sub="Créez votre première course pour voir apparaître son suivi ici." />
              ) : (
                <div className="space-y-3">
                  {active.map((c) => <CourseCard key={c.id} course={c} highlight onCancel={setCancelTarget} />)}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "courses" && (
          <div className="pb-6">
            <TopBar title="Mes courses" />
            <div className="px-5 mt-4 space-y-3">
              {courses.length === 0 ? (
                <EmptyState icon={ListOrdered} title="Aucune course pour l'instant" sub="Votre historique s'affichera ici dès votre première commande." />
              ) : (
                courses.map((c) => (
                  <CourseCard key={c.id} course={c} onCancel={setCancelTarget} onReport={setReportTarget} />
                ))
              )}
            </div>
          </div>
        )}

        {tab === "wallet" && (
          <div className="pb-6">
            <TopBar title="Portefeuille" />
            <div className="px-5 mt-4">
              <div className="rounded-2xl p-5" style={{ background: C.lagoonDeep }}>
                <p className="text-[11px]" style={{ color: "#BFE0D6", fontFamily: FONT_BODY }}>Total dépensé</p>
                <p className="text-3xl font-bold mt-1" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>
                  {courses.reduce((s, c) => s + c.price, 0).toLocaleString()} FCFA
                </p>
                <p className="text-[11px] mt-3" style={{ color: "#BFE0D6", fontFamily: FONT_BODY }}>
                  Paiement via Mobile Money (MTN, Moov) — simulation dans ce prototype.
                </p>
              </div>
            </div>
          </div>
        )}

        {tab === "profile" && (
          <div className="pb-6">
            <TopBar title="Profil" />
            <div className="px-5 mt-4">
              <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: C.white, border: `1px solid ${C.line}` }}>
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: C.sandDeep }}>
                  <User size={20} color={C.inkSoft} />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{user.name}</p>
                  <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{user.phone} · Client</p>
                </div>
              </div>
              <div className="mt-4">
                <a
                  href="https://wa.me/2290162334888"
                  target="_blank"
                  rel="noreferrer"
                  className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 mb-3"
                  style={{ background: C.white, border: `1px solid ${C.line}`, color: C.ink, fontFamily: FONT_DISPLAY }}
                >
                  <Phone size={15} /> Nous contacter
                </a>
                <button onClick={onLogout} className="w-full py-3 rounded-xl text-sm font-bold" style={{ background: C.white, border: `1px solid ${C.line}`, color: C.danger, fontFamily: FONT_DISPLAY }}>
                  Se déconnecter
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <BottomNav tab={tab} setTab={setTab} tone="lagoon" />

      {cancelTarget && (
        <CancelCourseModal
          course={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onConfirm={handleCancel}
        />
      )}
      {reportTarget && (
        <ReportComplaintModal
          course={reportTarget}
          reporter={{ id: user.id, name: user.name, role: "client" }}
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  );
}

/* ===========================================================
   LIVREUR APP
=========================================================== */

function PurchaseDeclarationModal({ course, onClose, onSubmit }) {
  const [amount, setAmount] = useState(String(course.purchaseBudget || ""));
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const submit = async () => {
    const value = parseInt(amount, 10);
    if (!value || value <= 0) {
      setError("Indiquez le montant exact dépensé.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      let photoUrl = null;
      if (photoFile) {
        photoUrl = await uploadReceiptPhoto(course.id, photoFile);
      }
      await onSubmit(value, photoUrl);
    } catch (e) {
      setError("Erreur lors de l'envoi. Réessayez.");
      setSubmitting(false);
    }
  };

  const budget = course.purchaseBudget || 0;
  const value = parseInt(amount, 10) || 0;
  const diff = value - budget;

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(34,32,27,0.5)" }}>
      <div className="w-full rounded-t-3xl p-5 pb-8" style={{ background: C.white, maxHeight: "88vh", overflowY: "auto" }}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Déclarer l'achat</h2>
          <button onClick={onClose}><ArrowLeft size={18} color={C.inkSoft} /></button>
        </div>
        <p className="text-xs mb-4" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          Budget prévu par le client : <strong>{budget.toLocaleString()} FCFA</strong>
        </p>

        <label className="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
          Montant réellement dépensé
        </label>
        <div className="flex items-center gap-2 rounded-xl px-3.5 py-3 mb-1" style={{ background: C.sand, border: `1px solid ${C.line}` }}>
          <Receipt size={16} color={C.inkSoft} />
          <input
            type="number"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: C.ink, fontFamily: FONT_BODY }}
          />
          <span className="text-xs font-semibold" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>FCFA</span>
        </div>

        {value > 0 && (
          <p className="text-xs mb-4" style={{ color: diff > 0 ? C.clay : C.lagoon, fontFamily: FONT_BODY }}>
            {diff > 0
              ? `Le client devra régler ${diff.toLocaleString()} FCFA de plus à la livraison.`
              : diff < 0
              ? `${Math.abs(diff).toLocaleString()} FCFA seront à rembourser au client.`
              : "Montant exactement conforme au budget prévu."}
          </p>
        )}

        <label className="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
          Photo du reçu (recommandé)
        </label>
        <label
          className="flex flex-col items-center justify-center gap-2 rounded-xl py-6 mb-4 cursor-pointer"
          style={{ background: C.sand, border: `1px dashed ${C.line}` }}
        >
          {photoPreview ? (
            <img src={photoPreview} alt="Reçu" className="max-h-40 rounded-lg" />
          ) : (
            <>
              <Camera size={22} color={C.inkSoft} />
              <span className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Prendre une photo du reçu</span>
            </>
          )}
          <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" />
        </label>

        {error && <p className="text-xs mb-3" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}

        <PrimaryButton onClick={submit} disabled={submitting}>
          {submitting ? "Envoi..." : "Confirmer et terminer la livraison"}
        </PrimaryButton>
      </div>
    </div>
  );
}

function LivreurApp({ user, onLogout }) {
  const [tab, setTab] = useState("home");
  const [online, setOnline] = useState(true);
  const [available, setAvailable] = useState([]);
  const [mine, setMine] = useState([]);
  const [balance, setBalance] = useState(user.balance || 0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [purchaseCourse, setPurchaseCourse] = useState(null); // course en attente de déclaration d'achat

  const load = useCallback(async () => {
    const all = await fetchAllCourses();
    setAvailable(all.filter((c) => c.status === "en_attente"));
    setMine(all.filter((c) => c.livreurId === user.id));
    setLoading(false);
  }, [user.id]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("courses-livreur")
      .on("postgres_changes", { event: "*", schema: "public", table: "courses" }, () => {
        load();
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  const acceptCourse = async (course) => {
    setBusyId(course.id);
    try {
      await updateCourse(course.id, {
        status: "acceptee",
        livreurId: user.id,
        livreurName: user.name,
        history: [...course.history, { label: `Acceptée par ${user.name}`, at: Date.now() }],
      });
    } finally {
      setBusyId(null);
      load();
    }
  };

  const finalizeDelivery = async (course) => {
    setBusyId(course.id);
    try {
      await updateCourse(course.id, {
        status: "livree",
        history: [...course.history, { label: "Livraison confirmée", at: Date.now() }],
      });
      const commission = Math.round(course.price * 0.15);
      const gain = course.price - commission;
      const newBalance = balance + gain;
      setBalance(newBalance);
      await updateUserBalance(user.id, newBalance);
    } finally {
      setBusyId(null);
      load();
    }
  };

  const advanceCourse = async (course) => {
    if (course.status === "acceptee") {
      // récupéré → en cours
      setBusyId(course.id);
      try {
        await updateCourse(course.id, {
          status: "en_cours",
          history: [...course.history, { label: "Colis récupéré, en route", at: Date.now() }],
        });
      } finally {
        setBusyId(null);
        load();
      }
      return;
    }
    // en_cours → livrée
    if (course.needsPurchase) {
      // ouvre le modal de déclaration du montant réel avant de finaliser
      setPurchaseCourse(course);
    } else {
      await finalizeDelivery(course);
    }
  };

  const activeMine = mine.filter((c) => c.status !== "livree");
  const doneMine = mine.filter((c) => c.status === "livree");
  const todayEarnings = doneMine
    .filter((c) => Date.now() - c.createdAt < 1000 * 60 * 60 * 24)
    .reduce((s, c) => s + Math.round(c.price * 0.85), 0);

  return (
    <div style={{ background: C.sand, minHeight: "100vh" }} className="flex flex-col">
      <div className="flex-1">
        {tab === "home" && (
          <div className="pb-6">
            <div className="px-5 pt-6 pb-6" style={{ background: C.ink }}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: C.zem, fontFamily: FONT_DISPLAY }}>Livreur</p>
                  <h1 className="text-xl font-bold" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>{user.name}</h1>
                </div>
                <button
                  onClick={() => setOnline((o) => !o)}
                  className="flex items-center gap-2 px-3 py-2 rounded-full"
                  style={{ background: online ? C.lagoon : "#4A4438" }}
                >
                  <Power size={13} color={C.white} />
                  <span className="text-xs font-bold" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>
                    {online ? "En ligne" : "Hors ligne"}
                  </span>
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Courses actives", value: String(activeMine.length) },
                  { label: "Gains 24h", value: todayEarnings.toLocaleString() },
                  { label: "Note", value: user.rating?.toFixed(1) || "5.0" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl p-3" style={{ background: "#332F27" }}>
                    <p className="text-lg font-bold" style={{ color: C.zem, fontFamily: FONT_DISPLAY }}>{s.value}</p>
                    <p className="text-[10px] mt-1 leading-tight" style={{ color: "#B8B2A3", fontFamily: FONT_BODY }}>{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {activeMine.length > 0 && (
              <div className="px-5 mt-5">
                <p className="text-xs font-bold uppercase tracking-[0.14em] mb-3" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
                  Vos courses en cours
                </p>
                <div className="space-y-3">
                  {activeMine.map((c) => (
                    <div key={c.id} className="rounded-2xl p-4" style={{ background: C.white, border: `2px solid ${C.zem}` }}>
                      <div className="flex items-center justify-between mb-2">
                        <Tag tone={c.status === "acceptee" ? "lagoon" : "clay"}>
                          {c.status === "acceptee" ? "À récupérer" : "En livraison"}
                        </Tag>
                        <span className="text-sm font-bold" style={{ color: C.clay, fontFamily: FONT_DISPLAY }}>{c.price.toLocaleString()} F</span>
                      </div>
                      <RouteDots />
                      <div className="flex justify-between text-xs mt-1 gap-2" style={{ fontFamily: FONT_BODY }}>
                        <span style={{ color: C.ink }} className="truncate">{shortLabel(c.stops[0])}</span>
                        <span style={{ color: C.ink }} className="truncate text-right">{shortLabel(c.stops[c.stops.length - 1])}</span>
                      </div>
                      <p className="text-[11px] mt-2" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                        Client : {c.clientName} · {c.clientPhone}
                      </p>
                      <button
                        onClick={() => advanceCourse(c)}
                        disabled={busyId === c.id}
                        className="w-full mt-3 py-2.5 rounded-xl text-sm font-bold"
                        style={{ background: C.lagoon, color: C.white, fontFamily: FONT_DISPLAY }}
                      >
                        {busyId === c.id ? "..." : c.status === "acceptee" ? "Marquer comme récupéré" : "Confirmer la livraison"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="px-5 mt-6">
              <p className="text-xs font-bold uppercase tracking-[0.14em] mb-3" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
                Demandes disponibles {online ? "" : "(passez en ligne pour voir)"}
              </p>
              {!online ? (
                <EmptyState icon={Power} title="Vous êtes hors ligne" sub="Activez votre statut en ligne pour recevoir des demandes de courses." />
              ) : loading ? (
                <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Chargement...</p>
              ) : available.length === 0 ? (
                <EmptyState icon={Package} title="Aucune demande pour l'instant" sub="Les nouvelles courses créées par les clients apparaîtront ici automatiquement." />
              ) : (
                <div className="space-y-3">
                  {available.map((c) => (
                    <div key={c.id} className="rounded-2xl p-4 shadow-md" style={{ background: C.white, border: `2px solid ${C.zem}` }}>
                      <div className="flex items-center justify-between mb-2">
                        <Tag tone="zem">{c.item}</Tag>
                        <span className="text-lg font-bold" style={{ color: C.clay, fontFamily: FONT_DISPLAY }}>{c.price.toLocaleString()} F</span>
                      </div>
                      <RouteDots />
                      <div className="flex justify-between text-xs mt-1 gap-2" style={{ fontFamily: FONT_BODY }}>
                        <span style={{ color: C.ink }} className="truncate">{shortLabel(c.stops[0])}</span>
                        <span style={{ color: C.ink }} className="truncate text-right">{shortLabel(c.stops[c.stops.length - 1])}</span>
                      </div>
                      {c.stops.length > 2 && (
                        <p className="text-[10px] mt-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                          + {c.stops.length - 2} arrêt(s)
                        </p>
                      )}
                      <button
                        onClick={() => acceptCourse(c)}
                        disabled={busyId === c.id}
                        className="w-full mt-3 py-2.5 rounded-xl text-sm font-bold"
                        style={{ background: C.lagoon, color: C.white, fontFamily: FONT_DISPLAY }}
                      >
                        {busyId === c.id ? "..." : "Accepter cette course"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "courses" && (
          <div className="pb-6">
            <TopBar title="Historique" />
            <div className="px-5 mt-4 space-y-2">
              {doneMine.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="Pas encore de course terminée" sub="Vos livraisons complétées apparaîtront ici avec le détail des gains." />
              ) : (
                doneMine.map((c) => (
                  <div key={c.id} className="rounded-xl p-3 flex items-center justify-between" style={{ background: C.white, border: `1px solid ${C.line}` }}>
                    <div className="flex items-center gap-2">
                      <Package size={14} color={C.inkSoft} />
                      <span className="text-xs" style={{ color: C.ink, fontFamily: FONT_BODY }}>{shortLabel(c.stops[0])} → {shortLabel(c.stops[c.stops.length - 1])}</span>
                    </div>
                    <span className="text-xs font-bold" style={{ color: C.lagoon, fontFamily: FONT_DISPLAY }}>
                      +{Math.round(c.price * 0.85).toLocaleString()} F
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === "wallet" && (
          <div className="pb-6">
            <TopBar title="Portefeuille" />
            <div className="px-5 mt-4">
              <div className="rounded-2xl p-5" style={{ background: C.lagoonDeep }}>
                <p className="text-[11px]" style={{ color: "#BFE0D6", fontFamily: FONT_BODY }}>Solde disponible</p>
                <p className="text-3xl font-bold mt-1" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>{balance.toLocaleString()} FCFA</p>
                <button className="mt-4 px-4 py-2.5 rounded-xl text-xs font-bold" style={{ background: C.zem, color: C.ink, fontFamily: FONT_DISPLAY }}>
                  Retirer vers Mobile Money
                </button>
              </div>
              <div className="mt-4 rounded-xl p-3" style={{ background: C.white, border: `1px solid ${C.line}` }}>
                <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                  Commission Manhïa : 15% prélevée automatiquement à chaque course livrée.
                </p>
              </div>
            </div>
          </div>
        )}

        {tab === "profile" && (
          <div className="pb-6">
            <TopBar title="Profil" />
            <div className="px-5 mt-4">
              <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: C.white, border: `1px solid ${C.line}` }}>
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: C.sandDeep }}>
                  <User size={20} color={C.inkSoft} />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{user.name}</p>
                  <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{user.phone} · Livreur</p>
                </div>
              </div>
              <div className="mt-4">
                <button onClick={onLogout} className="w-full py-3 rounded-xl text-sm font-bold" style={{ background: C.white, border: `1px solid ${C.line}`, color: C.danger, fontFamily: FONT_DISPLAY }}>
                  Se déconnecter
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <BottomNav tab={tab} setTab={setTab} tone="clay" />

      {purchaseCourse && (
        <PurchaseDeclarationModal
          course={purchaseCourse}
          onClose={() => setPurchaseCourse(null)}
          onSubmit={async (actual, photoUrl) => {
            await updateCourse(purchaseCourse.id, {
              purchaseActual: actual,
              receiptPhotoUrl: photoUrl,
              history: [...purchaseCourse.history, { label: `Achat déclaré : ${actual.toLocaleString()} FCFA`, at: Date.now() }],
            });
            const refreshed = { ...purchaseCourse, purchaseActual: actual };
            setPurchaseCourse(null);
            await finalizeDelivery(refreshed);
          }}
        />
      )}
    </div>
  );
}

/* ===========================================================
   ROOT
=========================================================== */

const SESSION_KEY = "manhia_session";

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(user) {
  try {
    if (user) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // stockage indisponible (mode privé, etc.) — la session ne persistera simplement pas
  }
}

export default function ManhiaPrototype() {
  const [user, setUser] = useState(() => loadSession());

  const handleAuth = (u) => {
    setUser(u);
    saveSession(u);
  };

  const handleLogout = () => {
    setUser(null);
    saveSession(null);
  };

  return (
    <div className="min-h-screen" style={{ background: C.sand }}>
      <div className="max-w-md mx-auto shadow-2xl min-h-screen" style={{ background: C.sand }}>
        {!user ? (
          <AuthScreen onAuth={handleAuth} />
        ) : user.role === "client" ? (
          <ClientApp user={user} onLogout={handleLogout} />
        ) : (
          <LivreurApp user={user} onLogout={handleLogout} />
        )}
      </div>
    </div>
  );
}
