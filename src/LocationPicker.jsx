import React, { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import { Search, X, Crosshair, Check, MapPin } from "lucide-react";

/* ===========================================================
   LocationPicker — sélection de lieu sur carte OpenStreetMap
   + recherche d'adresse (Nominatim, gratuit)
=========================================================== */

// Centre par défaut : Cotonou
const COTONOU_CENTER = [6.3703, 2.3912];

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

// Recherche d'adresse via Nominatim (OpenStreetMap), gratuit, limité à la zone Bénin
async function searchAddress(query) {
  if (!query || query.trim().length < 3) return [];

  // Essaie plusieurs formulations, de la plus précise à la plus large,
  // pour maximiser les chances de trouver un résultat avec Nominatim (gratuit)
  const attempts = [
    `${query}, Cotonou, Bénin`,
    `${query}, Bénin`,
    query,
  ];

  for (const attempt of attempts) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        attempt
      )}&limit=6&countrycodes=bj&addressdetails=1`;
      const res = await fetch(url, {
        headers: { "Accept-Language": "fr" },
      });
      const data = await res.json();
      if (data && data.length > 0) {
        return data.map((d) => ({
          label: d.display_name,
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
        }));
      }
    } catch {
      // essaie la formulation suivante
    }
  }
  return [];
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
 *  - onConfirm: (place) => void   où place = {label, lat, lng}
 *  - onClose: () => void
 */
export default function LocationPickerModal({ label, color = "depart", initialPosition, onConfirm, onClose, favorites = [], onSaveFavorite }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [selected, setSelected] = useState(initialPosition || null);
  const [addressLabel, setAddressLabel] = useState(initialPosition?.label || "");
  const [showSaveFavorite, setShowSaveFavorite] = useState(false);
  const [favoriteName, setFavoriteName] = useState("");
  const debounceRef = useRef(null);

  const handleSearchChange = (value) => {
    setQuery(value);
    setNoResults(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (value.trim().length < 3) {
        setResults([]);
        return;
      }
      setSearching(true);
      const r = await searchAddress(value);
      setResults(r);
      setNoResults(r.length === 0);
      setSearching(false);
    }, 500);
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
                className="w-full text-left px-3 py-2.5 text-xs"
                style={{
                  color: C.ink,
                  fontFamily: FONT_BODY,
                  borderTop: i > 0 ? `1px solid ${C.line}` : "none",
                }}
              >
                {r.label}
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
          center={selected ? [selected.lat, selected.lng] : COTONOU_CENTER}
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
   AJOUT à faire dans LocationPicker.jsx (ne remplace pas le fichier,
   à coller à la fin, après le composant LocationPickerModal existant)
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
