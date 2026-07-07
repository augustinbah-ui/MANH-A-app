import React, { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import { Search, X, Crosshair, Check, MapPin } from "lucide-react";

/* ===========================================================
   LocationPicker — sélection de lieu sur carte OpenStreetMap
   + recherche d'adresse (Nominatim, gratuit)
=========================================================== */

// Centre par défaut par pays. Bénin reste la valeur historique (Cotonou),
// utilisée telle quelle tant que le multi-pays n'est pas activé.
const COUNTRY_CENTERS = {
  benin: [6.3703, 2.3912],       // Cotonou
  togo: [6.1319, 1.2228],        // Lomé
  cote_ivoire: [5.3600, -4.0083], // Abidjan
};

const COUNTRY_CITY_HINT = {
  benin: "Cotonou, Bénin",
  togo: "Lomé, Togo",
  cote_ivoire: "Abidjan, Côte d'Ivoire",
};

const COUNTRY_NOMINATIM_CODE = {
  benin: "bj",
  togo: "tg",
  cote_ivoire: "ci",
};

// Conservé pour compatibilité : ancien nom utilisé ailleurs dans le code existant.
const COTONOU_CENTER = COUNTRY_CENTERS.benin;

// Icônes de marqueur colorées (départ / arrivée / arrêt)
function makeIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 26px; height: 26px; border-radius: 50%;
      background: ${color}; border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    "></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

const ICONS = {
  depart: makeIcon("#1F5D50"),
  arrivee: makeIcon("#C86A3E"),
  arret: makeIcon("#F0B429"),
};

function ClickHandler({ onPick }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function RecenterMap({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) {
      map.flyTo(position, 15, { duration: 0.8 });
    }
  }, [position, map]);
  return null;
}

// Recherche d'adresse via Nominatim (OpenStreetMap), gratuit.
// Le pays détermine à la fois le biais de formulation ("... Cotonou, Bénin")
// et le filtre countrycodes envoyé à Nominatim. Par défaut : Bénin, comme avant.
// referencePosition (optionnel) : {lat, lng} de la position actuelle de l'utilisateur.
// Quand fournie, biaise Nominatim vers cette zone (viewbox) ET trie les résultats
// finaux par distance réelle, pour remonter en premier les lieux les plus proches.
// Cache local des recherches récentes (par session navigateur, en mémoire) — évite
// de re-questionner Nominatim si l'utilisateur retape la même chose ou revient en arrière.
const searchCache = new Map();
const CACHE_MAX_SIZE = 50;

function cacheKey(query, country, referencePosition) {
  const posKey = referencePosition ? `${referencePosition.lat.toFixed(2)},${referencePosition.lng.toFixed(2)}` : "none";
  return `${query.trim().toLowerCase()}|${country}|${posKey}`;
}

async function searchAddress(query, country = "benin", referencePosition = null) {
  if (!query || query.trim().length < 2) return [];

  const key = cacheKey(query, country, referencePosition);
  if (searchCache.has(key)) {
    return searchCache.get(key);
  }

  const cityHint = COUNTRY_CITY_HINT[country] || COUNTRY_CITY_HINT.benin;
  const countryCode = COUNTRY_NOMINATIM_CODE[country] || COUNTRY_NOMINATIM_CODE.benin;
  const cityName = cityHint.split(", ")[0];
  const countryName = cityHint.split(", ")[1] || "Bénin";

  // Zone de biais (~25km autour de la position de référence) pour orienter Nominatim
  // sans exclure totalement les résultats hors zone (bounded=0, juste une préférence).
  let viewboxParam = "";
  if (referencePosition) {
    const delta = 0.25; // environ 25km en degrés à cette latitude
    const left = referencePosition.lng - delta;
    const right = referencePosition.lng + delta;
    const top = referencePosition.lat + delta;
    const bottom = referencePosition.lat - delta;
    viewboxParam = `&viewbox=${left},${top},${right},${bottom}&bounded=0`;
  }

  function applyDistanceSort(results) {
    if (!referencePosition) return results;
    return results
      .map((r) => ({ ...r, _distance: haversineDistance(referencePosition, r) }))
      .sort((a, b) => a._distance - b._distance);
  }

  function storeInCache(results) {
    if (searchCache.size >= CACHE_MAX_SIZE) {
      const firstKey = searchCache.keys().next().value;
      searchCache.delete(firstKey);
    }
    searchCache.set(key, results);
    return results;
  }

  // 1) Requête structurée (city + country + q) : nettement plus précise que le texte
  // libre concaténé pour les petites rues/quartiers, car Nominatim n'a pas à deviner
  // où se termine le nom du lieu et où commence la ville.
  try {
    const structuredUrl = `https://nominatim.openstreetmap.org/search?format=json&city=${encodeURIComponent(
      cityName
    )}&country=${encodeURIComponent(countryName)}&q=${encodeURIComponent(
      query
    )}&limit=8&countrycodes=${countryCode}&addressdetails=1${viewboxParam}`;
    const res = await fetch(structuredUrl, { headers: { "Accept-Language": "fr" } });
    const data = await res.json();
    if (data && data.length > 0) {
      const results = applyDistanceSort(
        data.map((d) => ({ label: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) }))
      );
      return storeInCache(results);
    }
  } catch {
    // passe aux formulations de repli ci-dessous
  }

  // 2) Repli sur les formulations texte libre (comportement précédent), si la
  // requête structurée n'a rien donné (ex: le client tape déjà une adresse complète).
  const attempts = [
    `${query}, ${cityHint}`,
    `${query}, ${countryName}`,
    query,
  ];

  for (const attempt of attempts) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        attempt
      )}&limit=6&countrycodes=${countryCode}&addressdetails=1${viewboxParam}`;
      const res = await fetch(url, {
        headers: { "Accept-Language": "fr" },
      });
      const data = await res.json();
      if (data && data.length > 0) {
        const results = applyDistanceSort(
          data.map((d) => ({ label: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) }))
        );
        return storeInCache(results);
      }
    } catch {
      // essaie la formulation suivante
    }
  }
  return storeInCache([]);
}

// Distance à vol d'oiseau (haversine), en km — approximation raisonnable pour un prototype
export function haversineDistance(a, b) {
  if (!a || !b) return 0;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.sqrt(h));
  // +25% pour approximer une distance routière réelle plutôt qu'à vol d'oiseau
  return dist * 1.25;
}

const C = {
  sand: "#F2E9DC",
  lagoon: "#1F5D50",
  clay: "#C86A3E",
  zem: "#F0B429",
  ink: "#22201B",
  inkSoft: "#5B564C",
  line: "#D8CBB0",
  white: "#FFFDF9",
};
const FONT_DISPLAY = "'Space Grotesk', sans-serif";
const FONT_BODY = "'Inter', sans-serif";

/**
 * LocationPickerModal
 * props:
 *  - label: texte affiché en haut ("Point de départ", "Arrêt 2"...)
 *  - color: couleur du marqueur ("depart" | "arrivee" | "arret")
 *  - initialPosition: {lat, lng} optionnel
 *  - country: "benin" | "togo" | "cote_ivoire" — détermine le centre de carte par
 *    défaut et le biais de recherche d'adresse. Optionnel, "benin" par défaut
 *    (comportement identique à avant si non fourni).
 *  - onConfirm: (place) => void   où place = {label, lat, lng}
 *  - onClose: () => void
 */
export default function LocationPickerModal({ label, color = "depart", initialPosition, onConfirm, onClose, favorites = [], onSaveFavorite, country = "benin" }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [selected, setSelected] = useState(initialPosition || null);
  const [addressLabel, setAddressLabel] = useState(initialPosition?.label || "");
  const [showSaveFavorite, setShowSaveFavorite] = useState(false);
  const [favoriteName, setFavoriteName] = useState("");
  const [myCurrentPosition, setMyCurrentPosition] = useState(null);
  const debounceRef = useRef(null);

  const mapCenter = COUNTRY_CENTERS[country] || COUNTRY_CENTERS.benin;

  // Récupère silencieusement la position de l'utilisateur dès l'ouverture du picker,
  // uniquement pour trier/biaiser les résultats de recherche par proximité — n'affecte
  // jamais le point sélectionné (initialPosition reste inchangé, pas d'auto-sélection).
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setMyCurrentPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        // échec silencieux : la recherche fonctionne quand même, juste sans tri par proximité
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  }, []);

  const handleSearchChange = (value) => {
    setQuery(value);
    setNoResults(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (value.trim().length < 2) {
        setResults([]);
        return;
      }
      setSearching(true);
      const r = await searchAddress(value, country, myCurrentPosition);
      setResults(r);
      setNoResults(r.length === 0);
      setSearching(false);
    }, 300);
  };

  const pickResult = (r) => {
    setSelected({ lat: r.lat, lng: r.lng });
    setAddressLabel(r.label);
    setResults([]);
    setQuery("");
  };

  const pickOnMap = useCallback((lat, lng) => {
    setSelected({ lat, lng });
    setAddressLabel(`Position sélectionnée (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
  }, []);

  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState("");

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoError("La géolocalisation n'est pas disponible sur cet appareil.");
      return;
    }
    setGeoError("");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setSelected({ lat: latitude, lng: longitude });
        setAddressLabel("Ma position actuelle");
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        if (err.code === 1) {
          setGeoError("Autorisation refusée. Activez la localisation dans les réglages du navigateur, ou choisissez le point sur la carte.");
        } else {
          setGeoError("Impossible de récupérer votre position. Essayez de toucher directement la carte.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const confirm = () => {
    if (!selected) return;
    onConfirm({ label: addressLabel || "Position choisie", lat: selected.lat, lng: selected.lng });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: C.sand }}>
      <div className="px-5 pt-6 pb-4 flex items-center justify-between" style={{ background: C.white, borderBottom: `1px solid ${C.line}` }}>
        <div className="flex items-center gap-3">
          <button onClick={onClose}>
            <X size={20} color={C.ink} />
          </button>
          <h1 className="text-base font-bold" style={{ color: C.ink, fontFamily: FONT_DISPLAY }}>{label}</h1>
        </div>
      </div>

      <div className="px-4 pt-3 pb-2 relative" style={{ background: C.white, zIndex: 1000 }}>
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: C.sand, border: `1px solid ${C.line}` }}>
          <Search size={16} color={C.inkSoft} />
          <input
            value={query}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Rechercher une adresse, un quartier..."
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: C.ink, fontFamily: FONT_BODY }}
          />
          {searching && <span className="text-[10px]" style={{ color: C.inkSoft }}>...</span>}
        </div>

        <button
          onClick={useMyLocation}
          disabled={locating}
          className="w-full flex items-center justify-center gap-2 mt-2 py-2.5 rounded-xl"
          style={{ background: C.lagoon, opacity: locating ? 0.7 : 1 }}
        >
          <Crosshair size={15} color={C.white} />
          <span className="text-xs font-bold" style={{ color: C.white, fontFamily: FONT_DISPLAY }}>
            {locating ? "Localisation en cours..." : "Utiliser ma position actuelle"}
          </span>
        </button>

        {geoError && (
          <p className="text-[11px] mt-1.5 px-1 leading-snug" style={{ color: C.clay, fontFamily: FONT_BODY }}>
            {geoError}
          </p>
        )}

        {favorites.length > 0 && (
          <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
            {favorites.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setSelected({ lat: f.lat, lng: f.lng });
                  setAddressLabel(f.addressLabel);
                }}
                className="shrink-0 px-3 py-2 rounded-xl flex items-center gap-1.5"
                style={{ background: C.white, border: `1px solid ${C.line}` }}
              >
                <MapPin size={12} color={C.clay} />
                <span className="text-xs font-semibold" style={{ color: C.ink, fontFamily: FONT_BODY }}>{f.label}</span>
              </button>
            ))}
          </div>
        )}

        {results.length > 0 && (
          <div className="absolute left-4 right-4 mt-1 rounded-xl shadow-lg overflow-hidden" style={{ background: C.white, border: `1px solid ${C.line}`, zIndex: 1001 }}>
            {results.map((r, i) => (
              <button
                key={i}
                onClick={() => pickResult(r)}
                className="w-full text-left px-3 py-2.5 text-xs flex items-center justify-between gap-2"
                style={{
                  color: C.ink,
                  fontFamily: FONT_BODY,
                  borderTop: i > 0 ? `1px solid ${C.line}` : "none",
                }}
              >
                <span className="flex-1">{r.label}</span>
                {r._distance != null && (
                  <span className="shrink-0 text-[10px] font-semibold" style={{ color: C.inkSoft }}>
                    {r._distance < 1 ? `${Math.round(r._distance * 1000)} m` : `${r._distance.toFixed(1)} km`}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {noResults && !searching && (
          <div className="absolute left-4 right-4 mt-1 rounded-xl shadow-lg p-3" style={{ background: C.white, border: `1px solid ${C.zem}`, zIndex: 1001 }}>
            <p className="text-xs leading-snug" style={{ color: C.ink, fontFamily: FONT_BODY }}>
              Aucune adresse trouvée pour cette recherche. Touchez directement l'endroit sur la carte ci-dessous pour le sélectionner précisément.
            </p>
          </div>
        )}
      </div>

      <div className="flex-1 relative" style={{ zIndex: 1 }}>
        <MapContainer
          center={selected ? [selected.lat, selected.lng] : mapCenter}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onPick={pickOnMap} />
          {selected && (
            <>
              <Marker position={[selected.lat, selected.lng]} icon={ICONS[color] || ICONS.depart} />
              <RecenterMap position={[selected.lat, selected.lng]} />
            </>
          )}
        </MapContainer>

        <button
          onClick={useMyLocation}
          className="absolute bottom-24 right-4 w-11 h-11 rounded-full flex items-center justify-center shadow-lg z-10"
          style={{ background: C.white, border: `1px solid ${C.line}` }}
        >
          <Crosshair size={18} color={C.lagoon} />
        </button>

        <div className="absolute top-3 left-4 right-4 z-10">
          <p className="text-[11px] text-center py-2 px-3 rounded-full shadow" style={{ background: "rgba(255,253,249,0.92)", color: C.inkSoft, fontFamily: FONT_BODY }}>
            Touchez la carte pour choisir un point précisément
          </p>
        </div>
      </div>

      <div className="px-5 py-4" style={{ background: C.white, borderTop: `1px solid ${C.line}` }}>
        {selected && (
          <p className="text-xs mb-3 leading-snug" style={{ color: C.inkSoft, fontFamily: FONT_BODY }}>
            📍 {addressLabel}
          </p>
        )}

        {selected && onSaveFavorite && !showSaveFavorite && (
          <button
            onClick={() => setShowSaveFavorite(true)}
            className="w-full mb-2 py-2 rounded-xl text-xs font-semibold"
            style={{ background: C.sand, color: C.inkSoft, fontFamily: FONT_BODY }}
          >
            + Enregistrer comme adresse favorite
          </button>
        )}

        {showSaveFavorite && (
          <div className="mb-3 flex gap-2">
            <input
              value={favoriteName}
              onChange={(e) => setFavoriteName(e.target.value)}
              placeholder="Ex: Maison, Boutique..."
              className="flex-1 rounded-xl px-3 py-2 text-sm outline-none"
              style={{ background: C.sand, border: `1px solid ${C.line}`, color: C.ink, fontFamily: FONT_BODY }}
            />
            <button
              onClick={() => {
                if (favoriteName.trim()) {
                  onSaveFavorite(favoriteName.trim(), { label: addressLabel, lat: selected.lat, lng: selected.lng });
                  setShowSaveFavorite(false);
                  setFavoriteName("");
                }
              }}
              className="px-4 rounded-xl text-xs font-bold"
              style={{ background: C.lagoon, color: C.white, fontFamily: FONT_DISPLAY }}
            >
              OK
            </button>
          </div>
        )}

        <button
          onClick={confirm}
          disabled={!selected}
          className="w-full py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
          style={{
            background: selected ? C.clay : C.line,
            color: selected ? C.white : C.inkSoft,
            fontFamily: FONT_DISPLAY,
          }}
        >
          <Check size={16} />
          Confirmer ce point
        </button>
      </div>
    </div>
  );
}

/* ===========================================================
   AJOUT (déjà présent dans le fichier depuis le suivi GPS) :
   icône livreur + TrackingMap
=========================================================== */

// Icône spécifique pour le marqueur "livreur en mouvement"
function makeLivreurIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 34px; height: 34px; border-radius: 50%;
      background: #C86A3E; border: 3px solid white;
      box-shadow: 0 3px 10px rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
    ">🛵</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

const LIVREUR_ICON = makeLivreurIcon();

/**
 * TrackingMap — carte en lecture seule montrant :
 *  - le point de départ et d'arrivée de la course (marqueurs fixes)
 *  - la position en direct du livreur (marqueur mobile, recentré automatiquement)
 *
 * props:
 *  - stops: [{lat, lng, label}, ...] (départ, éventuels arrêts, arrivée)
 *  - livreurPosition: {lat, lng} | null
 */
export function TrackingMap({ stops, livreurPosition }) {
  const first = stops[0];
  const last = stops[stops.length - 1];
  const center = livreurPosition
    ? [livreurPosition.lat, livreurPosition.lng]
    : first?.lat
    ? [first.lat, first.lng]
    : COTONOU_CENTER;

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <MapContainer center={center} zoom={14} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {stops.map((s, i) => {
          if (!s?.lat) return null;
          const isFirst = i === 0;
          const isLast = i === stops.length - 1;
          const icon = isFirst ? ICONS.depart : isLast ? ICONS.arrivee : ICONS.arret;
          return <Marker key={i} position={[s.lat, s.lng]} icon={icon} />;
        })}
        {livreurPosition && (
          <>
            <Marker position={[livreurPosition.lat, livreurPosition.lng]} icon={LIVREUR_ICON} />
            <RecenterMap position={[livreurPosition.lat, livreurPosition.lng]} />
          </>
        )}
      </MapContainer>
    </div>
  );
}
