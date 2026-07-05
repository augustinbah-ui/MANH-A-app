import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Package, Star, ChevronRight, Search, Home, User, ListOrdered,
  Wallet, Bell, Navigation, CheckCircle2, Phone, Power, Plus,
  GitBranch, Layers, Trash2, LogOut, Eye, EyeOff, ArrowLeft,
  Clock, MapPin, ShieldCheck, Check, Camera, Receipt, X, AlertCircle
} from "lucide-react";
import { supabase } from "./supabaseClient";
import LocationPickerModal, { haversineDistance } from "./LocationPicker";
import { openFedaPayCheckout } from "./fedapayClient";

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
      verification_status: user.role === "livreur" ? "en_attente" : "non_requis",
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
      payer_type: course.payerType || "client",
      recipient_name: course.recipientName || null,
      recipient_phone: course.recipientPhone || null,
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
    paid: row.paid || false,
    paymentRef: row.payment_ref || null,
    paymentAmount: row.payment_amount != null ? Number(row.payment_amount) : null,
    payerType: row.payer_type || "client",
    recipientName: row.recipient_name || null,
    recipientPhone: row.recipient_phone || null,
  };
}

async function fetchAllCourses() {
  const { data, error } = await supabase.from("courses").select("*").order("created_at", { ascending: false });
  if (error) return [];
  return data.map(mapCourseFromDb);
}

async function fetchCourseById(courseId) {
  const { data, error } = await supabase.from("courses").select("*").eq("id", courseId).maybeSingle();
  if (error || !data) return null;
  return mapCourseFromDb(data);
}

async function updateCourse(courseId, patch) {
  const dbPatch = {};
  if (patch.status) dbPatch.status = patch.status;
  if (patch.livreurId !== undefined) dbPatch.livreur_id = patch.livreurId;
  if (patch.livreurName !== undefined) dbPatch.livreur_name = patch.livreurName;
  if (patch.history) dbPatch.history = patch.history;
  if (patch.purchaseActual !== undefined) dbPatch.purchase_actual = patch.purchaseActual;
  if (patch.receiptPhotoUrl !== undefined) dbPatch.receipt_photo_url = patch.receiptPhotoUrl;
  if (patch.paid !== undefined) dbPatch.paid = patch.paid;
  if (patch.paymentRef !== undefined) dbPatch.payment_ref = patch.paymentRef;
  if (patch.paymentAmount !== undefined) dbPatch.payment_amount = patch.paymentAmount;
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

const ADMIN_CODE = "CQNPD-L5ZXU";

async function fetchComplaints() {
  const { data, error } = await supabase.from("complaints").select("*").order("created_at", { ascending: false });
  if (error) return [];
  return data;
}

async function fetchPasswordRequests() {
  const { data, error } = await supabase.from("password_requests").select("*").order("created_at", { ascending: false });
  if (error) return [];
  return data;
}

async function markComplaintTreated(id) {
  await supabase.from("complaints").update({ status: "traite" }).eq("id", id);
}

async function markPasswordRequestTreated(id) {
  await supabase.from("password_requests").update({ status: "traite" }).eq("id", id);
}

async function resetUserPassword(phone, newPassword) {
  const { error } = await supabase.from("users").update({ password: newPassword }).eq("phone", phone);
  if (error) throw error;
}

async function uploadIdentityPhoto(userId, file, kind) {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${userId}_${kind}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("identity-docs").upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("identity-docs").getPublicUrl(path);
  return data.publicUrl;
}

async function submitVerification(userId, idPhotoUrl, selfiePhotoUrl) {
  const { error } = await supabase
    .from("users")
    .update({
      verification_status: "en_attente",
      id_photo_url: idPhotoUrl,
      selfie_photo_url: selfiePhotoUrl,
    })
    .eq("id", userId);
  if (error) throw error;
}

async function fetchPendingLivreurs() {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("role", "livreur")
    .in("verification_status", ["en_attente", "verifie", "refuse"])
    .order("created_at", { ascending: false });
  if (error) return [];
  return data;
}

async function setLivreurVerificationStatus(userId, status) {
  await supabase.from("users").update({ verification_status: status }).eq("id", userId);
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
          verificationStatus: created.verification_status,
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
          verificationStatus: existing.verification_status,
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
  const [mode, setMode] = useState("tournee");
  const [stops, setStops] = useState([null, null]); // {label, lat, lng} | null
  const [item, setItem] = useState("Petit colis");
  const [needsPurchase, setNeedsPurchase] = useState(false);
  const [purchaseBudget, setPurchaseBudget] = useState("2000");
  const [posting, setPosting] = useState(false);
  const [pickerIndex, setPickerIndex] = useState(null); // index en cours d'édition sur la carte
  const [showModeChoice, setShowModeChoice] = useState(false);

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
  const isSimpleTrip = stops.length === 2;

  const [paymentError, setPaymentError] = useState("");
  const [payerType, setPayerType] = useState("client");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");

  const confirmBooking = async () => {
    if (!allSet) return;
    if (payerType === "destinataire" && (!recipientName || !recipientPhone)) {
      setPaymentError("Indiquez le nom et le numéro du destinataire qui paiera.");
      return;
    }
    setPaymentError("");
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
        payerType,
        recipientName: payerType === "destinataire" ? recipientName : null,
        recipientPhone: payerType === "destinataire" ? recipientPhone : null,
        history: [{ label: "Course créée", at: Date.now() }],
      });
      setPosting(false);
      onCreated(created);
    } catch (e) {
      setPaymentError("Une erreur est survenue. Réessayez.");
      setPosting(false);
    }
  };

  return (
    <div className="pb-28">
      <TopBar
        title={isSimpleTrip ? "Nouvelle course" : mode === "multiple" ? "Courses séparées" : "Tournée multi-arrêts"}
        onBack={onCancel}
        right={!isSimpleTrip ? <Tag tone={mode === "multiple" ? "clay" : "lagoon"}>{stops.length - 1} {mode === "multiple" ? "course(s)" : "arrêt(s)"}</Tag> : null}
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
          {isSimpleTrip ? (
            <button
              onClick={() => setShowModeChoice(true)}
              className="w-full flex items-center justify-center gap-1.5 mt-3 py-2 rounded-xl"
              style={{ border: `1px dashed ${C.line}` }}
            >
              <Plus size={13} color={C.inkSoft} />
              <span className="text-xs font-semibold" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                J'ai plusieurs destinations
              </span>
            </button>
          ) : (
            <button onClick={addStop} disabled={stops.length >= 5} className="w-full flex items-center justify-center gap-1.5 mt-3 py-2 rounded-xl" style={{ border: `1px dashed ${C.line}`, opacity: stops.length >= 5 ? 0.4 : 1 }}>
              <Plus size={13} color={C.inkSoft} />
              <span className="text-xs font-semibold" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                {mode === "multiple" ? "Ajouter une course" : "Ajouter un arrêt"}
              </span>
            </button>
          )}
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

      <div className="px-5 mt-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] mb-3" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
          Qui paiera cette course ?
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setPayerType("client")}
            className="rounded-xl p-3 text-left"
            style={{ background: C.white, border: `2px solid ${payerType === "client" ? C.lagoon : C.line}` }}
          >
            <p className="text-xs font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Moi-même</p>
            <p className="text-[10px] mt-0.5" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Je paie à la livraison</p>
          </button>
          <button
            onClick={() => setPayerType("destinataire")}
            className="rounded-xl p-3 text-left"
            style={{ background: C.white, border: `2px solid ${payerType === "destinataire" ? C.clay : C.line}` }}
          >
            <p className="text-xs font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Le destinataire</p>
            <p className="text-[10px] mt-0.5" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Il paie à la réception</p>
          </button>
        </div>

        {payerType === "destinataire" && (
          <div className="mt-3 space-y-3">
            <TextField label="Nom du destinataire" value={recipientName} onChange={setRecipientName} placeholder="Nom de la personne qui recevra" icon={User} />
            <TextField label="Téléphone du destinataire" value={recipientPhone} onChange={setRecipientPhone} placeholder="Numéro qui recevra la demande de paiement" icon={Phone} />
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
        {paymentError && (
          <p className="text-xs mb-2 text-center" style={{ color: C.danger, fontFamily: FONT_BODY }}>{paymentError}</p>
        )}
        <PrimaryButton onClick={confirmBooking} disabled={posting || !allSet}>
          {posting ? "Publication..." : !allSet ? "Complétez tous les points" : "Confirmer et publier la course"}
        </PrimaryButton>
        <p className="text-[10px] text-center mt-2" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          Le paiement se fera à l'arrivée du livreur, via Mobile Money (MTN, Moov)
        </p>
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

      {showModeChoice && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(34,32,27,0.5)" }}>
          <div className="w-full rounded-t-3xl p-5 pb-8" style={{ background: C.white }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Plusieurs destinations</h2>
              <button onClick={() => setShowModeChoice(false)}><X size={18} color={C.inkSoft} /></button>
            </div>
            <p className="text-xs mb-4" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
              Comment voulez-vous organiser vos destinations supplémentaires ?
            </p>
            <div className="space-y-3">
              <button
                onClick={() => { setMode("tournee"); addStop(); setShowModeChoice(false); }}
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
                onClick={() => { setMode("multiple"); addStop(); setShowModeChoice(false); }}
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
        </div>
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
    arrivee: course.paid ? "lagoon" : "clay",
    livree: "ink",
    annulee: "danger",
  }[course.status];
  const statusLabel = {
    en_attente: "En attente d'un livreur",
    acceptee: "Livreur en route",
    en_cours: "Livraison en cours",
    arrivee: course.paid ? "Payé, en attente de remise" : "Livreur arrivé — paiement requis",
    livree: "Livrée",
    annulee: "Annulée",
  }[course.status];

  const canCancel = onCancel && (course.status === "en_attente" || course.status === "acceptee");
  const canReport = onReport && course.status === "livree";
  const canPayNow = course.status === "arrivee" && !course.paid && course.payerType !== "destinataire";

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
      {canPayNow && (
        <a
          href={`#pay=${course.id}`}
          className="w-full mt-3 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center"
          style={{ background: C.clay, color: C.white, fontFamily: FONT_DISPLAY }}
        >
          Payer {course.price.toLocaleString()} FCFA maintenant
        </a>
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

function LivreurVerificationScreen({ user, status, onSubmitted, onLogout }) {
  const [idPhoto, setIdPhoto] = useState(null);
  const [idPreview, setIdPreview] = useState(null);
  const [selfiePhoto, setSelfiePhoto] = useState(null);
  const [selfiePreview, setSelfiePreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleFile = (setFile, setPreview) => (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const submit = async () => {
    if (!idPhoto || !selfiePhoto) {
      setError("Les deux photos sont nécessaires pour continuer.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const idUrl = await uploadIdentityPhoto(user.id, idPhoto, "piece");
      const selfieUrl = await uploadIdentityPhoto(user.id, selfiePhoto, "selfie");
      await submitVerification(user.id, idUrl, selfieUrl);
      onSubmitted();
    } catch {
      setError("Erreur lors de l'envoi. Réessayez.");
      setSubmitting(false);
    }
  };

  if (status === "en_attente_review") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: C.sand }}>
        <Clock size={36} color={C.zem} className="mb-4" />
        <h1 className="text-lg font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Vérification en cours</h1>
        <p className="text-xs mt-2 leading-snug max-w-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          L'équipe Manhïa examine vos documents. Vous pourrez accepter des courses dès validation.
        </p>
        <button onClick={onLogout} className="mt-6 text-xs font-semibold underline" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          Se déconnecter
        </button>
      </div>
    );
  }

  if (status === "refuse") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: C.sand }}>
        <AlertCircle size={36} color={C.danger} className="mb-4" />
        <h1 className="text-lg font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Vérification refusée</h1>
        <p className="text-xs mt-2 leading-snug max-w-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          Vos documents n'ont pas pu être validés. Contactez Manhïa ou soumettez de nouvelles photos ci-dessous.
        </p>
        <div className="w-full max-w-xs mt-6">
          <VerificationForm />
        </div>
      </div>
    );
  }

  function VerificationForm() {
    return (
      <>
        <label
          className="flex flex-col items-center justify-center gap-2 rounded-xl py-6 mb-3 cursor-pointer"
          style={{ background: C.white, border: `1px dashed ${C.line}` }}
        >
          {idPreview ? (
            <img src={idPreview} alt="Pièce" className="max-h-32 rounded-lg" />
          ) : (
            <>
              <Camera size={20} color={C.inkSoft} />
              <span className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Photo de votre pièce d'identité</span>
            </>
          )}
          <input type="file" accept="image/*" capture="environment" onChange={handleFile(setIdPhoto, setIdPreview)} className="hidden" />
        </label>

        <label
          className="flex flex-col items-center justify-center gap-2 rounded-xl py-6 mb-4 cursor-pointer"
          style={{ background: C.white, border: `1px dashed ${C.line}` }}
        >
          {selfiePreview ? (
            <img src={selfiePreview} alt="Selfie" className="max-h-32 rounded-lg" />
          ) : (
            <>
              <User size={20} color={C.inkSoft} />
              <span className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Selfie de votre visage</span>
            </>
          )}
          <input type="file" accept="image/*" capture="user" onChange={handleFile(setSelfiePhoto, setSelfiePreview)} className="hidden" />
        </label>

        {error && <p className="text-xs mb-3" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}

        <PrimaryButton onClick={submit} disabled={submitting}>
          {submitting ? "Envoi..." : "Envoyer pour vérification"}
        </PrimaryButton>
      </>
    );
  }

  return (
    <div className="min-h-screen px-6 pt-12 pb-8 flex flex-col" style={{ background: C.sand }}>
      <div className="text-center mb-6">
        <ShieldCheck size={32} color={C.lagoon} className="mx-auto mb-3" />
        <h1 className="text-lg font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Vérifiez votre identité</h1>
        <p className="text-xs mt-2 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          Pour la sécurité des clients, chaque livreur doit être vérifié avant d'accepter des courses.
        </p>
      </div>
      <VerificationForm />
      <button onClick={onLogout} className="mt-6 text-xs font-semibold underline mx-auto" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
        Se déconnecter
      </button>
    </div>
  );
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playTone = (freq, start, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration + 0.05);
    };
    playTone(880, 0, 0.15);
    playTone(1100, 0.15, 0.18);
  } catch {
    // audio indisponible (permissions navigateur, etc.) — pas bloquant
  }
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
  const [justArrived, setJustArrived] = useState(false);
  const [myPosition, setMyPosition] = useState(null);
  const [geoDenied, setGeoDenied] = useState(false);
  const knownIdsRef = useRef(new Set());
  const firstLoadRef = useRef(true);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoDenied(true);
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setMyPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoDenied(false);
      },
      () => setGeoDenied(true),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const load = useCallback(async () => {
    const all = await fetchAllCourses();
    const availableNow = all.filter((c) => c.status === "en_attente");

    if (!firstLoadRef.current) {
      const hasNew = availableNow.some((c) => !knownIdsRef.current.has(c.id));
      if (hasNew) {
        playNotificationSound();
        setJustArrived(true);
        setTimeout(() => setJustArrived(false), 2500);
      }
    }
    firstLoadRef.current = false;
    knownIdsRef.current = new Set(availableNow.map((c) => c.id));

    setAvailable(availableNow);
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

  const markArrived = async (course) => {
    setBusyId(course.id);
    try {
      await updateCourse(course.id, {
        status: "arrivee",
        history: [...course.history, { label: "Livreur arrivé à destination", at: Date.now() }],
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
    if (course.status === "en_cours") {
      if (course.needsPurchase && course.purchaseActual == null) {
        // ouvre le modal de déclaration du montant réel avant de marquer l'arrivée
        setPurchaseCourse(course);
      } else {
        await markArrived(course);
      }
      return;
    }
    // status === "arrivee" et paiement confirmé → livrée
    await finalizeDelivery(course);
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
            {justArrived && (
              <div className="px-5 pt-3" style={{ background: C.zem }}>
                <p className="text-xs font-bold text-center py-2" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>
                  🔔 Nouvelle course disponible !
                </p>
              </div>
            )}
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
                  {activeMine.map((c) => {
                    const statusLabel = { acceptee: "À récupérer", en_cours: "En route", arrivee: "En attente de paiement" }[c.status];
                    const statusTone = { acceptee: "lagoon", en_cours: "clay", arrivee: "zem" }[c.status];
                    const buttonLabel = {
                      acceptee: "Marquer comme récupéré",
                      en_cours: "Je suis arrivé à destination",
                      arrivee: c.paid ? "Confirmer la remise du colis" : "En attente du paiement du client...",
                    }[c.status];
                    const buttonDisabled = busyId === c.id || (c.status === "arrivee" && !c.paid);

                    return (
                      <div key={c.id} className="rounded-2xl p-4" style={{ background: C.white, border: `2px solid ${C.zem}` }}>
                        <div className="flex items-center justify-between mb-2">
                          <Tag tone={statusTone}>{statusLabel}</Tag>
                          <span className="text-sm font-bold" style={{ color: C.clay, fontFamily: FONT_DISPLAY }}>{c.price.toLocaleString()} F</span>
                        </div>
                        <RouteDots />
                        <div className="flex justify-between text-xs mt-1 gap-2" style={{ fontFamily: FONT_BODY }}>
                          <span style={{ color: C.ink }} className="truncate">{shortLabel(c.stops[0])}</span>
                          <span style={{ color: C.ink }} className="truncate text-right">{shortLabel(c.stops[c.stops.length - 1])}</span>
                        </div>
                        <p className="text-[11px] mt-2" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                          {c.payerType === "destinataire"
                            ? `Destinataire (paie) : ${c.recipientName} · ${c.recipientPhone}`
                            : `Client : ${c.clientName} · ${c.clientPhone}`}
                        </p>
                        {c.status === "arrivee" && !c.paid && (
                          <>
                            <div className="mt-2 px-2.5 py-2 rounded-lg" style={{ background: `${C.zem}22` }}>
                              <p className="text-[10px] leading-snug" style={{ color: C.ink, fontFamily: FONT_BODY }}>
                                Ne remettez pas le colis avant que le paiement soit confirmé ici.
                              </p>
                            </div>
                            <a
                              href={`https://wa.me/${(c.payerType === "destinataire" ? c.recipientPhone : c.clientPhone).replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                                `Bonjour, votre livreur Manhïa est arrivé. Veuillez payer ${c.price.toLocaleString()} FCFA via ce lien pour recevoir votre colis : ${window.location.origin}/#pay=${c.id}`
                              )}`}
                              target="_blank"
                              rel="noreferrer"
                              className="w-full mt-2 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2"
                              style={{ background: "#25D366", color: C.white, fontFamily: FONT_DISPLAY }}
                            >
                              <Phone size={13} /> Envoyer le lien de paiement
                            </a>
                          </>
                        )}
                        <button
                          onClick={() => advanceCourse(c)}
                          disabled={buttonDisabled}
                          className="w-full mt-3 py-2.5 rounded-xl text-sm font-bold"
                          style={{ background: buttonDisabled && c.status === "arrivee" ? C.line : C.lagoon, color: buttonDisabled && c.status === "arrivee" ? C.inkSoft : C.white, fontFamily: FONT_DISPLAY }}
                        >
                          {busyId === c.id ? "..." : buttonLabel}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="px-5 mt-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
                  Demandes disponibles {online ? "" : "(passez en ligne pour voir)"}
                </p>
                {geoDenied && online && (
                  <span className="text-[10px]" style={{ color: C.clay, fontFamily: FONT_BODY }}>Position non disponible</span>
                )}
              </div>
              {!online ? (
                <EmptyState icon={Power} title="Vous êtes hors ligne" sub="Activez votre statut en ligne pour recevoir des demandes de courses." />
              ) : loading ? (
                <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Chargement...</p>
              ) : available.length === 0 ? (
                <EmptyState icon={Package} title="Aucune demande pour l'instant" sub="Les nouvelles courses créées par les clients apparaîtront ici automatiquement." />
              ) : (
                <div className="space-y-3">
                  {available
                    .map((c) => {
                      const depart = c.stops[0];
                      const distToDepart = myPosition && depart?.lat ? haversineDistance(myPosition, depart) : null;
                      return { ...c, distToDepart };
                    })
                    .sort((a, b) => {
                      if (a.distToDepart == null) return 1;
                      if (b.distToDepart == null) return -1;
                      return a.distToDepart - b.distToDepart;
                    })
                    .map((c) => (
                    <div key={c.id} className="rounded-2xl p-4 shadow-md" style={{ background: C.white, border: `2px solid ${C.zem}` }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <Tag tone="zem">{c.item}</Tag>
                          {c.distToDepart != null && (
                            <Tag tone="lagoon">{c.distToDepart < 1 ? `${Math.round(c.distToDepart * 1000)} m` : `${c.distToDepart.toFixed(1)} km`}</Tag>
                          )}
                        </div>
                        <span className="text-lg font-bold" style={{ color: C.clay, fontFamily: FONT_DISPLAY }}>{c.price.toLocaleString()} F</span>
                      </div>
                      <RouteDots />
                      <div className="flex justify-between text-xs mt-1 gap-2" style={{ fontFamily: FONT_BODY }}>
                        <span style={{ color: C.ink }} className="truncate">{shortLabel(c.stops[0])}</span>
                        <span style={{ color: C.ink }} className="truncate text-right">{shortLabel(c.stops[c.stops.length - 1])}</span>
                      </div>
                      {c.distanceKm != null && (
                        <p className="text-[10px] mt-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                          Trajet de la course : {c.distanceKm.toFixed(1)} km
                        </p>
                      )}
                      {c.stops.length > 2 && (
                        <p className="text-[10px] mt-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                          + {c.stops.length - 2} arrêt(s)
                        </p>
                      )}
                      {c.needsPurchase && (
                        <div className="mt-2 px-2.5 py-1.5 rounded-lg" style={{ background: `${C.zem}22` }}>
                          <p className="text-[10px] font-semibold" style={{ color: C.ink, fontFamily: FONT_BODY }}>
                            🛍️ Achat à faire — dépôt client : {(c.purchaseBudget || 0).toLocaleString()} FCFA
                          </p>
                        </div>
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
            await markArrived(refreshed);
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

function AdminLogin({ onSuccess }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    if (code.trim() === ADMIN_CODE) {
      onSuccess();
    } else {
      setError("Code incorrect.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center px-6" style={{ background: C.ink }}>
      <div className="text-center mb-6">
        <ShieldCheck size={32} color={C.zem} className="mx-auto mb-3" />
        <h1 className="text-xl font-bold" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>Accès Admin Manhïa</h1>
      </div>
      <TextField label="Code d'accès" value={code} onChange={setCode} type="password" placeholder="Entrez le code" />
      {error && <p className="text-xs mt-3 font-semibold" style={{ color: "#F08A6C", fontFamily: FONT_BODY }}>{error}</p>}
      <div className="mt-5">
        <button onClick={submit} className="w-full py-3.5 rounded-2xl text-sm font-bold" style={{ background: C.zem, color: C.ink, fontFamily: FONT_DISPLAY }}>
          Entrer
        </button>
      </div>
    </div>
  );
}

function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState("livreurs");
  const [complaints, setComplaints] = useState([]);
  const [passwordRequests, setPasswordRequests] = useState([]);
  const [livreurs, setLivreurs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resetTarget, setResetTarget] = useState(null);

  const load = useCallback(async () => {
    const [c, p, l] = await Promise.all([fetchComplaints(), fetchPasswordRequests(), fetchPendingLivreurs()]);
    setComplaints(c);
    setPasswordRequests(p);
    setLivreurs(l);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authed) load();
  }, [authed, load]);

  if (!authed) return <AdminLogin onSuccess={() => setAuthed(true)} />;

  const openComplaints = complaints.filter((c) => c.status !== "traite");
  const openRequests = passwordRequests.filter((p) => p.status !== "traite");
  const pendingLivreurs = livreurs.filter((l) => l.verification_status === "en_attente");

  return (
    <div style={{ background: C.sand, minHeight: "100vh" }}>
      <div className="px-5 pt-6 pb-4" style={{ background: C.ink }}>
        <h1 className="text-lg font-bold" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>Admin Manhïa</h1>
        <p className="text-xs mt-1" style={{ color: "#B8B2A3", fontFamily: FONT_BODY }}>Plaintes et demandes des utilisateurs</p>
      </div>

      <div className="flex px-5 mt-4 gap-2 flex-wrap">
        <button
          onClick={() => setTab("livreurs")}
          className="flex-1 py-2.5 rounded-full text-xs font-bold"
          style={{ background: tab === "livreurs" ? C.ink : C.white, color: tab === "livreurs" ? C.white : C.ink, border: `1px solid ${C.line}`, fontFamily: FONT_DISPLAY }}
        >
          Livreurs {pendingLivreurs.length > 0 && `(${pendingLivreurs.length})`}
        </button>
        <button
          onClick={() => setTab("complaints")}
          className="flex-1 py-2.5 rounded-full text-xs font-bold"
          style={{ background: tab === "complaints" ? C.ink : C.white, color: tab === "complaints" ? C.white : C.ink, border: `1px solid ${C.line}`, fontFamily: FONT_DISPLAY }}
        >
          Plaintes {openComplaints.length > 0 && `(${openComplaints.length})`}
        </button>
        <button
          onClick={() => setTab("passwords")}
          className="flex-1 py-2.5 rounded-full text-xs font-bold"
          style={{ background: tab === "passwords" ? C.ink : C.white, color: tab === "passwords" ? C.white : C.ink, border: `1px solid ${C.line}`, fontFamily: FONT_DISPLAY }}
        >
          Mots de passe {openRequests.length > 0 && `(${openRequests.length})`}
        </button>
      </div>

      <div className="px-5 mt-4 pb-10 space-y-3">
        {loading ? (
          <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Chargement...</p>
        ) : tab === "livreurs" ? (
          livreurs.length === 0 ? (
            <EmptyState icon={User} title="Aucun livreur" sub="Les livreurs inscrits et leurs vérifications apparaîtront ici." />
          ) : (
            livreurs.map((l) => (
              <div key={l.id} className="rounded-2xl p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
                <div className="flex items-center justify-between mb-2">
                  <Tag tone={l.verification_status === "verifie" ? "lagoon" : l.verification_status === "refuse" ? "danger" : "zem"}>
                    {l.verification_status === "verifie" ? "Vérifié" : l.verification_status === "refuse" ? "Refusé" : "En attente"}
                  </Tag>
                  <span className="text-[10px]" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{l.phone}</span>
                </div>
                <p className="text-sm font-bold mb-2" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{l.name}</p>
                {l.id_photo_url && l.selfie_photo_url && (
                  <div className="flex gap-2 mb-3">
                    <a href={l.id_photo_url} target="_blank" rel="noreferrer" className="flex-1">
                      <img src={l.id_photo_url} alt="Pièce" className="w-full h-24 object-cover rounded-lg" />
                      <p className="text-[10px] text-center mt-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Pièce</p>
                    </a>
                    <a href={l.selfie_photo_url} target="_blank" rel="noreferrer" className="flex-1">
                      <img src={l.selfie_photo_url} alt="Selfie" className="w-full h-24 object-cover rounded-lg" />
                      <p className="text-[10px] text-center mt-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Selfie</p>
                    </a>
                  </div>
                )}
                {l.verification_status === "en_attente" && (
                  <div className="flex gap-2">
                    <button
                      onClick={async () => { await setLivreurVerificationStatus(l.id, "verifie"); load(); }}
                      className="flex-1 py-2 rounded-xl text-xs font-bold"
                      style={{ background: C.lagoon, color: C.white, fontFamily: FONT_DISPLAY }}
                    >
                      Valider
                    </button>
                    <button
                      onClick={async () => { await setLivreurVerificationStatus(l.id, "refuse"); load(); }}
                      className="flex-1 py-2 rounded-xl text-xs font-bold"
                      style={{ background: C.white, border: `1px solid ${C.danger}`, color: C.danger, fontFamily: FONT_DISPLAY }}
                    >
                      Refuser
                    </button>
                  </div>
                )}
              </div>
            ))
          )
        ) : tab === "complaints" ? (
          complaints.length === 0 ? (
            <EmptyState icon={AlertCircle} title="Aucune plainte" sub="Les signalements des utilisateurs apparaîtront ici." />
          ) : (
            complaints.map((c) => (
              <div key={c.id} className="rounded-2xl p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
                <div className="flex items-center justify-between mb-2">
                  <Tag tone={c.status === "traite" ? "lagoon" : "danger"}>{c.status === "traite" ? "Traité" : "Nouveau"}</Tag>
                  <span className="text-[10px]" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                    {new Date(c.created_at).toLocaleString("fr-FR")}
                  </span>
                </div>
                <p className="text-sm font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{c.reason}</p>
                <p className="text-xs mt-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                  Par {c.reporter_name} ({c.reporter_role})
                </p>
                {c.description && (
                  <p className="text-xs mt-2 p-2 rounded-lg" style={{ background: C.sand, color: C.ink, fontFamily: FONT_BODY }}>
                    {c.description}
                  </p>
                )}
                {c.status !== "traite" && (
                  <button
                    onClick={async () => { await markComplaintTreated(c.id); load(); }}
                    className="w-full mt-3 py-2 rounded-xl text-xs font-bold"
                    style={{ background: C.lagoon, color: C.white, fontFamily: FONT_DISPLAY }}
                  >
                    Marquer comme traité
                  </button>
                )}
              </div>
            ))
          )
        ) : passwordRequests.length === 0 ? (
          <EmptyState icon={User} title="Aucune demande" sub="Les demandes de mot de passe oublié apparaîtront ici." />
        ) : (
          passwordRequests.map((p) => (
            <div key={p.id} className="rounded-2xl p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
              <div className="flex items-center justify-between mb-2">
                <Tag tone={p.status === "traite" ? "lagoon" : "zem"}>{p.status === "traite" ? "Traité" : "Nouveau"}</Tag>
                <span className="text-[10px]" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                  {new Date(p.created_at).toLocaleString("fr-FR")}
                </span>
              </div>
              <p className="text-sm font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{p.name}</p>
              <p className="text-xs mt-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{p.phone}</p>
              {p.message && (
                <p className="text-xs mt-2 p-2 rounded-lg" style={{ background: C.sand, color: C.ink, fontFamily: FONT_BODY }}>
                  {p.message}
                </p>
              )}
              {p.status !== "traite" && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setResetTarget(p)}
                    className="flex-1 py-2 rounded-xl text-xs font-bold"
                    style={{ background: C.clay, color: C.white, fontFamily: FONT_DISPLAY }}
                  >
                    Réinitialiser
                  </bu
