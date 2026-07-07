import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Package, Star, ChevronRight, Search, Home, User, ListOrdered,
  Wallet, Bell, Navigation, CheckCircle2, Phone, Power, Plus,
  GitBranch, Layers, Trash2, LogOut, Eye, EyeOff, ArrowLeft,
  Clock, MapPin, ShieldCheck, Check, Camera, Receipt, X, AlertCircle,
  MessageCircle, ShoppingBag
} from "lucide-react";
import { supabase } from "./supabaseClient";
import LocationPickerModal, { haversineDistance, TrackingMap } from "./LocationPicker";
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

// Valeurs par défaut, utilisées avant que la config ne soit chargée depuis Supabase
let PRICING_CONFIG = {
  basePrice: 300,
  pricePerKm: 70,
  commissionRate: 0.15,
};

async function fetchPricingConfig() {
  const { data, error } = await supabase.from("app_config").select("*").eq("id", "pricing").maybeSingle();
  if (error || !data) return PRICING_CONFIG;
  PRICING_CONFIG = {
    basePrice: Number(data.base_price),
    pricePerKm: Number(data.price_per_km),
    commissionRate: Number(data.commission_rate),
  };
  return PRICING_CONFIG;
}

async function updatePricingConfig({ basePrice, pricePerKm, commissionRate }) {
  const { error } = await supabase
    .from("app_config")
    .update({
      base_price: basePrice,
      price_per_km: pricePerKm,
      commission_rate: commissionRate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", "pricing");
  if (error) throw error;
  PRICING_CONFIG = { basePrice, pricePerKm, commissionRate };
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------- Supabase Auth helpers ---------------- */

// Lookup public (nom, rôle, etc.) par téléphone — utile pour l'admin ou l'affichage,
// mais n'est plus utilisé pour l'authentification elle-même (gérée par supabase.auth).
async function findUserByPhone(phone) {
  const { data, error } = await supabase.from("users").select("*").eq("phone", phone).maybeSingle();
  if (error) return null;
  return data;
}

async function findUserById(userId) {
  const { data, error } = await supabase.from("users").select("*").eq("id", userId).maybeSingle();
  if (error) return null;
  return data;
}

// Inscription : crée le compte Supabase Auth. La ligne dans public.users est créée
// automatiquement par le trigger SQL handle_new_auth_user, à partir des métadonnées ci-dessous.
async function signUpUser({ name, phone, email, password, role, country = "benin" }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name, phone, role, country },
    },
  });
  if (error) throw error;
  return data;
}

async function signInUser({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOutUser() {
  await supabase.auth.signOut();
}

async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${window.location.pathname}#reset-password`,
  });
  if (error) throw error;
}

async function updateOwnPassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
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
      paid: course.paid || false,
      payment_ref: course.paymentRef || null,
      country: course.country || "benin",
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
    clientRating: row.client_rating != null ? Number(row.client_rating) : null,
    clientRatingComment: row.client_rating_comment || null,
    livreurRating: row.livreur_rating != null ? Number(row.livreur_rating) : null,
    livreurRatingComment: row.livreur_rating_comment || null,
    livreurLat: row.livreur_lat != null ? Number(row.livreur_lat) : null,
    livreurLng: row.livreur_lng != null ? Number(row.livreur_lng) : null,
    livreurPositionUpdatedAt: row.livreur_position_updated_at ? new Date(row.livreur_position_updated_at).getTime() : null,
    country: row.country || "benin",
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
  if (patch.livreurLat !== undefined) dbPatch.livreur_lat = patch.livreurLat;
  if (patch.livreurLng !== undefined) dbPatch.livreur_lng = patch.livreurLng;
  if (patch.livreurLat !== undefined || patch.livreurLng !== undefined) {
    dbPatch.livreur_position_updated_at = new Date().toISOString();
  }
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

// Remarque : avec Supabase Auth, un mot de passe ne peut plus être réinitialisé
// directement depuis le client (ni par l'utilisateur, ni par l'admin) — seul
// l'utilisateur peut le faire via le lien "Mot de passe oublié" envoyé par email,
// ou un admin via la Service Role Key côté serveur (hors de portée de ce prototype).

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

async function fetchUnpaidArrivedCourses() {
  const { data, error } = await supabase
    .from("courses")
    .select("*")
    .in("status", ["arrivee", "collecte"])
    .eq("paid", false)
    .order("created_at", { ascending: false });
  if (error) return [];
  return data.map(mapCourseFromDb);
}

async function manuallyMarkPaid(courseId, note, history) {
  await supabase
    .from("courses")
    .update({
      paid: true,
      payment_ref: `MANUEL: ${note}`,
      history: [...history, { label: `Paiement confirmé manuellement par l'admin (${note})`, at: Date.now() }],
    })
    .eq("id", courseId);
}

async function rateLivreur(courseId, livreurId, rating, comment) {
  await supabase
    .from("courses")
    .update({ livreur_rating: rating, livreur_rating_comment: comment || null })
    .eq("id", courseId);

  // recalcule la moyenne du livreur sur toutes ses courses notées
  const { data } = await supabase
    .from("courses")
    .select("livreur_rating")
    .eq("livreur_id", livreurId)
    .not("livreur_rating", "is", null);
  if (data && data.length > 0) {
    const avg = data.reduce((s, c) => s + Number(c.livreur_rating), 0) / data.length;
    await supabase.from("users").update({ rating: Math.round(avg * 10) / 10 }).eq("id", livreurId);
  }
}

async function rateClient(courseId, clientId, rating, comment) {
  await supabase
    .from("courses")
    .update({ client_rating: rating, client_rating_comment: comment || null })
    .eq("id", courseId);

  const { data } = await supabase
    .from("courses")
    .select("client_rating")
    .eq("client_id", clientId)
    .not("client_rating", "is", null);
  if (data && data.length > 0) {
    const avg = data.reduce((s, c) => s + Number(c.client_rating), 0) / data.length;
    await supabase.from("users").update({ rating: Math.round(avg * 10) / 10 }).eq("id", clientId);
  }
}

async function fetchFavoriteAddresses(userId) {
  const { data, error } = await supabase
    .from("favorite_addresses")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return data.map((row) => ({
    id: row.id,
    label: row.label,
    addressLabel: row.address_label,
    lat: Number(row.lat),
    lng: Number(row.lng),
  }));
}

async function saveFavoriteAddress(userId, label, place) {
  const { error } = await supabase.from("favorite_addresses").insert({
    user_id: userId,
    label,
    address_label: place.label,
    lat: place.lat,
    lng: place.lng,
  });
  if (error) throw error;
}

async function deleteFavoriteAddress(id) {
  await supabase.from("favorite_addresses").delete().eq("id", id);
}

/* ---------------- Chat helpers (client <-> livreur) ---------------- */

async function fetchMessages(courseId) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("course_id", courseId)
    .order("created_at", { ascending: true });
  if (error) return [];
  return data;
}

async function sendMessage(courseId, senderId, senderRole, content) {
  const { error } = await supabase.from("messages").insert({
    course_id: courseId,
    sender_id: senderId,
    sender_role: senderRole,
    content: content.trim(),
  });
  if (error) throw error;
}

async function fetchUnreadMessages(courseIds, myRole) {
  // Retourne les messages envoyés par l'autre partie, pour calculer les non-lus côté client (localStorage).
  if (!courseIds.length) return [];
  const { data, error } = await supabase
    .from("messages")
    .select("id, course_id, created_at")
    .in("course_id", courseIds)
    .neq("sender_role", myRole)
    .order("created_at", { ascending: false });
  if (error) return [];
  return data;
}

function getLastSeen(courseId) {
  try {
    const raw = localStorage.getItem(`manhia_chat_seen_${courseId}`);
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
}

function markSeen(courseId) {
  try {
    localStorage.setItem(`manhia_chat_seen_${courseId}`, String(Date.now()));
  } catch {
    // stockage indisponible — pas bloquant
  }
}

/* ---------------- Notifications push (Web Push) ---------------- */

// Clé publique VAPID — sans risque à exposer côté client, c'est prévu pour ça.
const VAPID_PUBLIC_KEY = "BLalAw1WLqlMjXRqh83cRyLI-s4Vy15yBYP-2syTPfnySp9kXFQIxGe8yYQtupuCYL849-Cj8TxjuAePX-AebqQ";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window;
}

// true si l'app tourne en mode "installé" (ajoutée à l'écran d'accueil), condition
// nécessaire sur iOS/Safari pour que les notifications push fonctionnent.
function isRunningAsInstalledApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    return reg;
  } catch {
    return null;
  }
}

// Demande la permission et enregistre l'abonnement push pour l'utilisateur courant.
// Retourne un statut lisible pour piloter l'UI ("granted", "denied", "unsupported", "needs-install").
async function subscribeToPush(userId) {
  if (isIOS() && !isRunningAsInstalledApp()) {
    return { status: "needs-install" };
  }
  if (!isPushSupported()) {
    return { status: "unsupported" };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { status: "denied" };
  }

  const reg = await registerServiceWorker();
  if (!reg) return { status: "unsupported" };

  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));

  const json = subscription.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth_key: json.keys.auth,
    },
    { onConflict: "endpoint" }
  );
  if (error) return { status: "error" };

  return { status: "granted" };
}

// Envoie une notification à un ou plusieurs utilisateurs via l'Edge Function.
// Échoue silencieusement (log seulement) : une notification ratée ne doit jamais
// bloquer le flux principal de l'app (création de course, changement de statut, etc.)
async function sendPushNotification(userIds, title, body, url) {
  try {
    await supabase.functions.invoke("send-push", {
      body: { userIds, title, body, url },
    });
  } catch (e) {
    console.warn("Notification push non envoyée:", e);
  }
}

async function fetchOnlineLivreurIds() {
  // Notifie tous les livreurs vérifiés (le filtre "en ligne" étant local à chaque session,
  // on notifie tous les livreurs actifs, à charge pour eux d'accepter ou non).
  const { data, error } = await supabase.from("users").select("id").eq("role", "livreur").eq("verification_status", "verifie");
  if (error) return [];
  return data.map((u) => u.id);
}

async function notifyAdminByEmail(subject, message) {
  try {
    await supabase.functions.invoke("notify-admin", {
      body: { subject, message },
    });
  } catch (e) {
    console.warn("Email admin non envoyé:", e);
  }
}

/* ---------------- Blocage des comptes ---------------- */

function isUserBlocked(profile) {
  if (!profile) return false;
  if (profile.blocked_permanently) return true;
  if (profile.blocked_until && new Date(profile.blocked_until).getTime() > Date.now()) return true;
  return false;
}

async function blockUserTemporarily(userId, untilDate, reason) {
  const { error } = await supabase
    .from("users")
    .update({ blocked_until: untilDate, blocked_permanently: false, blocked_reason: reason })
    .eq("id", userId);
  if (error) throw error;
}

async function blockUserPermanently(userId, reason) {
  const { error } = await supabase
    .from("users")
    .update({ blocked_permanently: true, blocked_until: null, blocked_reason: reason })
    .eq("id", userId);
  if (error) throw error;
}

async function unblockUser(userId) {
  const { error } = await supabase
    .from("users")
    .update({ blocked_permanently: false, blocked_until: null, blocked_reason: null })
    .eq("id", userId);
  if (error) throw error;
}

async function fetchAllUsersForAdmin() {
  const { data, error } = await supabase.from("users").select("*").order("created_at", { ascending: false });
  if (error) return [];
  return data;
}

/* ---------------- Photo de profil ---------------- */

async function uploadAvatar(userId, file) {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${userId}/avatar_${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl;
}

async function updateOwnProfile(userId, { name, avatarUrl }) {
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (avatarUrl !== undefined) patch.avatar_url = avatarUrl;
  const { error } = await supabase.from("users").update(patch).eq("id", userId);
  if (error) throw error;
}

/* ---------------- Annonces publicitaires (carrousel accueil) ---------------- */

async function fetchActivePromotions() {
  const { data, error } = await supabase
    .from("promotions")
    .select("*")
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (error) return [];
  return data;
}

async function fetchAllPromotionsForAdmin() {
  const { data, error } = await supabase
    .from("promotions")
    .select("*")
    .order("display_order", { ascending: true });
  if (error) return [];
  return data;
}

async function uploadPromotionImage(file) {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `ad_${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("promotions").upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("promotions").getPublicUrl(path);
  return data.publicUrl;
}

async function createPromotion({ imageUrl, linkUrl, title, displayOrder }) {
  const { error } = await supabase.from("promotions").insert({
    image_url: imageUrl,
    link_url: linkUrl || null,
    title: title || null,
    display_order: displayOrder || 0,
    active: true,
  });
  if (error) throw error;
}

async function updatePromotion(id, patch) {
  const dbPatch = {};
  if (patch.imageUrl !== undefined) dbPatch.image_url = patch.imageUrl;
  if (patch.linkUrl !== undefined) dbPatch.link_url = patch.linkUrl;
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.active !== undefined) dbPatch.active = patch.active;
  if (patch.displayOrder !== undefined) dbPatch.display_order = patch.displayOrder;
  const { error } = await supabase.from("promotions").update(dbPatch).eq("id", id);
  if (error) throw error;
}

async function deletePromotion(id) {
  const { error } = await supabase.from("promotions").delete().eq("id", id);
  if (error) throw error;
}

/* ---------------- Codes promo (courses gratuites plafonnées) ---------------- */

async function validatePromoCode(code, userId) {
  const { data: promo, error } = await supabase
    .from("promo_codes")
    .select("*")
    .eq("code", code.trim().toUpperCase())
    .eq("active", true)
    .maybeSingle();

  if (error || !promo) {
    return { valid: false, reason: "Code promo invalide ou expiré." };
  }

  const { count } = await supabase
    .from("promo_code_uses")
    .select("id", { count: "exact", head: true })
    .eq("promo_code_id", promo.id)
    .eq("user_id", userId);

  if ((count || 0) >= promo.max_uses_per_user) {
    return { valid: false, reason: "Vous avez déjà utilisé ce code le nombre maximum de fois." };
  }

  return { valid: true, promo, usesRemaining: promo.max_uses_per_user - (count || 0) };
}

async function recordPromoCodeUse(promoId, userId, courseId, discountApplied) {
  const { error } = await supabase.from("promo_code_uses").insert({
    promo_code_id: promoId,
    user_id: userId,
    course_id: courseId,
    discount_applied: discountApplied,
  });
  if (error) throw error;
}

/* ---------------- Suivi des bonus livreurs (validation manuelle admin) ---------------- */

async function fetchLivreursBonusProgress() {
  const { data: livreurs, error: errL } = await supabase
    .from("users")
    .select("id, name, phone, livreur_bonus_paid")
    .eq("role", "livreur");
  if (errL || !livreurs) return [];

  const { data: courses, error: errC } = await supabase
    .from("courses")
    .select("livreur_id, status")
    .eq("status", "livree");
  if (errC) return [];

  return livreurs.map((l) => {
    const count = (courses || []).filter((c) => c.livreur_id === l.id).length;
    return { ...l, completedCourses: count };
  }).filter((l) => l.completedCourses > 0);
}

async function markLivreurBonusPaid(userId) {
  const { error } = await supabase.from("users").update({ livreur_bonus_paid: true }).eq("id", userId);
  if (error) throw error;
}

/* ---------------- Gestion des codes promo (espace Admin) ---------------- */

async function fetchAllPromoCodesForAdmin() {
  const { data, error } = await supabase
    .from("promo_codes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return [];
  return data;
}

async function createPromoCode({ code, maxDiscount, maxUsesPerUser }) {
  const { error } = await supabase.from("promo_codes").insert({
    code: code.trim().toUpperCase(),
    max_discount: maxDiscount,
    max_uses_per_user: maxUsesPerUser,
    active: true,
  });
  if (error) throw error;
}

async function updatePromoCode(id, patch) {
  const dbPatch = {};
  if (patch.active !== undefined) dbPatch.active = patch.active;
  if (patch.maxDiscount !== undefined) dbPatch.max_discount = patch.maxDiscount;
  if (patch.maxUsesPerUser !== undefined) dbPatch.max_uses_per_user = patch.maxUsesPerUser;
  const { error } = await supabase.from("promo_codes").update(dbPatch).eq("id", id);
  if (error) throw error;
}

async function deletePromoCode(id) {
  // Un code déjà utilisé par un client ne peut pas être supprimé (contrainte de clé
  // étrangère avec promo_code_uses) — on vérifie avant pour donner un message clair
  // plutôt que de laisser l'erreur SQL brute remonter à l'utilisateur.
  const usageCount = await fetchPromoCodeUsageCount(id);
  if (usageCount > 0) {
    const err = new Error("ALREADY_USED");
    err.code = "ALREADY_USED";
    throw err;
  }
  const { error } = await supabase.from("promo_codes").delete().eq("id", id);
  if (error) throw error;
}

async function fetchPromoCodeUsageCount(promoId) {
  const { count } = await supabase
    .from("promo_code_uses")
    .select("id", { count: "exact", head: true })
    .eq("promo_code_id", promoId);
  return count || 0;
}

/* ---------------- Multi-pays (structure préparée, activable depuis l'Admin) ---------------- */

const COUNTRY_LABELS = {
  benin: "Bénin",
  togo: "Togo",
  cote_ivoire: "Côte d'Ivoire",
};

// Correspond au code pays ISO utilisé par Nominatim pour biaiser la recherche d'adresse
const COUNTRY_NOMINATIM_CODES = {
  benin: "bj",
  togo: "tg",
  cote_ivoire: "ci",
};

async function fetchAppSetting(key, fallback) {
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error || !data) return fallback;
  return data.value;
}

async function updateAppSetting(key, value) {
  const { error } = await supabase.from("app_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", key);
  if (error) throw error;
}

async function isMultiCountryEnabled() {
  const value = await fetchAppSetting("multi_country_enabled", false);
  return value === true || value === "true";
}

async function fetchAllPricingByCountry() {
  const { data, error } = await supabase.from("pricing_by_country").select("*").order("country_label", { ascending: true });
  if (error) return [];
  return data;
}

async function updatePricingForCountry(country, { basePrice, pricePerKm, commissionRate }) {
  const { error } = await supabase
    .from("pricing_by_country")
    .update({
      base_price: basePrice,
      price_per_km: pricePerKm,
      commission_rate: commissionRate,
      updated_at: new Date().toISOString(),
    })
    .eq("country", country);
  if (error) throw error;
}

async function fetchPricingConfigForCountry(country) {
  const { data, error } = await supabase.from("pricing_by_country").select("*").eq("country", country).maybeSingle();
  if (error || !data) return { basePrice: 300, pricePerKm: 70, commissionRate: 0.15 };
  return {
    basePrice: Number(data.base_price),
    pricePerKm: Number(data.price_per_km),
    commissionRate: Number(data.commission_rate),
  };
}

async function fetchStats() {
  const [coursesRes, usersRes] = await Promise.all([
    supabase.from("courses").select("status, price, paid, created_at, client_id, livreur_id"),
    supabase.from("users").select("id, role, created_at"),
  ]);

  const courses = coursesRes.data || [];
  const users = usersRes.data || [];

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const last7d = now - 7 * dayMs;
  const last30d = now - 30 * dayMs;

  const livrees = courses.filter((c) => c.status === "livree");
  const revenue = livrees
    .filter((c) => c.paid)
    .reduce((sum, c) => sum + Math.round(Number(c.price) * PRICING_CONFIG.commissionRate), 0);

  const clients = users.filter((u) => u.role === "client");
  const livreurs = users.filter((u) => u.role === "livreur");

  const activeClientIds = new Set(
    courses.filter((c) => new Date(c.created_at).getTime() > last30d).map((c) => c.client_id)
  );
  const activeLivreurIds = new Set(
    courses
      .filter((c) => c.livreur_id && new Date(c.created_at).getTime() > last30d)
      .map((c) => c.livreur_id)
  );

  return {
    totalCourses: courses.length,
    coursesLast7d: courses.filter((c) => new Date(c.created_at).getTime() > last7d).length,
    coursesLast30d: courses.filter((c) => new Date(c.created_at).getTime() > last30d).length,
    livrees: livrees.length,
    annulees: courses.filter((c) => c.status === "annulee").length,
    enCours: courses.filter((c) => !["livree", "annulee"].includes(c.status)).length,
    revenue,
    totalClients: clients.length,
    activeClients: activeClientIds.size,
    totalLivreurs: livreurs.length,
    activeLivreurs: activeLivreurIds.size,
  };
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

function NotificationSettingsButton({ userId }) {
  const [status, setStatus] = useState("idle"); // idle | loading | granted | denied | unsupported | needs-install
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (isIOS() && !isRunningAsInstalledApp()) {
      setStatus("needs-install");
    } else if (isPushSupported() && Notification.permission === "granted") {
      setStatus("granted");
    }
  }, []);

  const activate = async () => {
    setStatus("loading");
    const result = await subscribeToPush(userId);
    setStatus(result.status);
    if (result.status === "denied") {
      setMessage("Autorisation refusée. Activez les notifications dans les réglages de votre navigateur pour ce site.");
    } else if (result.status === "unsupported") {
      setMessage("Les notifications ne sont pas prises en charge sur cet appareil/navigateur.");
    } else if (result.status === "error") {
      setMessage("Une erreur est survenue. Réessayez dans un instant.");
    }
  };

  if (status === "needs-install") {
    return (
      <div className="rounded-xl p-3 mb-3" style={{ background: C.sandDeep }}>
        <p className="text-xs leading-snug" style={{ color: C.ink, fontFamily: FONT_BODY }}>
          📱 Sur iPhone, pour recevoir les notifications : ouvrez ce site dans Safari, appuyez sur le bouton Partager, puis "Sur l'écran d'accueil". Ouvrez ensuite l'app depuis cette icône.
        </p>
      </div>
    );
  }

  if (status === "granted") {
    return (
      <div className="rounded-xl p-3 mb-3 flex items-center gap-2" style={{ background: C.sandDeep }}>
        <CheckCircle2 size={15} color={C.lagoon} />
        <p className="text-xs font-semibold" style={{ color: C.ink, fontFamily: FONT_BODY }}>Notifications activées</p>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <button
        onClick={activate}
        disabled={status === "loading"}
        className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
        style={{ background: C.white, border: `1px solid ${C.line}`, color: C.ink, fontFamily: FONT_DISPLAY }}
      >
        <Bell size={15} />
        {status === "loading" ? "Activation..." : "Activer les notifications"}
      </button>
      {message && (
        <p className="text-[11px] mt-2 leading-snug" style={{ color: C.clay, fontFamily: FONT_BODY }}>{message}</p>
      )}
    </div>
  );
}

function Avatar({ url, size = 48 }) {
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 overflow-hidden"
      style={{ width: size, height: size, background: C.sandDeep }}
    >
      {url ? (
        <img src={url} alt="Profil" className="w-full h-full object-cover" />
      ) : (
        <User size={size * 0.42} color={C.inkSoft} />
      )}
    </div>
  );
}

function EditProfileScreen({ user, onClose, onUpdated }) {
  const [name, setName] = useState(user.name);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(user.avatarUrl || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Le nom ne peut pas être vide.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      let finalAvatarUrl = avatarUrl;
      if (avatarFile) {
        finalAvatarUrl = await uploadAvatar(user.id, avatarFile);
      }
      await updateOwnProfile(user.id, { name: name.trim(), avatarUrl: finalAvatarUrl });
      setDone(true);
      onUpdated({ name: name.trim(), avatarUrl: finalAvatarUrl });
    } catch {
      setError("Erreur lors de l'enregistrement. Réessayez.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: C.sand }}>
      <TopBar title="Modifier mon profil" onBack={onClose} />
      <div className="px-5 pt-6 pb-10">
        <div className="flex flex-col items-center mb-6">
          <label className="relative cursor-pointer">
            <Avatar url={avatarPreview} size={88} />
            <div
              className="absolute bottom-0 right-0 w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: C.lagoon, border: `2px solid ${C.sand}` }}
            >
              <Camera size={14} color={C.white} />
            </div>
            <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
          </label>
          <p className="text-[11px] mt-2" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Toucher pour changer la photo</p>
        </div>

        <TextField label="Nom complet" value={name} onChange={setName} placeholder="Votre nom" icon={User} />

        {error && <p className="text-xs mt-3" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}
        {done && <p className="text-xs mt-3 font-semibold" style={{ color: C.lagoon, fontFamily: FONT_BODY }}>Profil mis à jour avec succès.</p>}

        <div className="mt-6">
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? "Enregistrement..." : "Enregistrer"}
          </PrimaryButton>
        </div>
      </div>
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [signupDone, setSignupDone] = useState(false);
  const [country, setCountry] = useState("benin");
  const [multiCountryEnabled, setMultiCountryEnabled] = useState(false);

  useEffect(() => {
    isMultiCountryEnabled().then(setMultiCountryEnabled);
  }, []);

  const submit = async () => {
    setError("");
    if (!email || !password || (mode === "signup" && (!name || !phone))) {
      setError("Merci de remplir tous les champs.");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        await signUpUser({ name, phone, email, password, role, country });
        setLoading(false);
        setSignupDone(true);
      } else {
        const { user } = await signInUser({ email, password });
        const profile = await findUserById(user.id);
        if (!profile) {
          setError("Profil introuvable. Contactez le support.");
          setLoading(false);
          return;
        }
        setLoading(false);
        onAuth({
          id: profile.id,
          name: profile.name,
          phone: profile.phone,
          role: profile.role,
          rating: profile.rating,
          balance: profile.balance,
          verificationStatus: profile.verification_status,
        });
      }
    } catch (e) {
      if (e.message?.includes("already registered")) {
        setError("Un compte existe déjà avec cet email.");
      } else if (e.message?.includes("Invalid login credentials")) {
        setError("Email ou mot de passe incorrect.");
      } else if (e.message?.includes("Email not confirmed")) {
        setError("Confirmez votre email avant de vous connecter (vérifiez votre boîte de réception).");
      } else {
        setError("Une erreur est survenue. Vérifiez votre connexion.");
      }
      setLoading(false);
    }
  };

  if (signupDone) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: C.sand }}>
        <CheckCircle2 size={40} color={C.lagoon} className="mb-4" />
        <h1 className="text-lg font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Vérifiez votre email</h1>
        <p className="text-xs mt-2 max-w-xs leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          Un email de confirmation a été envoyé à <strong>{email}</strong>. Cliquez sur le lien reçu pour activer votre compte, puis revenez vous connecter.
        </p>
        <button
          onClick={() => { setSignupDone(false); setMode("login"); }}
          className="mt-6 text-xs font-semibold underline"
          style={{ color: C.inkSoft, fontFamily: FONT_BODY }}
        >
          Retour à la connexion
        </button>
      </div>
    );
  }

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

        {mode === "signup" && multiCountryEnabled && (
          <div className="mb-4">
            <Select
              label="Pays"
              value={COUNTRY_LABELS[country]}
              onChange={(label) => {
                const key = Object.keys(COUNTRY_LABELS).find((k) => COUNTRY_LABELS[k] === label);
                if (key) setCountry(key);
              }}
              options={Object.values(COUNTRY_LABELS)}
            />
          </div>
        )}

        <div className="space-y-3">
          {mode === "signup" && (
            <>
              <TextField label="Nom complet" value={name} onChange={setName} placeholder="Ex: Aïcha Bello" icon={User} />
              <TextField label="Numéro de téléphone" value={phone} onChange={setPhone} placeholder="Ex: 97 00 00 00" icon={Phone} />
            </>
          )}
          <TextField label="Adresse email" value={email} onChange={setEmail} placeholder="vous@exemple.com" icon={User} />
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
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!email) {
      setError("Indiquez votre adresse email.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setDone(true);
    } catch {
      setError("Erreur d'envoi. Vérifiez l'adresse et réessayez.");
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
            <p className="text-sm font-semibold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Email envoyé</p>
            <p className="text-xs mt-2 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
              Consultez votre boîte mail ({email}) et suivez le lien pour choisir un nouveau mot de passe.
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs mb-4 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
              Indiquez l'email associé à votre compte, vous recevrez un lien pour réinitialiser votre mot de passe.
            </p>
            <div className="space-y-3">
              <TextField label="Adresse email" value={email} onChange={setEmail} placeholder="vous@exemple.com" icon={User} />
            </div>
            {error && <p className="text-xs mt-3" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}
            <div className="mt-5">
              <PrimaryButton onClick={submit} disabled={submitting}>
                {submitting ? "Envoi..." : "Envoyer le lien"}
              </PrimaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ResetPasswordScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await updateOwnPassword(password);
      setDone(true);
    } catch {
      setError("Erreur. Le lien a peut-être expiré, refaites une demande.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center px-6" style={{ background: C.sand }}>
      <div className="text-center mb-6">
        <ShieldCheck size={32} color={C.lagoon} className="mx-auto mb-3" />
        <h1 className="text-lg font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Nouveau mot de passe</h1>
      </div>

      {done ? (
        <div className="text-center">
          <CheckCircle2 size={32} color={C.lagoon} className="mx-auto mb-3" />
          <p className="text-sm mb-5" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Mot de passe mis à jour avec succès.</p>
          <PrimaryButton onClick={onDone}>Continuer</PrimaryButton>
        </div>
      ) : (
        <div className="max-w-sm w-full mx-auto space-y-3">
          <TextField label="Nouveau mot de passe" value={password} onChange={setPassword} type="password" placeholder="••••••" />
          <TextField label="Confirmer le mot de passe" value={confirm} onChange={setConfirm} type="password" placeholder="••••••" />
          {error && <p className="text-xs" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}
          <div className="pt-2">
            <PrimaryButton onClick={submit} disabled={submitting}>
              {submitting ? "..." : "Enregistrer"}
            </PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===========================================================
   CHAT (client <-> livreur)
=========================================================== */

function ChatScreen({ course, currentUser, myRole, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  const otherName = myRole === "client" ? course.livreurName : course.clientName;
  const isClosed = course.status === "livree" || course.status === "annulee";

  const load = useCallback(async () => {
    const data = await fetchMessages(course.id);
    setMessages(data);
    setLoading(false);
  }, [course.id]);

  useEffect(() => {
    load();
    markSeen(course.id);
    const channel = supabase
      .channel(`messages-${course.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `course_id=eq.${course.id}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new]);
          markSeen(course.id);
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load, course.id]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setText("");
    try {
      await sendMessage(course.id, currentUser.id, myRole, content);
    } catch {
      setText(content); // remet le texte si l'envoi échoue
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: C.sand }}>
      <TopBar
        title={otherName || (myRole === "client" ? "Livreur" : "Client")}
        onBack={onClose}
        right={
          <span className="text-[10px]" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
            {shortLabel(course.stops[0])} → {shortLabel(course.stops[course.stops.length - 1])}
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {loading ? (
          <p className="text-xs text-center mt-6" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Chargement...</p>
        ) : messages.length === 0 ? (
          <div className="mt-10">
            <EmptyState icon={MessageCircle} title="Aucun message" sub={`Écrivez à ${otherName || "votre correspondant"} pour coordonner la livraison.`} />
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.sender_role === myRole;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[75%] px-3.5 py-2.5 rounded-2xl"
                  style={{
                    background: mine ? C.lagoon : C.white,
                    border: mine ? "none" : `1px solid ${C.line}`,
                    borderBottomRightRadius: mine ? 4 : 16,
                    borderBottomLeftRadius: mine ? 16 : 4,
                  }}
                >
                  <p className="text-sm" style={{ color: mine ? C.white : C.ink, fontFamily: FONT_BODY }}>{m.content}</p>
                  <p className="text-[10px] mt-1 text-right" style={{ color: mine ? "#BFE0D6" : C.inkSoft, fontFamily: FONT_BODY }}>
                    {new Date(m.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={scrollRef} />
      </div>

      {isClosed ? (
        <div className="px-4 py-3 text-center" style={{ borderTop: `1px solid ${C.line}`, background: C.white }}>
          <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
            {course.status === "livree" ? "Course livrée — conversation archivée" : "Course annulée — conversation archivée"}
          </p>
        </div>
      ) : (
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: `1px solid ${C.line}`, background: C.white }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
            placeholder="Écrire un message..."
            className="flex-1 rounded-full px-4 py-3 text-sm outline-none"
            style={{ background: C.sand, border: `1px solid ${C.line}`, color: C.ink, fontFamily: FONT_BODY }}
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
            style={{ background: text.trim() ? C.lagoon : C.line }}
          >
            <ChevronRight size={18} color={C.white} />
          </button>
        </div>
      )}
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
  const distancePrice = Math.round(distanceKm * PRICING_CONFIG.pricePerKm);
  const price = PRICING_CONFIG.basePrice + distancePrice;
  return { price, distanceKm };
}

function NewCourseFlow({ user, onCreated, onCancel, serviceType = "envoyer" }) {
  const [mode, setMode] = useState("tournee");
  const [stops, setStops] = useState([null, null]); // {label, lat, lng} | null
  const [item, setItem] = useState(serviceType === "course" ? "Courses pharmacie/boutique" : "Petit colis");
  const [needsPurchase, setNeedsPurchase] = useState(serviceType === "course");
  const [purchaseBudget, setPurchaseBudget] = useState("2000");
  const [posting, setPosting] = useState(false);
  const [pickerIndex, setPickerIndex] = useState(null); // index en cours d'édition sur la carte
  const [showModeChoice, setShowModeChoice] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState(null); // { promo, discount } | null
  const [promoError, setPromoError] = useState("");
  const [checkingPromo, setCheckingPromo] = useState(false);

  useEffect(() => {
    fetchFavoriteAddresses(user.id).then(setFavorites);
  }, [user.id]);

  const handleSaveFavorite = async (name, place) => {
    try {
      await saveFavoriteAddress(user.id, name, place);
      const updated = await fetchFavoriteAddresses(user.id);
      setFavorites(updated);
    } catch {
      // échec silencieux : l'enregistrement du favori n'est pas bloquant pour la réservation
    }
  };

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
  const promoDiscount = appliedPromo ? Math.min(appliedPromo.discount, price) : 0;
  const totalToPay = Math.max(0, price - promoDiscount) + budgetValue;
  const isSimpleTrip = stops.length === 2;

  const [paymentError, setPaymentError] = useState("");
  const [payerType, setPayerType] = useState("client");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");

  const applyPromoCode = async () => {
    if (!promoCode.trim()) return;
    setPromoError("");
    setCheckingPromo(true);
    try {
      const result = await validatePromoCode(promoCode, user.id);
      if (!result.valid) {
        setPromoError(result.reason);
        setAppliedPromo(null);
      } else {
        setAppliedPromo({ promo: result.promo, discount: result.promo.max_discount });
      }
    } catch {
      setPromoError("Erreur lors de la vérification du code.");
    } finally {
      setCheckingPromo(false);
    }
  };

  const confirmBooking = async () => {
    if (!allSet) return;
    if (payerType === "destinataire" && (!recipientName || !recipientPhone)) {
      setPaymentError("Indiquez le nom et le numéro du destinataire qui paiera.");
      return;
    }
    setPaymentError("");
    setPosting(true);
    try {
      const finalPrice = Math.max(0, price - promoDiscount);
      // Si le code promo couvre entièrement le trajet ET qu'il n'y a pas d'achat à
      // faire (montant variable, connu seulement après coup), aucun paiement n'est
      // nécessaire : on marque la course comme déjà payée dès sa création, sans
      // jamais passer par FedaPay pour un montant de 0 FCFA.
      const fullyCoveredByPromo = finalPrice === 0 && !needsPurchase;
      const created = await createCourse({
        clientId: user.id,
        clientName: user.name,
        clientPhone: user.phone,
        mode,
        item,
        stops,
        price: finalPrice,
        distanceKm,
        needsPurchase,
        purchaseBudget: budgetValue,
        payerType,
        recipientName: payerType === "destinataire" ? recipientName : null,
        recipientPhone: payerType === "destinataire" ? recipientPhone : null,
        paid: fullyCoveredByPromo,
        paymentRef: fullyCoveredByPromo && appliedPromo ? `PROMO: ${appliedPromo.promo.code}` : null,
        country: user.country || "benin",
        history: [
          { label: appliedPromo ? `Course créée (code promo ${appliedPromo.promo.code} appliqué)` : "Course créée", at: Date.now() },
          ...(fullyCoveredByPromo ? [{ label: "Course entièrement couverte par le code promo — aucun paiement requis", at: Date.now() }] : []),
        ],
      });
      if (appliedPromo) {
        recordPromoCodeUse(appliedPromo.promo.id, user.id, created.id, promoDiscount).catch(() => {
          // échec silencieux : ne bloque pas la création de la course déjà réussie
        });
      }
      setPosting(false);
      onCreated(created);
      // Notifie tous les livreurs vérifiés qu'une nouvelle course est disponible.
      // Ne bloque jamais la création de la course elle-même en cas d'échec.
      fetchOnlineLivreurIds().then((ids) => {
        if (ids.length > 0) {
          sendPushNotification(ids, "Nouvelle course disponible", `${item} · ${price.toLocaleString()} FCFA`, "#");
        }
      });
    } catch (e) {
      setPaymentError("Une erreur est survenue. Réessayez.");
      setPosting(false);
    }
  };

  return (
    <div className="pb-28">
      <TopBar
        title={
          isSimpleTrip
            ? serviceType === "recuperer"
              ? "Récupérer un colis"
              : serviceType === "course"
              ? "Faire une course"
              : "Envoyer un colis"
            : mode === "multiple"
            ? "Courses séparées"
            : "Tournée multi-arrêts"
        }
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
                      {isFirst
                        ? (serviceType === "recuperer" ? "Où récupérer le colis" : "Départ")
                        : isLast
                        ? (serviceType === "recuperer" ? "Où vous livrer" : "Arrivée")
                        : `Arrêt ${i}`}
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
            <p className="text-[10px] mt-0.5" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Je choisis quand payer</p>
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

        {payerType === "client" && (
          <p className="text-[10px] leading-snug px-1 mt-2" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
            Le livreur vous demandera le paiement au moment de récupérer le colis, avant de partir.
          </p>
        )}

        {payerType === "destinataire" && (
          <div className="mt-3 space-y-3">
            <TextField label="Nom du destinataire" value={recipientName} onChange={setRecipientName} placeholder="Nom de la personne qui recevra" icon={User} />
            <TextField label="Téléphone du destinataire" value={recipientPhone} onChange={setRecipientPhone} placeholder="Numéro qui recevra la demande de paiement" icon={Phone} />
            <p className="text-[10px] leading-snug px-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
              Le destinataire paiera obligatoirement à la réception, puisqu'il n'est pas présent au ramassage.
            </p>
          </div>
        )}
      </div>

      <div className="px-5 mt-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] mb-3" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
          Code promo (optionnel)
        </p>
        {appliedPromo ? (
          <div className="rounded-xl p-3 flex items-center justify-between" style={{ background: `${C.lagoon}1A`, border: `1px solid ${C.lagoon}` }}>
            <div>
              <p className="text-xs font-bold" style={{ color: C.lagoon, fontFamily: FONT_DISPLAY }}>{appliedPromo.promo.code} appliqué</p>
              <p className="text-[10px] mt-0.5" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>-{promoDiscount.toLocaleString()} FCFA sur le trajet</p>
            </div>
            <button onClick={() => { setAppliedPromo(null); setPromoCode(""); }}>
              <X size={16} color={C.inkSoft} />
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: C.white, border: `1px solid ${C.line}` }}>
              <input
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder="Ex: MANHIA2026"
                className="flex-1 bg-transparent outline-none text-sm uppercase"
                style={{ color: C.ink, fontFamily: FONT_BODY }}
              />
            </div>
            <button
              onClick={applyPromoCode}
              disabled={checkingPromo || !promoCode.trim()}
              className="px-4 rounded-xl text-xs font-bold"
              style={{ background: C.lagoon, color: C.white, fontFamily: FONT_DISPLAY, opacity: checkingPromo ? 0.7 : 1 }}
            >
              {checkingPromo ? "..." : "Appliquer"}
            </button>
          </div>
        )}
        {promoError && (
          <p className="text-xs mt-2" style={{ color: C.danger, fontFamily: FONT_BODY }}>{promoError}</p>
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
              {allSet ? `${distanceKm.toFixed(1)} km · ${PRICING_CONFIG.pricePerKm} FCFA/km` : "en attente des points"}
            </span>
          </div>
          {promoDiscount > 0 && (
            <div className="flex justify-between text-[11px] mt-1.5" style={{ fontFamily: FONT_BODY }}>
              <span style={{ color: "#BFE0D6" }}>Réduction code promo</span>
              <span style={{ color: C.zem }}>-{promoDiscount.toLocaleString()} FCFA</span>
            </div>
          )}
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
          country={user.country || "benin"}
          favorites={favorites}
          onSaveFavorite={handleSaveFavorite}
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

function PromotionCarousel({ ads }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (ads.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % ads.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [ads.length]);

  if (ads.length === 0) return null;

  const current = ads[index];

  const handleClick = () => {
    if (current.link_url) {
      window.open(current.link_url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="px-5 mt-6">
      <button
        onClick={handleClick}
        className="w-full rounded-2xl overflow-hidden relative"
        style={{ aspectRatio: "16/7", background: C.sandDeep, cursor: current.link_url ? "pointer" : "default" }}
      >
        <img src={current.image_url} alt={current.title || "Annonce"} className="w-full h-full object-cover" />
        {current.title && (
          <div className="absolute bottom-0 left-0 right-0 px-3 py-2" style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.6))" }}>
            <p className="text-xs font-bold text-left" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>{current.title}</p>
          </div>
        )}
      </button>
      {ads.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2">
          {ads.map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all"
              style={{
                width: i === index ? 16 : 6,
                height: 6,
                background: i === index ? C.lagoon : C.line,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceTypeChoice({ onChoose, onClose }) {
  const options = [
    {
      key: "envoyer",
      icon: Package,
      title: "Envoyer un colis",
      sub: "J'ai un colis à faire livrer à quelqu'un",
      tone: C.lagoon,
    },
    {
      key: "recuperer",
      icon: Navigation,
      title: "Récupérer un colis",
      sub: "Quelqu'un a un colis pour moi ailleurs",
      tone: C.clay,
    },
    {
      key: "course",
      icon: ShoppingBag,
      title: "Faire une course",
      sub: "J'ai besoin qu'on m'achète ou récupère quelque chose",
      tone: C.zem,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: C.sand }}>
      <TopBar title="Que voulez-vous faire ?" onBack={onClose} />
      <div className="px-5 pt-5 pb-10 space-y-3">
        {options.map((opt) => (
          <button
            key={opt.key}
            onClick={() => onChoose(opt.key)}
            className="w-full text-left rounded-2xl p-4 flex items-start gap-3"
            style={{ background: C.white, border: `2px solid ${C.line}` }}
          >
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
              style={{ background: `${opt.tone}1A` }}
            >
              <opt.icon size={20} color={opt.tone} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{opt.title}</p>
              <p className="text-xs mt-1 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{opt.sub}</p>
            </div>
            <ChevronRight size={16} color={C.inkSoft} className="mt-1" />
          </button>
        ))}
      </div>
    </div>
  );
}

function shortLabel(stop) {
  if (!stop) return "";
  const text = typeof stop === "string" ? stop : stop.label || "";
  const parts = text.split(",");
  return parts.slice(0, 2).join(",").trim() || text;
}

function CourseCard({ course, highlight, onCancel, onReport, onOpenReceipt, onOpenChat, hasUnread, onOpenTracking }) {
  const statusTone = {
    en_attente: "zem",
    acceptee: "lagoon",
    collecte: course.paid ? "lagoon" : "clay",
    en_cours: "clay",
    arrivee: course.paid ? "lagoon" : "clay",
    livree: "ink",
    annulee: "danger",
  }[course.status];
  const statusLabel = {
    en_attente: "En attente d'un livreur",
    acceptee: "Livreur en route vers vous",
    collecte: course.paid ? "Payé, colis en cours de collecte" : "Paiement requis avant collecte",
    en_cours: "Livraison en cours",
    arrivee: course.paid ? "Payé, en attente de remise" : "Livreur arrivé — paiement requis",
    livree: "Livrée",
    annulee: "Annulée",
  }[course.status];

  const canCancel = onCancel && (course.status === "en_attente" || course.status === "acceptee");
  const canReport = onReport && course.status === "livree";
  const canPayNow = (course.status === "arrivee" || course.status === "collecte") && !course.paid && course.payerType !== "destinataire";
  const canOpenReceipt = onOpenReceipt && course.status === "livree";
  const canChat = onOpenChat && course.livreurId && course.status !== "en_attente";
  const canTrack = onOpenTracking && ["acceptee", "collecte", "en_cours", "arrivee"].includes(course.status);

  return (
    <div
      onClick={canOpenReceipt ? () => onOpenReceipt(course) : undefined}
      className="rounded-2xl p-4"
      style={{ background: C.white, border: `1px solid ${highlight ? C.zem : C.line}`, borderWidth: highlight ? 2 : 1, cursor: canOpenReceipt ? "pointer" : "default" }}
    >
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
        <div className="flex items-center justify-between gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: C.sandDeep }}>
              <User size={13} color={C.inkSoft} />
            </div>
            <span className="text-xs font-semibold" style={{ color: C.ink, fontFamily: FONT_BODY }}>{course.livreurName}</span>
          </div>
          <div className="flex items-center gap-2">
            {canTrack && (
              <button
                onClick={(e) => { e.stopPropagation(); onOpenTracking(course); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                style={{ background: C.clay }}
              >
                <Navigation size={13} color={C.white} />
                <span className="text-[11px] font-bold" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>Suivre</span>
              </button>
            )}
            {canChat && (
              <button
                onClick={(e) => { e.stopPropagation(); onOpenChat(course); }}
                className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                style={{ background: C.lagoon }}
              >
                <MessageCircle size={13} color={C.white} />
                <span className="text-[11px] font-bold" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>Chat</span>
                {hasUnread && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full" style={{ background: C.zem, border: `1.5px solid ${C.white}` }} />
                )}
              </button>
            )}
          </div>
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
              onClick={(e) => { e.stopPropagation(); onReport(course); }}
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
      notifyAdminByEmail(
        "Nouvelle plainte",
        `${reporter.name} (${reporter.role}) a signalé : ${reason}\n\n${description || "Aucune description fournie."}`
      );
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

function StarRating({ value, onChange, size = 28 }) {
  return (
    <div className="flex gap-2 justify-center">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(n)} type="button">
          <Star
            size={size}
            color={n <= value ? C.zem : C.line}
            fill={n <= value ? C.zem : "none"}
          />
        </button>
      ))}
    </div>
  );
}

function RatingModal({ title, subtitle, onClose, onSubmit }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (rating === 0) {
      setError("Choisissez une note avant d'envoyer.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await onSubmit(rating, comment);
    } catch {
      setError("Erreur lors de l'envoi. Réessayez.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(34,32,27,0.5)" }}>
      <div className="w-full rounded-t-3xl p-5 pb-8" style={{ background: C.white }}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{title}</h2>
          <button onClick={onClose}><X size={18} color={C.inkSoft} /></button>
        </div>
        <p className="text-xs mb-5" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{subtitle}</p>

        <StarRating value={rating} onChange={setRating} />

        <div className="mt-5">
          <TextField label="Commentaire (optionnel)" value={comment} onChange={setComment} placeholder="Un mot sur cette course..." />
        </div>

        {error && <p className="text-xs mt-3" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}

        <div className="mt-5">
          <PrimaryButton onClick={submit} disabled={submitting}>
            {submitting ? "Envoi..." : "Envoyer la note"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function ReceiptScreen({ course: initialCourse, onClose, currentUser, myRole, onOpenChat }) {
  const [course, setCourse] = useState(initialCourse);
  const [showRating, setShowRating] = useState(false);
  const commission = Math.round(course.price * PRICING_CONFIG.commissionRate);
  const receiptDate = new Date(course.createdAt).toLocaleString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const submitRating = async (rating, comment) => {
    await rateLivreur(course.id, course.livreurId, rating, comment);
    setCourse({ ...course, livreurRating: rating, livreurRatingComment: comment });
    setShowRating(false);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: C.sand }}>
      <TopBar title="Reçu de livraison" onBack={onClose} />

      <div className="px-5 pt-6 pb-10">
        <div className="text-center mb-6">
          <CheckCircle2 size={40} color={C.lagoon} className="mx-auto mb-3" />
          <h1 className="text-lg font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Livraison confirmée</h1>
          <p className="text-xs mt-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{receiptDate}</p>
        </div>

        <div className="rounded-2xl p-4 mb-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>Trajet</p>
          <RouteDots />
          <div className="flex justify-between text-xs mt-1 gap-2" style={{ fontFamily: FONT_BODY }}>
            <span style={{ color: C.ink }} className="truncate">{shortLabel(course.stops[0])}</span>
            <span style={{ color: C.ink }} className="truncate text-right">{shortLabel(course.stops[course.stops.length - 1])}</span>
          </div>
          {course.distanceKm != null && (
            <p className="text-[11px] mt-2" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{course.distanceKm.toFixed(1)} km parcourus</p>
          )}
          {course.livreurName && (
            <p className="text-[11px] mt-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Livreur : {course.livreurName}</p>
          )}
          {onOpenChat && course.livreurId && (
            <button
              onClick={() => onOpenChat(course)}
              className="w-full mt-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2"
              style={{ background: C.sand, border: `1px solid ${C.line}`, color: C.ink, fontFamily: FONT_DISPLAY }}
            >
              <MessageCircle size={14} /> Voir la conversation
            </button>
          )}
        </div>

        <div className="rounded-2xl p-4 mb-4" style={{ background: C.lagoonDeep }}>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-3" style={{ color: "#BFE0D6", fontFamily: FONT_DISPLAY }}>Détail du paiement</p>
          <div className="flex justify-between text-xs mb-2" style={{ fontFamily: FONT_BODY }}>
            <span style={{ color: "#BFE0D6" }}>Prix du trajet</span>
            <span style={{ color: C.white }}>{course.price.toLocaleString()} FCFA</span>
          </div>
          {course.needsPurchase && course.purchaseActual != null && (
            <div className="flex justify-between text-xs mb-2" style={{ fontFamily: FONT_BODY }}>
              <span style={{ color: "#BFE0D6" }}>Achat effectué par le livreur</span>
              <span style={{ color: C.white }}>{course.purchaseActual.toLocaleString()} FCFA</span>
            </div>
          )}
          <div className="h-px my-2" style={{ background: "#2C7166" }} />
          <div className="flex justify-between text-sm font-bold" style={{ fontFamily: FONT_DISPLAY }}>
            <span style={{ color: C.white }}>Total payé</span>
            <span style={{ color: C.zem }}>{course.price.toLocaleString()} FCFA</span>
          </div>
          {course.paymentRef && (
            <p className="text-[10px] mt-3" style={{ color: "#BFE0D6", fontFamily: FONT_BODY }}>
              Référence : {course.paymentRef}
            </p>
          )}
        </div>

        <div className="rounded-2xl p-4 mb-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>Votre avis sur le livreur</p>
          {course.livreurRating ? (
            <>
              <div className="flex gap-1 mb-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} size={18} color={n <= course.livreurRating ? C.zem : C.line} fill={n <= course.livreurRating ? C.zem : "none"} />
                ))}
              </div>
              {course.livreurRatingComment && (
                <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{course.livreurRatingComment}</p>
              )}
            </>
          ) : (
            <button
              onClick={() => setShowRating(true)}
              className="w-full py-2.5 rounded-xl text-xs font-bold"
              style={{ background: C.zem, color: C.ink, fontFamily: FONT_DISPLAY }}
            >
              Noter ce livreur
            </button>
          )}
        </div>

        <div className="rounded-2xl p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>Historique de la course</p>
          <div className="space-y-2">
            {course.history.map((h, i) => (
              <div key={i} className="flex justify-between text-[11px]" style={{ fontFamily: FONT_BODY }}>
                <span style={{ color: C.ink }}>{h.label}</span>
                <span style={{ color: C.inkSoft }}>{new Date(h.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showRating && (
        <RatingModal
          title="Noter votre livreur"
          subtitle={`Comment s'est passée votre course avec ${course.livreurName || "votre livreur"} ?`}
          onClose={() => setShowRating(false)}
          onSubmit={submitRating}
        />
      )}
    </div>
  );
}

function TrackingScreen({ course, onClose }) {
  const [liveCourse, setLiveCourse] = useState(course);

  useEffect(() => {
    const channel = supabase
      .channel(`tracking-${course.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "courses", filter: `id=eq.${course.id}` },
        (payload) => {
          setLiveCourse((prev) => ({
            ...prev,
            livreurLat: payload.new.livreur_lat != null ? Number(payload.new.livreur_lat) : null,
            livreurLng: payload.new.livreur_lng != null ? Number(payload.new.livreur_lng) : null,
            livreurPositionUpdatedAt: payload.new.livreur_position_updated_at
              ? new Date(payload.new.livreur_position_updated_at).getTime()
              : null,
            status: payload.new.status,
          }));
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [course.id]);

  const livreurPosition =
    liveCourse.livreurLat != null && liveCourse.livreurLng != null
      ? { lat: liveCourse.livreurLat, lng: liveCourse.livreurLng }
      : null;

  const isStale = liveCourse.livreurPositionUpdatedAt && Date.now() - liveCourse.livreurPositionUpdatedAt > 7 * 60 * 1000;
  const isDone = liveCourse.status === "livree" || liveCourse.status === "annulee";

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: C.sand }}>
      <TopBar title={`Suivi · ${liveCourse.livreurName || "Livreur"}`} onBack={onClose} />
      <div className="flex-1 relative">
        {!livreurPosition ? (
          <div className="h-full flex items-center justify-center px-8">
            <EmptyState
              icon={Navigation}
              title={isDone ? "Course terminée" : "Position non disponible"}
              sub={isDone ? "Le suivi n'est plus actif pour cette course." : "Le livreur n'a pas encore partagé sa position. Réessayez dans un instant."}
            />
          </div>
        ) : (
          <>
            <TrackingMap stops={liveCourse.stops} livreurPosition={livreurPosition} />
            {isStale && !isDone && (
              <div className="absolute top-3 left-4 right-4 z-10">
                <p className="text-[11px] text-center py-2 px-3 rounded-full shadow" style={{ background: "rgba(255,253,249,0.95)", color: C.clay, fontFamily: FONT_BODY }}>
                  Dernière position reçue il y a plus de 7 minutes
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


function BlockedScreen({ user, onLogout }) {
  const isPermanent = user.blockedPermanently;
  const untilDate = user.blockedUntil ? new Date(user.blockedUntil) : null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: C.sand }}>
      <AlertCircle size={40} color={C.danger} className="mb-4" />
      <h1 className="text-lg font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>
        {isPermanent ? "Compte suspendu" : "Compte temporairement suspendu"}
      </h1>
      <p className="text-xs mt-3 max-w-xs leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
        {isPermanent
          ? "Votre compte a été définitivement suspendu par l'équipe Manhïa."
          : `Votre compte est suspendu jusqu'au ${untilDate?.toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}.`}
      </p>
      {user.blockedReason && (
        <div className="mt-4 rounded-xl p-3 max-w-xs" style={{ background: C.white, border: `1px solid ${C.line}` }}>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>Motif</p>
          <p className="text-xs leading-snug" style={{ color: C.ink, fontFamily: FONT_BODY }}>{user.blockedReason}</p>
        </div>
      )}
      <a
        href="https://wa.me/2290162334888"
        target="_blank"
        rel="noreferrer"
        className="w-full max-w-xs mt-6 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
        style={{ background: C.lagoon, color: C.white, fontFamily: FONT_DISPLAY }}
      >
        <Phone size={15} /> Contacter le support
      </a>
      <button onClick={onLogout} className="mt-4 text-xs font-semibold underline" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
        Se déconnecter
      </button>
    </div>
  );
}

function ClientApp({ user, onLogout }) {
  const [tab, setTab] = useState("home");
  const [choosingServiceType, setChoosingServiceType] = useState(false);
  const [booking, setBooking] = useState(false);
  const [serviceType, setServiceType] = useState("envoyer");
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [receiptTarget, setReceiptTarget] = useState(null);
  const [chatTarget, setChatTarget] = useState(null);
  const [trackingTarget, setTrackingTarget] = useState(null);
  const [unreadIds, setUnreadIds] = useState(new Set());
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileUser, setProfileUser] = useState(user);
  const [ads, setAds] = useState([]);

  useEffect(() => {
    fetchActivePromotions().then(setAds);
  }, []);

  const loadCourses = useCallback(async () => {
    const all = await fetchAllCourses();
    const mine = all.filter((c) => c.clientId === user.id);
    setCourses(mine);
    setLoading(false);

    const withLivreur = mine.filter((c) => c.livreurId).map((c) => c.id);
    const unread = await fetchUnreadMessages(withLivreur, "client");
    const ids = new Set();
    unread.forEach((m) => {
      const lastSeen = getLastSeen(m.course_id);
      if (new Date(m.created_at).getTime() > lastSeen) ids.add(m.course_id);
    });
    setUnreadIds(ids);
  }, [user.id]);

  useEffect(() => {
    loadCourses();
    const channel = supabase
      .channel("courses-client")
      .on("postgres_changes", { event: "*", schema: "public", table: "courses" }, () => {
        loadCourses();
      })
      .subscribe();
    const msgChannel = supabase
      .channel("messages-client-badge")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {
        loadCourses();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(msgChannel);
    };
  }, [loadCourses]);

  const handleCancel = async (reason) => {
    await cancelCourseRequest(cancelTarget.id, "client", reason, cancelTarget.history);
    setCancelTarget(null);
    loadCourses();
  };

  const openChat = (course) => {
    setUnreadIds((prev) => {
      const next = new Set(prev);
      next.delete(course.id);
      return next;
    });
    setChatTarget(course);
  };

  if (choosingServiceType) {
    return (
      <ServiceTypeChoice
        onClose={() => setChoosingServiceType(false)}
        onChoose={(type) => {
          setServiceType(type);
          setChoosingServiceType(false);
          setBooking(true);
        }}
      />
    );
  }

  if (booking) {
    return (
      <div style={{ background: C.sand, minHeight: "100vh" }}>
        <NewCourseFlow
          user={user}
          serviceType={serviceType}
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
                onClick={() => setChoosingServiceType(true)}
                className="w-full rounded-2xl p-4 shadow-md flex items-center gap-3"
                style={{ background: C.white }}
              >
                <Search size={18} color={C.inkSoft} />
                <span className="text-sm" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Envoyer, récupérer un colis ou faire une course</span>
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
                  {active.map((c) => (
                    <CourseCard
                      key={c.id}
                      course={c}
                      highlight
                      onCancel={setCancelTarget}
                      onOpenChat={openChat}
                      onOpenTracking={setTrackingTarget}
                      hasUnread={unreadIds.has(c.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            <PromotionCarousel ads={ads} />
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
                  <CourseCard
                    key={c.id}
                    course={c}
                    onCancel={setCancelTarget}
                    onReport={setReportTarget}
                    onOpenReceipt={setReceiptTarget}
                    onOpenChat={openChat}
                    onOpenTracking={setTrackingTarget}
                    hasUnread={unreadIds.has(c.id)}
                  />
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
              <button
                onClick={() => setEditingProfile(true)}
                className="w-full rounded-2xl p-4 flex items-center gap-3 text-left"
                style={{ background: C.white, border: `1px solid ${C.line}` }}
              >
                <Avatar url={profileUser.avatarUrl} size={48} />
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{profileUser.name}</p>
                  <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{profileUser.phone} · Client</p>
                </div>
                <ChevronRight size={16} color={C.inkSoft} />
              </button>
              <div className="mt-4">
                <NotificationSettingsButton userId={user.id} />
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
      {receiptTarget && (
        <ReceiptScreen
          course={receiptTarget}
          onClose={() => setReceiptTarget(null)}
          currentUser={user}
          myRole="client"
          onOpenChat={openChat}
        />
      )}
      {chatTarget && (
        <ChatScreen
          course={chatTarget}
          currentUser={user}
          myRole="client"
          onClose={() => { setChatTarget(null); loadCourses(); }}
        />
      )}
      {trackingTarget && (
        <TrackingScreen
          course={trackingTarget}
          onClose={() => { setTrackingTarget(null); loadCourses(); }}
        />
      )}
      {editingProfile && (
        <EditProfileScreen
          user={profileUser}
          onClose={() => setEditingProfile(false)}
          onUpdated={(patch) => setProfileUser((p) => ({ ...p, ...patch }))}
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
      notifyAdminByEmail(
        "Nouvelle vérification livreur",
        `${user.name} (${user.phone}) a soumis ses documents d'identité pour vérification.`
      );
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
  const [rateClientTarget, setRateClientTarget] = useState(null);
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
  const [chatTarget, setChatTarget] = useState(null);
  const [unreadIds, setUnreadIds] = useState(new Set());
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileUser, setProfileUser] = useState(user);
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

  // Partage la position en direct avec le(s) client(s) des courses actives (dès acceptation,
  // jusqu'à la livraison). Throttle à 1 envoi maximum toutes les 5 minutes : watchPosition
  // peut remonter des positions plusieurs fois par seconde, mais Supabase et la batterie
  // n'ont pas besoin de cette fréquence pour un suivi de livraison utile.
  const activeCourseIdsRef = useRef([]);
  const lastGpsSendRef = useRef(0);
  useEffect(() => {
    if (!myPosition) return;
    const ids = activeCourseIdsRef.current;
    if (ids.length === 0) return;

    const now = Date.now();
    if (now - lastGpsSendRef.current < 5 * 60 * 1000) return;
    lastGpsSendRef.current = now;

    ids.forEach((courseId) => {
      updateCourse(courseId, { livreurLat: myPosition.lat, livreurLng: myPosition.lng }).catch(() => {
        // échec silencieux : une mise à jour de position ratée n'est pas bloquante
      });
    });
  }, [myPosition]);

  const load = useCallback(async () => {
    const all = await fetchAllCourses();
    // Filtre par pays si le multi-pays est activé : un livreur ne voit que les
    // courses de son propre pays. Tant que le multi-pays est désactivé, tout le
    // monde est considéré comme au Bénin, donc ce filtre ne change rien au comportement actuel.
    const availableNow = all.filter((c) => c.status === "en_attente" && c.country === (user.country || "benin"));

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
    const mineNow = all.filter((c) => c.livreurId === user.id);
    setMine(mineNow);
    setLoading(false);

    const unread = await fetchUnreadMessages(mineNow.map((c) => c.id), "livreur");
    const ids = new Set();
    unread.forEach((m) => {
      const lastSeen = getLastSeen(m.course_id);
      if (new Date(m.created_at).getTime() > lastSeen) ids.add(m.course_id);
    });
    setUnreadIds(ids);
  }, [user.id]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("courses-livreur")
      .on("postgres_changes", { event: "*", schema: "public", table: "courses" }, () => {
        load();
      })
      .subscribe();
    const msgChannel = supabase
      .channel("messages-livreur-badge")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {
        load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(msgChannel);
    };
  }, [load]);

  const openChat = (course) => {
    setUnreadIds((prev) => {
      const next = new Set(prev);
      next.delete(course.id);
      return next;
    });
    setChatTarget(course);
  };

  const acceptCourse = async (course) => {
    setBusyId(course.id);
    try {
      await updateCourse(course.id, {
        status: "acceptee",
        livreurId: user.id,
        livreurName: user.name,
        history: [...course.history, { label: `Acceptée par ${user.name}`, at: Date.now() }],
      });
      sendPushNotification([course.clientId], "Livreur trouvé !", `${user.name} a accepté votre course et arrive.`, "#");
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
      const notifyId = course.payerType === "destinataire" ? null : course.clientId;
      if (notifyId) {
        sendPushNotification([notifyId], "Livreur arrivé", "Votre livreur est arrivé à destination.", "#");
      }
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
      const commission = Math.round(course.price * PRICING_CONFIG.commissionRate);
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
      setBusyId(course.id);
      try {
        if (course.payerType === "destinataire") {
          // le destinataire paiera à l'arrivée : on peut aller récupérer directement
          await updateCourse(course.id, {
            status: "en_cours",
            history: [...course.history, { label: "Colis récupéré, en route", at: Date.now() }],
          });
        } else {
          // le créateur paie : on attend son paiement avant de récupérer le colis
          await updateCourse(course.id, {
            status: "collecte",
            history: [...course.history, { label: "En attente du paiement avant collecte", at: Date.now() }],
          });
        }
      } finally {
        setBusyId(null);
        load();
      }
      return;
    }
    if (course.status === "collecte") {
      // paiement confirmé côté client → le livreur peut récupérer le colis
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
      } else if (course.payerType === "destinataire") {
        await markArrived(course);
      } else {
        // déjà payé à la collecte : livraison directe, pas d'attente de paiement à l'arrivée
        await finalizeDelivery(course);
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
    .reduce((s, c) => s + Math.round(c.price * (1 - PRICING_CONFIG.commissionRate)), 0);

  // Courses où la position doit être partagée : de l'acceptation jusqu'à la livraison
  const trackableStatuses = ["acceptee", "collecte", "en_cours", "arrivee"];
  useEffect(() => {
    activeCourseIdsRef.current = mine.filter((c) => trackableStatuses.includes(c.status)).map((c) => c.id);
  }, [mine]);

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
                    const statusLabel = {
                      acceptee: "Accepté",
                      collecte: "En attente de paiement (avant collecte)",
                      en_cours: "En route",
                      arrivee: "En attente de paiement (à la livraison)",
                    }[c.status];
                    const statusTone = { acceptee: "lagoon", collecte: "zem", en_cours: "clay", arrivee: "zem" }[c.status];
                    const buttonLabel = {
                      acceptee: "Aller vers le point de départ",
                      collecte: c.paid ? "Marquer comme récupéré" : "En attente du paiement du client...",
                      en_cours: c.payerType === "destinataire" ? "Je suis arrivé à destination" : "Confirmer la livraison",
                      arrivee: c.paid ? "Confirmer la remise du colis" : "En attente du paiement du client...",
                    }[c.status];
                    const buttonDisabled =
                      busyId === c.id ||
                      (c.status === "arrivee" && !c.paid) ||
                      (c.status === "collecte" && !c.paid);
                    const payLink = `https://wa.me/${(c.payerType === "destinataire" ? c.recipientPhone : c.clientPhone).replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                      c.status === "collecte"
                        ? `Bonjour, votre livreur Manhïa va venir récupérer votre colis. Veuillez payer ${c.price.toLocaleString()} FCFA via ce lien avant la collecte : ${window.location.origin}/#pay=${c.id}`
                        : `Bonjour, votre livreur Manhïa est arrivé. Veuillez payer ${c.price.toLocaleString()} FCFA via ce lien pour recevoir votre colis : ${window.location.origin}/#pay=${c.id}`
                    )}`;

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
                        <div className="flex items-center justify-between mt-2 gap-2">
                          <p className="text-[11px]" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                            {c.payerType === "destinataire"
                              ? `Destinataire (paie) : ${c.recipientName} · ${c.recipientPhone}`
                              : `Client : ${c.clientName} · ${c.clientPhone}`}
                          </p>
                          <button
                            onClick={() => openChat(c)}
                            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full shrink-0"
                            style={{ background: C.lagoon }}
                          >
                            <MessageCircle size={13} color={C.white} />
                            <span className="text-[11px] font-bold" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>Chat</span>
                            {unreadIds.has(c.id) && (
                              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full" style={{ background: C.zem, border: `1.5px solid ${C.white}` }} />
                            )}
                          </button>
                        </div>
                        {((c.status === "arrivee" || c.status === "collecte") && !c.paid) && (
                          <>
                            <div className="mt-2 px-2.5 py-2 rounded-lg" style={{ background: `${C.zem}22` }}>
                              <p className="text-[10px] leading-snug" style={{ color: C.ink, fontFamily: FONT_BODY }}>
                                {c.status === "collecte"
                                  ? "Ne récupérez pas le colis avant que le paiement soit confirmé ici."
                                  : "Ne remettez pas le colis avant que le paiement soit confirmé ici."}
                              </p>
                            </div>
                            <a
                              href={payLink}
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
                          style={{ background: buttonDisabled && (c.status === "arrivee" || c.status === "collecte") ? C.line : C.lagoon, color: buttonDisabled && (c.status === "arrivee" || c.status === "collecte") ? C.inkSoft : C.white, fontFamily: FONT_DISPLAY }}
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
                  <div key={c.id} className="rounded-xl p-3" style={{ background: C.white, border: `1px solid ${C.line}` }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Package size={14} color={C.inkSoft} />
                        <span className="text-xs" style={{ color: C.ink, fontFamily: FONT_BODY }}>{shortLabel(c.stops[0])} → {shortLabel(c.stops[c.stops.length - 1])}</span>
                      </div>
                      <span className="text-xs font-bold" style={{ color: C.lagoon, fontFamily: FONT_DISPLAY }}>
                        +{Math.round(c.price * (1 - PRICING_CONFIG.commissionRate)).toLocaleString()} F
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      {c.clientRating ? (
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Star key={n} size={12} color={n <= c.clientRating ? C.zem : C.line} fill={n <= c.clientRating ? C.zem : "none"} />
                          ))}
                        </div>
                      ) : (
                        <button
                          onClick={() => setRateClientTarget(c)}
                          className="text-[11px] font-semibold underline"
                          style={{ color: C.inkSoft, fontFamily: FONT_BODY }}
                        >
                          Noter ce client
                        </button>
                      )}
                      <button
                        onClick={() => openChat(c)}
                        className="relative flex items-center gap-1 px-2.5 py-1 rounded-full"
                        style={{ background: C.sand, border: `1px solid ${C.line}` }}
                      >
                        <MessageCircle size={12} color={C.inkSoft} />
                        <span className="text-[10px] font-semibold" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Chat</span>
                        {unreadIds.has(c.id) && (
                          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full" style={{ background: C.zem, border: `1.5px solid ${C.white}` }} />
                        )}
                      </button>
                    </div>
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
                  Commission Manhïa : {Math.round(PRICING_CONFIG.commissionRate * 100)}% prélevée automatiquement à chaque course livrée.
                </p>
              </div>
            </div>
          </div>
        )}

        {tab === "profile" && (
          <div className="pb-6">
            <TopBar title="Profil" />
            <div className="px-5 mt-4">
              <button
                onClick={() => setEditingProfile(true)}
                className="w-full rounded-2xl p-4 flex items-center gap-3 text-left"
                style={{ background: C.white, border: `1px solid ${C.line}` }}
              >
                <Avatar url={profileUser.avatarUrl} size={48} />
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{profileUser.name}</p>
                  <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{profileUser.phone} · Livreur</p>
                </div>
                <ChevronRight size={16} color={C.inkSoft} />
              </button>
              <div className="mt-4">
                <NotificationSettingsButton userId={user.id} />
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
      {rateClientTarget && (
        <RatingModal
          title="Noter ce client"
          subtitle={`Comment s'est passée la course avec ${rateClientTarget.clientName} ?`}
          onClose={() => setRateClientTarget(null)}
          onSubmit={async (rating, comment) => {
            await rateClient(rateClientTarget.id, rateClientTarget.clientId, rating, comment);
            setRateClientTarget(null);
            load();
          }}
        />
      )}
      {chatTarget && (
        <ChatScreen
          course={chatTarget}
          currentUser={user}
          myRole="livreur"
          onClose={() => { setChatTarget(null); load(); }}
        />
      )}
      {editingProfile && (
        <EditProfileScreen
          user={profileUser}
          onClose={() => setEditingProfile(false)}
          onUpdated={(patch) => setProfileUser((p) => ({ ...p, ...patch }))}
        />
      )}
    </div>
  );
}

/* ===========================================================
   ROOT
=========================================================== */

// La session elle-même (jeton JWT) est désormais entièrement gérée par Supabase Auth
// (stockée automatiquement et rafraîchie par le client supabase-js). On ne garde plus
// de copie maison dans localStorage : au chargement, on redemande le profil à Supabase.

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

const ADMIN_SESSION_KEY = "manhia_admin_session";
const ADMIN_SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12 heures

function loadAdminSession() {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return false;
    const { expiresAt } = JSON.parse(raw);
    if (Date.now() > expiresAt) {
      localStorage.removeItem(ADMIN_SESSION_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function saveAdminSession() {
  try {
    localStorage.setItem(
      ADMIN_SESSION_KEY,
      JSON.stringify({ expiresAt: Date.now() + ADMIN_SESSION_DURATION_MS })
    );
  } catch {
    // stockage indisponible — la session admin ne persistera simplement pas
  }
}

function clearAdminSession() {
  try {
    localStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {
    // rien à faire
  }
}

function PricingConfigPanel() {
  const [basePrice, setBasePrice] = useState(String(PRICING_CONFIG.basePrice));
  const [pricePerKm, setPricePerKm] = useState(String(PRICING_CONFIG.pricePerKm));
  const [commissionPercent, setCommissionPercent] = useState(String(Math.round(PRICING_CONFIG.commissionRate * 100)));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    const base = parseInt(basePrice, 10);
    const perKm = parseInt(pricePerKm, 10);
    const commission = parseFloat(commissionPercent);

    if (!base || base < 0 || !perKm || perKm < 0 || isNaN(commission) || commission < 0 || commission > 100) {
      setError("Vérifiez les valeurs saisies (nombres positifs, commission entre 0 et 100).");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await updatePricingConfig({ basePrice: base, pricePerKm: perKm, commissionRate: commission / 100 });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Erreur lors de l'enregistrement. Réessayez.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
      <p className="text-xs mb-4 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
        Ces valeurs s'appliquent immédiatement à toutes les nouvelles courses créées après l'enregistrement. Les courses déjà créées ne sont pas affectées.
      </p>

      <div className="space-y-4">
        <div>
          <label className="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
            Prix de base (FCFA)
          </label>
          <div className="flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: C.sand, border: `1px solid ${C.line}` }}>
            <input
              type="number"
              inputMode="numeric"
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: C.ink, fontFamily: FONT_BODY }}
            />
            <span className="text-xs font-semibold" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>FCFA</span>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
            Prix par kilomètre (FCFA)
          </label>
          <div className="flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: C.sand, border: `1px solid ${C.line}` }}>
            <input
              type="number"
              inputMode="numeric"
              value={pricePerKm}
              onChange={(e) => setPricePerKm(e.target.value)}
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: C.ink, fontFamily: FONT_BODY }}
            />
            <span className="text-xs font-semibold" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>FCFA/km</span>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
            Commission Manhïa
          </label>
          <div className="flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: C.sand, border: `1px solid ${C.line}` }}>
            <input
              type="number"
              inputMode="numeric"
              value={commissionPercent}
              onChange={(e) => setCommissionPercent(e.target.value)}
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: C.ink, fontFamily: FONT_BODY }}
            />
            <span className="text-xs font-semibold" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>%</span>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl p-3" style={{ background: C.sand }}>
        <p className="text-[11px] leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          Exemple : un trajet de 5 km coûterait{" "}
          <strong>
            {(
              (parseInt(basePrice, 10) || 0) + 5 * (parseInt(pricePerKm, 10) || 0)
            ).toLocaleString()}{" "}
            FCFA
          </strong>
          , dont{" "}
          <strong>
            {Math.round(
              ((parseInt(basePrice, 10) || 0) + 5 * (parseInt(pricePerKm, 10) || 0)) *
                ((parseFloat(commissionPercent) || 0) / 100)
            ).toLocaleString()}{" "}
            FCFA
          </strong>{" "}
          de commission Manhïa.
        </p>
      </div>

      {error && <p className="text-xs mt-3" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}
      {saved && <p className="text-xs mt-3 font-semibold" style={{ color: C.lagoon, fontFamily: FONT_BODY }}>Tarification mise à jour avec succès.</p>}

      <div className="mt-4">
        <PrimaryButton onClick={save} disabled={saving} tone="lagoon">
          {saving ? "Enregistrement..." : "Enregistrer la tarification"}
        </PrimaryButton>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, tone = "ink" }) {
  const color = { ink: C.ink, lagoon: C.lagoon, clay: C.clay, zem: C.zem }[tone];
  return (
    <div className="rounded-2xl p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color, fontFamily: FONT_DISPLAY }}>{value}</p>
      {sub && <p className="text-[10px] mt-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{sub}</p>}
    </div>
  );
}

function StatsPanel({ stats }) {
  if (!stats) {
    return <EmptyState icon={ShieldCheck} title="Statistiques indisponibles" sub="Réessayez dans un instant." />;
  }

  return (
    <>
      <div className="rounded-2xl p-5 mb-1" style={{ background: C.lagoonDeep }}>
        <p className="text-[11px]" style={{ color: "#BFE0D6", fontFamily: FONT_BODY }}>Revenu total (commissions perçues)</p>
        <p className="text-3xl font-bold mt-1" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>
          {stats.revenue.toLocaleString()} FCFA
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Courses totales" value={stats.totalCourses} tone="ink" />
        <StatCard label="7 derniers jours" value={stats.coursesLast7d} tone="zem" />
        <StatCard label="Livrées" value={stats.livrees} tone="lagoon" />
        <StatCard label="Annulées" value={stats.annulees} tone="clay" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Clients inscrits" value={stats.totalClients} sub={`${stats.activeClients} actifs (30j)`} tone="lagoon" />
        <StatCard label="Livreurs inscrits" value={stats.totalLivreurs} sub={`${stats.activeLivreurs} actifs (30j)`} tone="clay" />
      </div>

      <StatCard label="Courses en cours actuellement" value={stats.enCours} tone="zem" />
    </>
  );
}

function UserManagementPanel({ users, search, onSearchChange, onBlockTarget, onUnblock }) {
  const filtered = users.filter((u) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return u.name?.toLowerCase().includes(q) || u.phone?.includes(q);
  });

  return (
    <div>
      <div className="mb-3">
        <TextField label="Rechercher" value={search} onChange={onSearchChange} placeholder="Nom ou téléphone..." icon={Search} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={User} title="Aucun utilisateur trouvé" sub="Essayez une autre recherche." />
      ) : (
        <div className="space-y-2">
          {filtered.map((u) => {
            const blocked = isUserBlocked(u);
            return (
              <div key={u.id} className="rounded-2xl p-4" style={{ background: C.white, border: `1px solid ${blocked ? C.danger : C.line}` }}>
                <div className="flex items-center gap-3">
                  <Avatar url={u.avatar_url} size={40} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{u.name}</p>
                    <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{u.phone} · {u.role === "client" ? "Client" : "Livreur"}</p>
                  </div>
                  {blocked && <Tag tone="danger">Bloqué</Tag>}
                </div>
                {blocked && u.blocked_reason && (
                  <p className="text-xs mt-2 p-2 rounded-lg" style={{ background: C.sand, color: C.inkSoft, fontFamily: FONT_BODY }}>
                    {u.blocked_permanently ? "Définitif" : `Jusqu'au ${new Date(u.blocked_until).toLocaleDateString("fr-FR")}`} — {u.blocked_reason}
                  </p>
                )}
                <div className="flex gap-2 mt-3">
                  {blocked ? (
                    <button
                      onClick={() => onUnblock(u)}
                      className="flex-1 py-2 rounded-xl text-xs font-bold"
                      style={{ background: C.lagoon, color: C.white, fontFamily: FONT_DISPLAY }}
                    >
                      Débloquer
                    </button>
                  ) : (
                    <button
                      onClick={() => onBlockTarget(u)}
                      className="flex-1 py-2 rounded-xl text-xs font-bold"
                      style={{ background: C.white, border: `1px solid ${C.danger}`, color: C.danger, fontFamily: FONT_DISPLAY }}
                    >
                      Bloquer ce compte
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BlockUserModal({ user, onClose, onDone }) {
  const [mode, setMode] = useState("temporary"); // temporary | permanent
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!reason.trim()) {
      setError("Indiquez un motif de blocage.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      if (mode === "permanent") {
        await blockUserPermanently(user.id, reason.trim());
      } else {
        const daysNum = Math.max(1, parseInt(days, 10) || 1);
        const until = new Date(Date.now() + daysNum * 24 * 60 * 60 * 1000).toISOString();
        await blockUserTemporarily(user.id, until, reason.trim());
      }
      onDone();
    } catch {
      setError("Erreur lors du blocage. Réessayez.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(34,32,27,0.5)" }}>
      <div className="w-full rounded-t-3xl p-5 pb-8" style={{ background: C.white }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Bloquer {user.name}</h2>
          <button onClick={onClose}><X size={18} color={C.inkSoft} /></button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => setMode("temporary")}
            className="rounded-xl p-3 text-left"
            style={{ background: C.white, border: `2px solid ${mode === "temporary" ? C.zem : C.line}` }}
          >
            <p className="text-xs font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Temporaire</p>
            <p className="text-[10px] mt-0.5" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Pour X jours</p>
          </button>
          <button
            onClick={() => setMode("permanent")}
            className="rounded-xl p-3 text-left"
            style={{ background: C.white, border: `2px solid ${mode === "permanent" ? C.danger : C.line}` }}
          >
            <p className="text-xs font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Définitif</p>
            <p className="text-[10px] mt-0.5" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Suspension permanente</p>
          </button>
        </div>

        {mode === "temporary" && (
          <div className="mb-4">
            <label className="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
              Durée (jours)
            </label>
            <div className="flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: C.sand, border: `1px solid ${C.line}` }}>
              <input
                type="number"
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: C.ink, fontFamily: FONT_BODY }}
              />
              <span className="text-xs font-semibold" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>jours</span>
            </div>
          </div>
        )}

        <TextField label="Motif (visible par l'utilisateur)" value={reason} onChange={setReason} placeholder="Ex: Comportement inapproprié signalé plusieurs fois" />

        {error && <p className="text-xs mt-3" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}

        <div className="mt-5">
          <PrimaryButton onClick={submit} disabled={submitting} tone="ink">
            {submitting ? "..." : "Confirmer le blocage"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function PromotionsManagementPanel({ ads, onAdd, onEditTarget, onDelete, onToggleActive }) {
  return (
    <div>
      <button
        onClick={onAdd}
        className="w-full mb-4 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
        style={{ background: C.lagoon, color: C.white, fontFamily: FONT_DISPLAY }}
      >
        <Plus size={16} /> Ajouter une annonce
      </button>

      {ads.length === 0 ? (
        <EmptyState icon={Camera} title="Aucune annonce" sub="Ajoutez votre première annonce publicitaire pour l'écran d'accueil client." />
      ) : (
        <div className="space-y-3">
          {ads.map((ad) => (
            <div key={ad.id} className="rounded-2xl p-3" style={{ background: C.white, border: `1px solid ${C.line}` }}>
              <div className="flex gap-3">
                <img src={ad.image_url} alt={ad.title || "Annonce"} className="w-20 h-20 rounded-xl object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Tag tone={ad.active ? "lagoon" : "ink"}>{ad.active ? "Active" : "Inactive"}</Tag>
                    <span className="text-[10px]" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Ordre : {ad.display_order}</span>
                  </div>
                  <p className="text-sm font-bold truncate" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{ad.title || "Sans titre"}</p>
                  {ad.link_url && (
                    <p className="text-[11px] truncate" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{ad.link_url}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => onEditTarget(ad)}
                  className="flex-1 py-2 rounded-xl text-xs font-bold"
                  style={{ background: C.sand, color: C.ink, fontFamily: FONT_DISPLAY }}
                >
                  Modifier
                </button>
                <button
                  onClick={() => onToggleActive(ad)}
                  className="flex-1 py-2 rounded-xl text-xs font-bold"
                  style={{ background: C.white, border: `1px solid ${C.line}`, color: C.inkSoft, fontFamily: FONT_DISPLAY }}
                >
                  {ad.active ? "Désactiver" : "Activer"}
                </button>
                <button
                  onClick={() => onDelete(ad)}
                  className="flex-1 py-2 rounded-xl text-xs font-bold"
                  style={{ background: C.white, border: `1px solid ${C.danger}`, color: C.danger, fontFamily: FONT_DISPLAY }}
                >
                  Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PromotionEditModal({ ad, onClose, onDone }) {
  const [title, setTitle] = useState(ad?.title || "");
  const [linkUrl, setLinkUrl] = useState(ad?.link_url || "");
  const [displayOrder, setDisplayOrder] = useState(String(ad?.display_order ?? 0));
  const [imageUrl, setImageUrl] = useState(ad?.image_url || null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(ad?.image_url || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const save = async () => {
    if (!imageFile && !imageUrl) {
      setError("Ajoutez une image pour l'annonce.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      let finalImageUrl = imageUrl;
      if (imageFile) {
        finalImageUrl = await uploadPromotionImage(imageFile);
      }
      const orderNum = parseInt(displayOrder, 10) || 0;
      if (ad) {
        await updatePromotion(ad.id, { imageUrl: finalImageUrl, linkUrl, title, displayOrder: orderNum });
      } else {
        await createPromotion({ imageUrl: finalImageUrl, linkUrl, title, displayOrder: orderNum });
      }
      onDone();
    } catch {
      setError("Erreur lors de l'enregistrement. Réessayez.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(34,32,27,0.5)" }}>
      <div className="w-full rounded-t-3xl p-5 pb-8" style={{ background: C.white, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>
            {ad ? "Modifier l'annonce" : "Nouvelle annonce"}
          </h2>
          <button onClick={onClose}><X size={18} color={C.inkSoft} /></button>
        </div>

        <label
          className="flex flex-col items-center justify-center gap-2 rounded-xl py-6 mb-4 cursor-pointer overflow-hidden"
          style={{ background: C.sand, border: `1px dashed ${C.line}` }}
        >
          {imagePreview ? (
            <img src={imagePreview} alt="Aperçu" className="w-full max-h-40 object-cover rounded-lg" />
          ) : (
            <>
              <Camera size={22} color={C.inkSoft} />
              <span className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Choisir une image</span>
            </>
          )}
          <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
        </label>

        <div className="space-y-3">
          <TextField label="Titre (optionnel)" value={title} onChange={setTitle} placeholder="Ex: Promo spéciale" />
          <TextField label="Lien de redirection (optionnel)" value={linkUrl} onChange={setLinkUrl} placeholder="https://exemple.com" />
          <div>
            <label className="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
              Ordre d'affichage
            </label>
            <div className="flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: C.white, border: `1px solid ${C.line}` }}>
              <input
                type="number"
                inputMode="numeric"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: C.ink, fontFamily: FONT_BODY }}
              />
            </div>
            <p className="text-[10px] mt-1.5" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Les annonces s'affichent du plus petit au plus grand numéro.</p>
          </div>
        </div>

        {error && <p className="text-xs mt-3" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}

        <div className="mt-5">
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? "Enregistrement..." : "Enregistrer"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function LivreursBonusPanel({ livreurs, bonusThreshold, onMarkPaid }) {
  const eligible = livreurs.filter((l) => l.completedCourses >= bonusThreshold);
  const inProgress = livreurs.filter((l) => l.completedCourses < bonusThreshold);

  return (
    <div>
      <div className="rounded-2xl p-4 mb-4" style={{ background: C.lagoonDeep }}>
        <p className="text-[11px]" style={{ color: "#BFE0D6", fontFamily: FONT_BODY }}>Objectif du bonus</p>
        <p className="text-lg font-bold mt-1" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>
          {bonusThreshold} courses livrées → 5 000 FCFA
        </p>
      </div>

      {eligible.length > 0 && (
        <>
          <p className="text-xs font-bold uppercase tracking-[0.14em] mb-3" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
            Objectif atteint ({eligible.length})
          </p>
          <div className="space-y-2 mb-5">
            {eligible.map((l) => (
              <div key={l.id} className="rounded-2xl p-4" style={{ background: C.white, border: `2px solid ${C.zem}` }}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{l.name}</p>
                    <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{l.phone}</p>
                  </div>
                  <Tag tone="zem">{l.completedCourses} courses</Tag>
                </div>
                {l.livreur_bonus_paid ? (
                  <div className="flex items-center gap-2 mt-2">
                    <CheckCircle2 size={15} color={C.lagoon} />
                    <p className="text-xs font-semibold" style={{ color: C.lagoon, fontFamily: FONT_BODY }}>Bonus déjà versé</p>
                  </div>
                ) : (
                  <button
                    onClick={() => onMarkPaid(l)}
                    className="w-full mt-2 py-2.5 rounded-xl text-sm font-bold"
                    style={{ background: C.lagoon, color: C.white, fontFamily: FONT_DISPLAY }}
                  >
                    Marquer le bonus comme versé
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-xs font-bold uppercase tracking-[0.14em] mb-3" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
        En cours ({inProgress.length})
      </p>
      {inProgress.length === 0 ? (
        <EmptyState icon={Package} title="Aucun livreur en cours" sub="Les livreurs actifs apparaîtront ici avec leur progression." />
      ) : (
        <div className="space-y-2">
          {inProgress.map((l) => (
            <div key={l.id} className="rounded-xl p-3" style={{ background: C.white, border: `1px solid ${C.line}` }}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{l.name}</p>
                <span className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>{l.completedCourses} / {bonusThreshold}</span>
              </div>
              <div className="w-full h-1.5 rounded-full mt-2" style={{ background: C.sandDeep }}>
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${Math.min(100, (l.completedCourses / bonusThreshold) * 100)}%`, background: C.zem }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PromoCodeRow({ promo, onToggleActive, onEditTarget, onDelete }) {
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState("");

  const handleToggle = async () => {
    setBusy(true);
    setRowError("");
    try {
      await onToggleActive(promo);
    } catch {
      setRowError("Erreur lors de la mise à jour. Réessayez.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setRowError("");
    try {
      await onDelete(promo);
    } catch (e) {
      if (e.code === "ALREADY_USED") {
        setRowError("Ce code a déjà été utilisé par des clients — désactivez-le plutôt que de le supprimer.");
      } else {
        setRowError("Erreur lors de la suppression. Réessayez.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between mb-2">
        <Tag tone={promo.active ? "lagoon" : "ink"}>{promo.active ? "Actif" : "Inactif"}</Tag>
        <span className="text-lg font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{promo.code}</span>
      </div>
      <div className="flex justify-between text-xs" style={{ fontFamily: FONT_BODY }}>
        <span style={{ color: C.inkSoft }}>Réduction max : {Number(promo.max_discount).toLocaleString()} FCFA</span>
        <span style={{ color: C.inkSoft }}>Max {promo.max_uses_per_user}× par client</span>
      </div>
      {rowError && (
        <p className="text-xs mt-2 leading-snug" style={{ color: C.danger, fontFamily: FONT_BODY }}>{rowError}</p>
      )}
      <div className="flex gap-2 mt-3">
        <button
          onClick={handleToggle}
          disabled={busy}
          className="flex-1 py-2 rounded-xl text-xs font-bold"
          style={{ background: C.sand, color: C.ink, fontFamily: FONT_DISPLAY, opacity: busy ? 0.6 : 1 }}
        >
          {promo.active ? "Désactiver" : "Activer"}
        </button>
        <button
          onClick={() => onEditTarget(promo)}
          disabled={busy}
          className="flex-1 py-2 rounded-xl text-xs font-bold"
          style={{ background: C.white, border: `1px solid ${C.line}`, color: C.inkSoft, fontFamily: FONT_DISPLAY, opacity: busy ? 0.6 : 1 }}
        >
          Modifier
        </button>
        <button
          onClick={handleDelete}
          disabled={busy}
          className="flex-1 py-2 rounded-xl text-xs font-bold"
          style={{ background: C.white, border: `1px solid ${C.danger}`, color: C.danger, fontFamily: FONT_DISPLAY, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "..." : "Supprimer"}
        </button>
      </div>
    </div>
  );
}

function PromoCodesManagementPanel({ codes, onAdd, onToggleActive, onEditTarget, onDelete }) {
  return (
    <div>
      <button
        onClick={onAdd}
        className="w-full mb-4 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
        style={{ background: C.lagoon, color: C.white, fontFamily: FONT_DISPLAY }}
      >
        <Plus size={16} /> Créer un code promo
      </button>

      {codes.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="Aucun code promo" sub="Créez votre premier code promotionnel pour vos testeurs pilotes." />
      ) : (
        <div className="space-y-3">
          {codes.map((c) => (
            <PromoCodeRow
              key={c.id}
              promo={c}
              onToggleActive={onToggleActive}
              onEditTarget={onEditTarget}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PromoCodeEditModal({ promo, onClose, onDone }) {
  const [code, setCode] = useState(promo?.code || "");
  const [maxDiscount, setMaxDiscount] = useState(String(promo?.max_discount ?? 1000));
  const [maxUsesPerUser, setMaxUsesPerUser] = useState(String(promo?.max_uses_per_user ?? 3));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!code.trim()) {
      setError("Indiquez un code (ex: MANHIA2026).");
      return;
    }
    const discountNum = parseInt(maxDiscount, 10);
    const usesNum = parseInt(maxUsesPerUser, 10);
    if (!discountNum || discountNum <= 0) {
      setError("Indiquez un montant de réduction valide.");
      return;
    }
    if (!usesNum || usesNum <= 0) {
      setError("Indiquez un nombre d'utilisations valide.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      if (promo) {
        await updatePromoCode(promo.id, { maxDiscount: discountNum, maxUsesPerUser: usesNum });
      } else {
        await createPromoCode({ code, maxDiscount: discountNum, maxUsesPerUser: usesNum });
      }
      onDone();
    } catch (e) {
      setError(e.message?.includes("duplicate") ? "Ce code existe déjà." : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(34,32,27,0.5)" }}>
      <div className="w-full rounded-t-3xl p-5 pb-8" style={{ background: C.white }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>
            {promo ? "Modifier le code promo" : "Nouveau code promo"}
          </h2>
          <button onClick={onClose}><X size={18} color={C.inkSoft} /></button>
        </div>

        <div className="space-y-3">
          <TextField
            label="Code (visible par les clients)"
            value={code}
            onChange={(v) => setCode(v.toUpperCase())}
            placeholder="Ex: MANHIA2026"
          />
          {promo && (
            <p className="text-[10px] -mt-2 px-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
              Le code lui-même ne peut pas être modifié après création — supprimez et recréez-en un si besoin.
            </p>
          )}

          <div>
            <label className="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
              Réduction maximum par course
            </label>
            <div className="flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: C.sand, border: `1px solid ${C.line}` }}>
              <input
                type="number"
                inputMode="numeric"
                value={maxDiscount}
                onChange={(e) => setMaxDiscount(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: C.ink, fontFamily: FONT_BODY }}
              />
              <span className="text-xs font-semibold" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>FCFA</span>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
              Nombre d'utilisations par client
            </label>
            <div className="flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: C.sand, border: `1px solid ${C.line}` }}>
              <input
                type="number"
                inputMode="numeric"
                value={maxUsesPerUser}
                onChange={(e) => setMaxUsesPerUser(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: C.ink, fontFamily: FONT_BODY }}
              />
            </div>
          </div>
        </div>

        {error && <p className="text-xs mt-3" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}

        <div className="mt-5">
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? "Enregistrement..." : "Enregistrer"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function CountryPricingRow({ pricing, onSave }) {
  const [basePrice, setBasePrice] = useState(String(pricing.base_price));
  const [pricePerKm, setPricePerKm] = useState(String(pricing.price_per_km));
  const [commissionPercent, setCommissionPercent] = useState(String(Math.round(pricing.commission_rate * 100)));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    const base = parseInt(basePrice, 10);
    const perKm = parseInt(pricePerKm, 10);
    const commission = parseFloat(commissionPercent);
    if (!base || base < 0 || !perKm || perKm < 0 || isNaN(commission) || commission < 0 || commission > 100) {
      setError("Vérifiez les valeurs saisies.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave(pricing.country, { basePrice: base, pricePerKm: perKm, commissionRate: commission / 100 });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl p-4" style={{ background: C.white, border: `1px solid ${C.line}` }}>
      <p className="text-sm font-bold mb-3" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{pricing.country_label}</p>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wide mb-1 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>Base</label>
          <input
            type="number"
            inputMode="numeric"
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
            className="w-full rounded-lg px-2.5 py-2 text-sm outline-none"
            style={{ background: C.sand, border: `1px solid ${C.line}`, color: C.ink, fontFamily: FONT_BODY }}
          />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wide mb-1 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>FCFA/km</label>
          <input
            type="number"
            inputMode="numeric"
            value={pricePerKm}
            onChange={(e) => setPricePerKm(e.target.value)}
            className="w-full rounded-lg px-2.5 py-2 text-sm outline-none"
            style={{ background: C.sand, border: `1px solid ${C.line}`, color: C.ink, fontFamily: FONT_BODY }}
          />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wide mb-1 block" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>Commission %</label>
          <input
            type="number"
            inputMode="numeric"
            value={commissionPercent}
            onChange={(e) => setCommissionPercent(e.target.value)}
            className="w-full rounded-lg px-2.5 py-2 text-sm outline-none"
            style={{ background: C.sand, border: `1px solid ${C.line}`, color: C.ink, fontFamily: FONT_BODY }}
          />
        </div>
      </div>
      {error && <p className="text-xs mb-2" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}
      {saved && <p className="text-xs mb-2 font-semibold" style={{ color: C.lagoon, fontFamily: FONT_BODY }}>Enregistré.</p>}
      <button
        onClick={save}
        disabled={saving}
        className="w-full py-2 rounded-xl text-xs font-bold"
        style={{ background: C.lagoon, color: C.white, fontFamily: FONT_DISPLAY, opacity: saving ? 0.7 : 1 }}
      >
        {saving ? "..." : "Enregistrer"}
      </button>
    </div>
  );
}

function CountriesPanel({ multiCountryEnabled, onToggleMultiCountry, pricingList, onSavePricing }) {
  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    try {
      await onToggleMultiCountry(!multiCountryEnabled);
    } finally {
      setToggling(false);
    }
  };

  return (
    <div>
      <div className="rounded-2xl p-4 mb-5" style={{ background: multiCountryEnabled ? C.lagoonDeep : C.white, border: multiCountryEnabled ? "none" : `1px solid ${C.line}` }}>
        <div className="flex items-center justify-between">
          <div className="flex-1 pr-3">
            <p className="text-sm font-bold" style={{ color: multiCountryEnabled ? C.white : C.ink, fontFamily: FONT_DISPLAY }}>
              Multi-pays {multiCountryEnabled ? "activé" : "désactivé"}
            </p>
            <p className="text-xs mt-1 leading-snug" style={{ color: multiCountryEnabled ? "#BFE0D6" : C.inkSoft, fontFamily: FONT_BODY }}>
              {multiCountryEnabled
                ? "Le sélecteur de pays est visible à l'inscription. Les livreurs ne voient que les courses de leur pays."
                : "Tous les utilisateurs sont considérés comme au Bénin, comme actuellement."}
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggling}
            className="w-14 h-8 rounded-full flex items-center px-1 shrink-0"
            style={{ background: multiCountryEnabled ? C.zem : C.sandDeep, justifyContent: multiCountryEnabled ? "flex-end" : "flex-start" }}
          >
            <div className="w-6 h-6 rounded-full" style={{ background: C.white }} />
          </button>
        </div>
      </div>

      <p className="text-xs font-bold uppercase tracking-[0.14em] mb-3" style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>
        Tarification par pays
      </p>
      <div className="space-y-3">
        {pricingList.map((p) => (
          <CountryPricingRow key={p.country} pricing={p} onSave={onSavePricing} />
        ))}
      </div>
    </div>
  );
}

function AdminPage() {
  const [authed, setAuthed] = useState(() => loadAdminSession());
  const [tab, setTab] = useState("stats");
  const [complaints, setComplaints] = useState([]);
  const [passwordRequests, setPasswordRequests] = useState([]);
  const [livreurs, setLivreurs] = useState([]);
  const [unpaidCourses, setUnpaidCourses] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resetTarget, setResetTarget] = useState(null);
  const [payTarget, setPayTarget] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [userSearch, setUserSearch] = useState("");
  const [blockTarget, setBlockTarget] = useState(null);
  const [ads, setAds] = useState([]);
  const [adEditTarget, setAdEditTarget] = useState(null);
  const [addingAd, setAddingAd] = useState(false);
  const [bonusLivreurs, setBonusLivreurs] = useState([]);
  const [promoCodes, setPromoCodes] = useState([]);
  const [promoEditTarget, setPromoEditTarget] = useState(null);
  const [addingPromo, setAddingPromo] = useState(false);
  const [multiCountryEnabled, setMultiCountryEnabled] = useState(false);
  const [pricingByCountry, setPricingByCountry] = useState([]);

  const load = useCallback(async () => {
    const [c, p, l, u, s, au, ad, bl, pc, mc, pbc] = await Promise.all([
      fetchComplaints(),
      fetchPasswordRequests(),
      fetchPendingLivreurs(),
      fetchUnpaidArrivedCourses(),
      fetchStats(),
      fetchAllUsersForAdmin(),
      fetchAllPromotionsForAdmin(),
      fetchLivreursBonusProgress(),
      fetchAllPromoCodesForAdmin(),
      isMultiCountryEnabled(),
      fetchAllPricingByCountry(),
    ]);
    setComplaints(c);
    setPasswordRequests(p);
    setLivreurs(l);
    setUnpaidCourses(u);
    setStats(s);
    setAllUsers(au);
    setAds(ad);
    setBonusLivreurs(bl);
    setPromoCodes(pc);
    setMultiCountryEnabled(mc);
    setPricingByCountry(pbc);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authed) load();
  }, [authed, load]);

  if (!authed) return <AdminLogin onSuccess={() => { saveAdminSession(); setAuthed(true); }} />;

  const openComplaints = complaints.filter((c) => c.status !== "traite");
  const openRequests = passwordRequests.filter((p) => p.status !== "traite");
  const pendingLivreurs = livreurs.filter((l) => l.verification_status === "en_attente");

  return (
    <div style={{ background: C.sand, minHeight: "100vh" }}>
      <div className="px-5 pt-6 pb-4 flex items-center justify-between" style={{ background: C.ink }}>
        <div>
          <h1 className="text-lg font-bold" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>Admin Manhïa</h1>
          <p className="text-xs mt-1" style={{ color: "#B8B2A3", fontFamily: FONT_BODY }}>Plaintes et demandes des utilisateurs</p>
        </div>
        <button
          onClick={() => { clearAdminSession(); setAuthed(false); }}
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "#332F27" }}
        >
          <LogOut size={15} color={C.white} />
        </button>
      </div>

      <div className="flex px-5 mt-4 gap-2 flex-wrap">
        <button
          onClick={() => setTab("stats")}
          className="flex-1 py-2.5 rounded-full text-xs font-bold"
          style={{ background: tab === "stats" ? C.ink : C.white, color: tab === "stats" ? C.white : C.ink, border: `1px solid ${C.line}`, fontFamily: FONT_DISPLAY }}
        >
          Statistiques
        </button>
        <button
          onClick={() => setTab("livreurs")}
          className="flex-1 py-2.5 rounded-full text-xs font-bold"
          style={{ background: tab === "livreurs" ? C.ink : C.white, color: tab === "livreurs" ? C.white : C.ink, border: `1px solid ${C.line}`, fontFamily: FONT_DISPLAY }}
        >
          Livreurs {pendingLivreurs.length > 0 && `(${pendingLivreurs.length})`}
        </button>
        <button
          onClick={() => setTab("paiements")}
          className="flex-1 py-2.5 rounded-full text-xs font-bold"
          style={{ background: tab === "paiements" ? C.ink : C.white, color: tab === "paiements" ? C.white : C.ink, border: `1px solid ${C.line}`, fontFamily: FONT_DISPLAY }}
        >
          Paiements {unpaidCourses.length > 0 && `(${unpaidCourses.length})`}
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
        <button
          onClick={() => setTab("tarification")}
          className="flex-1 py-2.5 rounded-full text-xs font-bold"
          style={{ background: tab === "tarification" ? C.ink : C.white, color: tab === "tarification" ? C.white : C.ink, border: `1px solid ${C.line}`, fontFamily: FONT_DISPLAY }}
        >
          Tarification
        </button>
        <button
          onClick={() => setTab("utilisateurs")}
          className="flex-1 py-2.5 rounded-full text-xs font-bold"
          style={{ background: tab === "utilisateurs" ? C.ink : C.white, color: tab === "utilisateurs" ? C.white : C.ink, border: `1px solid ${C.line}`, fontFamily: FONT_DISPLAY }}
        >
          Utilisateurs
        </button>
        <button
          onClick={() => setTab("publicites")}
          className="flex-1 py-2.5 rounded-full text-xs font-bold"
          style={{ background: tab === "publicites" ? C.ink : C.white, color: tab === "publicites" ? C.white : C.ink, border: `1px solid ${C.line}`, fontFamily: FONT_DISPLAY }}
        >
          Publicités
        </button>
        <button
          onClick={() => setTab("bonus")}
          className="flex-1 py-2.5 rounded-full text-xs font-bold"
          style={{ background: tab === "bonus" ? C.ink : C.white, color: tab === "bonus" ? C.white : C.ink, border: `1px solid ${C.line}`, fontFamily: FONT_DISPLAY }}
        >
          Bonus livreurs
        </button>
        <button
          onClick={() => setTab("codespromo")}
          className="flex-1 py-2.5 rounded-full text-xs font-bold"
          style={{ background: tab === "codespromo" ? C.ink : C.white, color: tab === "codespromo" ? C.white : C.ink, border: `1px solid ${C.line}`, fontFamily: FONT_DISPLAY }}
        >
          Codes promo
        </button>
        <button
          onClick={() => setTab("pays")}
          className="flex-1 py-2.5 rounded-full text-xs font-bold"
          style={{ background: tab === "pays" ? C.ink : C.white, color: tab === "pays" ? C.white : C.ink, border: `1px solid ${C.line}`, fontFamily: FONT_DISPLAY }}
        >
          Pays
        </button>
      </div>

      <div className="px-5 mt-4 pb-10 space-y-3">
        {loading ? (
          <p className="text-xs" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Chargement...</p>
        ) : tab === "stats" ? (
          <StatsPanel stats={stats} />
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
        ) : tab === "paiements" ? (
          unpaidCourses.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Aucun paiement en attente" sub="Les courses arrivées sans confirmation de paiement automatique apparaîtront ici." />
          ) : (
            unpaidCourses.map((c) => (
              <div key={c.id} className="rounded-2xl p-4" style={{ background: C.white, border: `2px solid ${C.zem}` }}>
                <div className="flex items-center justify-between mb-2">
                  <Tag tone="zem">Paiement non confirmé</Tag>
                  <span className="text-sm font-bold" style={{ color: C.clay, fontFamily: FONT_DISPLAY }}>{c.price.toLocaleString()} F</span>
                </div>
                <RouteDots />
                <div className="flex justify-between text-xs mt-1 gap-2" style={{ fontFamily: FONT_BODY }}>
                  <span style={{ color: C.ink }} className="truncate">{shortLabel(c.stops[0])}</span>
                  <span style={{ color: C.ink }} className="truncate text-right">{shortLabel(c.stops[c.stops.length - 1])}</span>
                </div>
                <p className="text-[11px] mt-2" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                  Payeur : {c.payerType === "destinataire" ? `${c.recipientName} (${c.recipientPhone})` : `${c.clientName} (${c.clientPhone})`}
                </p>
                <p className="text-[11px]" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Livreur : {c.livreurName || "—"}</p>
                <button
                  onClick={() => setPayTarget(c)}
                  className="w-full mt-3 py-2.5 rounded-xl text-xs font-bold"
                  style={{ background: C.lagoon, color: C.white, fontFamily: FONT_DISPLAY }}
                >
                  Confirmer manuellement (avec preuve)
                </button>
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
        ) : tab === "passwords" ? (
          passwordRequests.length === 0 ? (
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
                    </button>
                    <button
                      onClick={async () => { await markPasswordRequestTreated(p.id); load(); }}
                      className="flex-1 py-2 rounded-xl text-xs font-bold"
                      style={{ background: C.white, border: `1px solid ${C.line}`, color: C.inkSoft, fontFamily: FONT_DISPLAY }}
                    >
                      Marquer traité
                    </button>
                  </div>
                )}
              </div>
            ))
          )
        ) : tab === "tarification" ? (
          <PricingConfigPanel />
        ) : tab === "utilisateurs" ? (
          <UserManagementPanel
            users={allUsers}
            search={userSearch}
            onSearchChange={setUserSearch}
            onBlockTarget={setBlockTarget}
            onUnblock={async (u) => { await unblockUser(u.id); load(); }}
          />
        ) : tab === "publicites" ? (
          <PromotionsManagementPanel
            ads={ads}
            onAdd={() => setAddingAd(true)}
            onEditTarget={setAdEditTarget}
            onDelete={async (ad) => { await deletePromotion(ad.id); load(); }}
            onToggleActive={async (ad) => { await updatePromotion(ad.id, { active: !ad.active }); load(); }}
          />
        ) : tab === "bonus" ? (
          <LivreursBonusPanel
            livreurs={bonusLivreurs}
            bonusThreshold={10}
            onMarkPaid={async (l) => { await markLivreurBonusPaid(l.id); load(); }}
          />
        ) : tab === "codespromo" ? (
          <PromoCodesManagementPanel
            codes={promoCodes}
            onAdd={() => setAddingPromo(true)}
            onEditTarget={setPromoEditTarget}
            onToggleActive={async (c) => { await updatePromoCode(c.id, { active: !c.active }); load(); }}
            onDelete={async (c) => { await deletePromoCode(c.id); load(); }}
          />
        ) : (
          <CountriesPanel
            multiCountryEnabled={multiCountryEnabled}
            onToggleMultiCountry={async (enabled) => {
              await updateAppSetting("multi_country_enabled", enabled);
              setMultiCountryEnabled(enabled);
            }}
            pricingList={pricingByCountry}
            onSavePricing={async (country, patch) => {
              await updatePricingForCountry(country, patch);
              load();
            }}
          />
        )}
      </div>

      {resetTarget && (
        <ResetPasswordModal
          request={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={async () => { setResetTarget(null); load(); }}
        />
      )}
      {payTarget && (
        <ManualPaymentModal
          course={payTarget}
          onClose={() => setPayTarget(null)}
          onDone={async () => { setPayTarget(null); load(); }}
        />
      )}
      {blockTarget && (
        <BlockUserModal
          user={blockTarget}
          onClose={() => setBlockTarget(null)}
          onDone={() => { setBlockTarget(null); load(); }}
        />
      )}
      {(addingAd || adEditTarget) && (
        <PromotionEditModal
          ad={adEditTarget}
          onClose={() => { setAddingAd(false); setAdEditTarget(null); }}
          onDone={() => { setAddingAd(false); setAdEditTarget(null); load(); }}
        />
      )}
      {(addingPromo || promoEditTarget) && (
        <PromoCodeEditModal
          promo={promoEditTarget}
          onClose={() => { setAddingPromo(false); setPromoEditTarget(null); }}
          onDone={() => { setAddingPromo(false); setPromoEditTarget(null); load(); }}
        />
      )}
    </div>
  );
}

function ManualPaymentModal({ course, onClose, onDone }) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!note.trim()) {
      setError("Indiquez une référence ou preuve (ex: référence MTN MoMo, capture partagée par le client).");
      return;
    }
    setSubmitting(true);
    try {
      await manuallyMarkPaid(course.id, note.trim(), course.history);
      onDone();
    } catch {
      setError("Erreur. Réessayez.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(34,32,27,0.5)" }}>
      <div className="w-full rounded-t-3xl p-5 pb-8" style={{ background: C.white }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Confirmer le paiement manuellement</h2>
          <button onClick={onClose}><X size={18} color={C.inkSoft} /></button>
        </div>
        <p className="text-xs mb-4 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          À utiliser uniquement si le paiement a réellement été effectué (ex: notification Mobile Money reçue) mais que l'application n'a pas pu le confirmer automatiquement, suite à une erreur technique.
        </p>
        <TextField label="Référence ou preuve du paiement" value={note} onChange={setNote} placeholder="Ex: ID transaction MTN 12402136838" />
        {error && <p className="text-xs mt-3" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}
        <div className="mt-5">
          <PrimaryButton onClick={submit} disabled={submitting}>
            {submitting ? "..." : "Confirmer le paiement"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({ request, onClose, onDone }) {
  const [submitting, setSubmitting] = useState(false);

  const markTreated = async () => {
    setSubmitting(true);
    try {
      await markPasswordRequestTreated(request.id);
      onDone();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(34,32,27,0.5)" }}>
      <div className="w-full rounded-t-3xl p-5 pb-8" style={{ background: C.white }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Demande obsolète</h2>
          <button onClick={onClose}><X size={18} color={C.inkSoft} /></button>
        </div>
        <p className="text-xs mb-4 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          Depuis la migration vers Supabase Auth, les utilisateurs réinitialisent eux-mêmes leur mot de passe via le lien "Mot de passe oublié" envoyé par email — l'admin ne peut plus le faire manuellement.
        </p>
        <p className="text-xs mb-4" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
          Pour {request.name} ({request.phone}) : invitez la personne à utiliser ce lien depuis l'écran de connexion.
        </p>
        <PrimaryButton onClick={markTreated} disabled={submitting}>
          {submitting ? "..." : "Marquer comme traité"}
        </PrimaryButton>
      </div>
    </div>
  );
}

function PaymentScreen({ courseId }) {
  const [course, setCourse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    const c = await fetchCourseById(courseId);
    setCourse(c);
    setLoading(false);
    if (c?.paid) setDone(true);
  }, [courseId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`payment-${courseId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "courses", filter: `id=eq.${courseId}` }, () => {
        load();
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load, courseId]);

  const payerName = course?.payerType === "destinataire" ? course.recipientName : course?.clientName;
  const payerPhone = course?.payerType === "destinataire" ? course.recipientPhone : course?.clientPhone;

  const [paymentSucceededButSyncFailed, setPaymentSucceededButSyncFailed] = useState(false);
  const [pendingPaymentRef, setPendingPaymentRef] = useState(null);

  const confirmPaidStatus = async (paymentRef) => {
    try {
      await updateCourse(course.id, {
        paid: true,
        paymentRef: paymentRef ? String(paymentRef) : null,
        paymentAmount: course.price,
        history: [...course.history, { label: "Paiement confirmé à la livraison", at: Date.now() }],
      });
      setPaymentSucceededButSyncFailed(false);
      setDone(true);
    } catch {
      // Le paiement FedaPay a déjà réussi à ce stade : on ne redemande jamais de repayer,
      // on propose seulement de réessayer la synchronisation avec l'app.
      setPaymentSucceededButSyncFailed(true);
      setPendingPaymentRef(paymentRef);
    }
  };

  // Interroge le VRAI statut de la transaction FedaPay via l'Edge Function
  // (le widget peut afficher "terminé" avant que Mobile Money ait fini de confirmer).
  // Réessaie plusieurs fois avec un court délai, car la confirmation Mobile Money
  // peut prendre quelques secondes après validation du code par le client.
  const verifyTransactionStatus = async (transactionId, attempt = 1) => {
    try {
      const { data, error } = await supabase.functions.invoke("check-fedapay-status", {
        body: { transactionId },
      });
      if (error) throw error;

      if (data.status === "approved") {
        return true;
      }
      if (data.status === "declined" || data.status === "canceled") {
        return false;
      }
      // status "pending" ou autre : on réessaie, jusqu'à 5 fois (environ 15 secondes au total)
      if (attempt < 5) {
        await new Promise((r) => setTimeout(r, 3000));
        return verifyTransactionStatus(transactionId, attempt + 1);
      }
      return null; // statut toujours incertain après plusieurs tentatives
    } catch {
      return null;
    }
  };

  const pay = async () => {
    if (!course) return;
    setError("");
    setPaying(true);
    try {
      const result = await openFedaPayCheckout({
        amount: course.price,
        description: `Livraison Manhïa — ${course.item}`,
        customer: {
          firstname: (payerName || "Client").split(" ")[0],
          lastname: (payerName || "Manhïa").split(" ").slice(1).join(" ") || "Manhïa",
          phone_number: payerPhone,
        },
      });

      const transactionId = result.transaction?.id;
      if (!transactionId) {
        setError("Le paiement n'a pas été finalisé. Réessayez.");
        setPaying(false);
        return;
      }

      // Que le widget dise success ou non, on vérifie toujours le vrai statut
      // auprès de FedaPay avant de conclure quoi que ce soit.
      const reallyPaid = await verifyTransactionStatus(transactionId);

      if (reallyPaid === true) {
        await confirmPaidStatus(transactionId);
      } else if (reallyPaid === false) {
        setError("Le paiement a été refusé ou annulé. Réessayez.");
      } else {
        // Statut encore incertain après plusieurs tentatives : on ne sait pas si
        // l'argent a été prélevé, donc on ne redemande PAS de payer à nouveau.
        setPaymentSucceededButSyncFailed(true);
        setPendingPaymentRef(transactionId);
      }
    } catch {
      setError("Une erreur est survenue pendant le paiement. Réessayez.");
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.sand }}>
        <p style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>Chargement...</p>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: C.sand }}>
        <AlertCircle size={32} color={C.danger} className="mb-3" />
        <p className="text-sm font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Course introuvable</p>
        <p className="text-xs mt-2" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Le lien utilisé n'est plus valide.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 pt-14 pb-8 flex flex-col" style={{ background: C.sand }}>
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Manhïa</h1>
        <p className="text-xs mt-1" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Paiement de votre livraison</p>
      </div>

      {done ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <CheckCircle2 size={40} color={C.lagoon} className="mb-4" />
          <p className="text-base font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>Paiement confirmé</p>
          <p className="text-xs mt-2 max-w-xs leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
            Le livreur peut maintenant vous remettre le colis.
          </p>
          <button
            onClick={() => { window.location.hash = ""; }}
            className="w-full max-w-xs mt-8 py-3.5 rounded-2xl text-sm font-bold"
            style={{ background: C.lagoon, color: C.white, fontFamily: FONT_DISPLAY }}
          >
            Retour à mes courses
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-2xl p-4 mb-5" style={{ background: C.white, border: `1px solid ${C.line}` }}>
            <Tag tone="zem">Livreur arrivé</Tag>
            <div className="mt-3">
              <RouteDots />
              <div className="flex justify-between text-xs mt-1 gap-2" style={{ fontFamily: FONT_BODY }}>
                <span style={{ color: C.ink }} className="truncate">{shortLabel(course.stops[0])}</span>
                <span style={{ color: C.ink }} className="truncate text-right">{shortLabel(course.stops[course.stops.length - 1])}</span>
              </div>
            </div>
            {course.livreurName && (
              <p className="text-xs mt-3" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>Livreur : {course.livreurName}</p>
            )}
          </div>

          <div className="rounded-2xl p-4 mb-6" style={{ background: C.lagoonDeep }}>
            <p className="text-[11px]" style={{ color: "#BFE0D6", fontFamily: FONT_BODY }}>Montant à payer</p>
            <p className="text-3xl font-bold mt-1" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>
              {course.price.toLocaleString()} FCFA
            </p>
            {course.needsPurchase && course.purchaseActual != null && (
              <p className="text-[11px] mt-2" style={{ color: C.zem, fontFamily: FONT_BODY }}>
                Inclut l'achat effectué par le livreur ({course.purchaseActual.toLocaleString()} FCFA)
              </p>
            )}
          </div>

          {paymentSucceededButSyncFailed ? (
            <div className="rounded-2xl p-4 mb-4" style={{ background: `${C.zem}22`, border: `1px solid ${C.zem}` }}>
              <p className="text-sm font-bold mb-2" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>
                Votre paiement a bien été reçu
              </p>
              <p className="text-xs leading-snug mb-3" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                Il y a eu un problème pour mettre à jour l'application, mais votre argent a bien été débité. Ne payez pas une seconde fois — appuyez sur le bouton ci-dessous pour réessayer la synchronisation.
              </p>
              <PrimaryButton onClick={() => confirmPaidStatus(pendingPaymentRef)} tone="lagoon">
                Synchroniser à nouveau
              </PrimaryButton>
            </div>
          ) : (
            <>
              {error && <p className="text-xs mb-3 text-center" style={{ color: C.danger, fontFamily: FONT_BODY }}>{error}</p>}

              <PrimaryButton onClick={pay} disabled={paying}>
                {paying ? "Paiement en cours..." : `Payer ${course.price.toLocaleString()} FCFA`}
              </PrimaryButton>
              <p className="text-[10px] text-center mt-3" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
                Paiement sécurisé par Mobile Money (MTN, Moov) via FedaPay
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function ManhiaPrototype() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAdminRoute, setIsAdminRoute] = useState(() => window.location.hash === "#admin");
  const [isResetRoute, setIsResetRoute] = useState(() => window.location.hash.startsWith("#reset-password"));
  const [paymentCourseId, setPaymentCourseId] = useState(() => {
    const match = window.location.hash.match(/^#pay=(.+)$/);
    return match ? match[1] : null;
  });
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    fetchPricingConfig().finally(() => setConfigLoaded(true));
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      setIsAdminRoute(window.location.hash === "#admin");
      setIsResetRoute(window.location.hash.startsWith("#reset-password"));
      const match = window.location.hash.match(/^#pay=(.+)$/);
      setPaymentCourseId(match ? match[1] : null);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Charge le profil applicatif (public.users) correspondant à la session Supabase Auth active.
  const loadProfileFromSession = useCallback(async (session) => {
    if (!session?.user) {
      setUser(null);
      return;
    }
    const profile = await findUserById(session.user.id);
    if (profile) {
      setUser({
        id: profile.id,
        name: profile.name,
        phone: profile.phone,
        role: profile.role,
        rating: profile.rating,
        balance: profile.balance,
        verificationStatus: profile.verification_status,
        avatarUrl: profile.avatar_url,
        blockedUntil: profile.blocked_until,
        blockedPermanently: profile.blocked_permanently,
        blockedReason: profile.blocked_reason,
        country: profile.country || "benin",
      });
    }
  }, []);

  useEffect(() => {
    // Session initiale au chargement de l'app
    supabase.auth.getSession().then(({ data }) => {
      loadProfileFromSession(data.session).finally(() => setAuthLoading(false));
    });

    // Écoute les changements de session (connexion, déconnexion, rafraîchissement de jeton)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      loadProfileFromSession(session);
    });

    return () => sub.subscription.unsubscribe();
  }, [loadProfileFromSession]);

  const handleAuth = (u) => {
    setUser(u);
  };

  const handleLogout = async () => {
    await signOutUser();
    setUser(null);
  };

  const handleVerificationSubmitted = () => {
    setUser((u) => ({ ...u, verificationStatus: "en_attente_review" }));
  };

  // Pendant qu'un livreur attend une décision sur sa vérification, on revérifie
  // périodiquement son statut réel en base, pour éviter qu'il reste bloqué
  // sur un statut périmé après une validation admin.
  useEffect(() => {
    if (!user || user.role !== "livreur" || user.verificationStatus === "verifie") return;

    const interval = setInterval(async () => {
      const fresh = await findUserById(user.id);
      if (fresh && fresh.verification_status !== user.verificationStatus) {
        setUser((u) => ({ ...u, verificationStatus: fresh.verification_status }));
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [user]);

  if (!configLoaded || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.sand }}>
        <p style={{ color: C.inkSoft, fontFamily: FONT_DISPLAY }}>Manhïa…</p>
      </div>
    );
  }

  if (isResetRoute) {
    return (
      <div className="min-h-screen" style={{ background: C.sand }}>
        <div className="max-w-md mx-auto shadow-2xl min-h-screen" style={{ background: C.sand }}>
          <ResetPasswordScreen onDone={() => { window.location.hash = ""; }} />
        </div>
      </div>
    );
  }

  if (paymentCourseId) {
    return (
      <div className="min-h-screen" style={{ background: C.sand }}>
        <div className="max-w-md mx-auto shadow-2xl min-h-screen" style={{ background: C.sand }}>
          <PaymentScreen courseId={paymentCourseId} />
        </div>
      </div>
    );
  }

  if (isAdminRoute) {
    return (
      <div className="min-h-screen" style={{ background: C.sand }}>
        <div className="max-w-md mx-auto shadow-2xl min-h-screen" style={{ background: C.sand }}>
          <AdminPage />
        </div>
      </div>
    );
  }

  const livreurNeedsVerification =
    user && user.role === "livreur" && user.verificationStatus !== "verifie";

  const isBlocked = user && isUserBlocked({
    blocked_permanently: user.blockedPermanently,
    blocked_until: user.blockedUntil,
  });

  return (
    <div className="min-h-screen" style={{ background: C.sand }}>
      <div className="max-w-md mx-auto shadow-2xl min-h-screen" style={{ background: C.sand }}>
        {!user ? (
          <AuthScreen onAuth={handleAuth} />
        ) : isBlocked ? (
          <BlockedScreen user={user} onLogout={handleLogout} />
        ) : user.role === "client" ? (
          <ClientApp user={user} onLogout={handleLogout} />
        ) : livreurNeedsVerification ? (
          <LivreurVerificationScreen
            user={user}
            status={user.verificationStatus === "en_attente" ? "form" : user.verificationStatus}
            onSubmitted={handleVerificationSubmitted}
            onLogout={handleLogout}
          />
        ) : (
          <LivreurApp user={user} onLogout={handleLogout} />
        )}
      </div>
    </div>
  );
}
