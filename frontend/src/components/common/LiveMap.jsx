import React, { useEffect, useRef, useState, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, Layers, Navigation } from "lucide-react";

// Fix default Leaflet icon paths in case bundler fails to resolve them
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Custom Leaflet Icons
const createEmergencyIcon = (priority = "MEDIUM") => {
  const color = 
    priority === "CRITICAL" ? "#ef4444" :
    priority === "HIGH" ? "#f97316" :
    priority === "MEDIUM" ? "#eab308" : "#10b981";

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" width="34" height="34">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
    </svg>`;
  return L.divIcon({
    html: `<div style="display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.6));transform:translate(-50%,-100%);position:relative;">${svg}</div>`,
    className: "custom-emergency-icon",
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -34]
  });
};

const ambulanceIcon = L.divIcon({
  html: `<div style="background:#2563eb;color:white;padding:6px;border-radius:50%;border:2.5px solid white;box-shadow:0 0 14px rgba(37,99,235,0.9);display:flex;align-items:center;justify-content:center;font-size:16px;width:34px;height:34px;transform:translate(-50%,-50%);">🚑</div>`,
  className: "custom-ambulance-icon",
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -17]
});

const hospitalIcon = L.divIcon({
  html: `<div style="background:#9333ea;color:white;padding:6px;border-radius:50%;border:2.5px solid white;box-shadow:0 0 14px rgba(147,51,234,0.9);display:flex;align-items:center;justify-content:center;font-size:16px;width:34px;height:34px;transform:translate(-50%,-50%);">🏥</div>`,
  className: "custom-hospital-icon",
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -17]
});

// Controller component to safely manage view without fighting user pan/zoom
function MapController({ targetCenter, targetBounds, selectedId, triggerRecenter }) {
  const map = useMap();
  const prevSelectedIdRef = useRef(null);
  const initialFitDoneRef = useRef(false);

  // Resize invalidation so tiles never load broken
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);
    return () => clearTimeout(timer);
  }, [map]);

  // Initial fit to bounds or target center ONCE
  useEffect(() => {
    if (!initialFitDoneRef.current) {
      if (targetBounds && targetBounds.isValid()) {
        map.fitBounds(targetBounds, { padding: [50, 50], maxZoom: 15 });
        initialFitDoneRef.current = true;
      } else if (targetCenter) {
        map.setView(targetCenter, 13);
        initialFitDoneRef.current = true;
      }
    }
  }, [map, targetBounds, targetCenter]);

  // When selected emergency changes explicitly, smoothly fly to it
  useEffect(() => {
    if (selectedId && selectedId !== prevSelectedIdRef.current) {
      prevSelectedIdRef.current = selectedId;
      if (targetCenter) {
        map.flyTo(targetCenter, 14, { duration: 1.2 });
      }
    }
  }, [selectedId, targetCenter, map]);

  // Triggered manually by the user clicking the "Recenter" button
  useEffect(() => {
    if (triggerRecenter > 0) {
      if (targetBounds && targetBounds.isValid()) {
        map.fitBounds(targetBounds, { padding: [50, 50], maxZoom: 15 });
      } else if (targetCenter) {
        map.flyTo(targetCenter, 14, { duration: 1.0 });
      }
    }
  }, [triggerRecenter, map, targetBounds, targetCenter]);

  return null;
}

export const LiveMap = ({
  emergencies = [],
  ambulances = [],
  hospitals = [],
  selectedEmergency = null,
  height = "450px",
  centerLat = null,
  centerLng = null
}) => {
  const [recenterCount, setRecenterCount] = useState(0);

  // Calculate target center based on priority
  const targetCenter = useMemo(() => {
    if (selectedEmergency && selectedEmergency.latitude != null && selectedEmergency.longitude != null) {
      return [selectedEmergency.latitude, selectedEmergency.longitude];
    }
    if (centerLat != null && centerLng != null) {
      return [centerLat, centerLng];
    }
    const firstEm = emergencies.find(e => e.latitude != null && e.longitude != null);
    if (firstEm) return [firstEm.latitude, firstEm.longitude];

    const firstAmb = ambulances.find(a => a.latitude != null && a.longitude != null);
    if (firstAmb) return [firstAmb.latitude, firstAmb.longitude];

    const firstHosp = hospitals.find(h => h.latitude != null && h.longitude != null);
    if (firstHosp) return [firstHosp.latitude, firstHosp.longitude];

    // Standard neutral world fallback (never hardcoded city)
    return [0, 0];
  }, [selectedEmergency, centerLat, centerLng, emergencies, ambulances, hospitals]);

  // Compute LatLng bounds for all active items
  const bounds = useMemo(() => {
    const validCoords = [];

    emergencies.forEach(e => {
      if (e.latitude != null && e.longitude != null) validCoords.push([e.latitude, e.longitude]);
    });
    ambulances.forEach(a => {
      if (a.latitude != null && a.longitude != null) validCoords.push([a.latitude, a.longitude]);
    });
    hospitals.forEach(h => {
      if (h.latitude != null && h.longitude != null) validCoords.push([h.latitude, h.longitude]);
    });

    if (validCoords.length > 0) {
      return L.latLngBounds(validCoords);
    }
    return null;
  }, [emergencies, ambulances, hospitals]);

  // Build active routing path if emergency is selected and assigned to an ambulance
  const routeCoordinates = useMemo(() => {
    if (!selectedEmergency) return [];
    const coords = [];
    const assignedAmb = ambulances.find(a => a.id === selectedEmergency.assigned_ambulance_id);
    const targetHosp = hospitals.find(h => h.id === selectedEmergency.target_hospital_id);

    if (assignedAmb && assignedAmb.latitude != null && assignedAmb.longitude != null) {
      coords.push([assignedAmb.latitude, assignedAmb.longitude]);
    }
    if (selectedEmergency.latitude != null && selectedEmergency.longitude != null) {
      coords.push([selectedEmergency.latitude, selectedEmergency.longitude]);
    }
    if (targetHosp && targetHosp.latitude != null && targetHosp.longitude != null) {
      coords.push([targetHosp.latitude, targetHosp.longitude]);
    }
    return coords;
  }, [selectedEmergency, ambulances, hospitals]);

  const getPriorityColor = (priority) => {
    switch (priority) {
      case "CRITICAL": return "#ef4444";
      case "HIGH": return "#f97316";
      case "MEDIUM": return "#eab308";
      default: return "#10b981";
    }
  };

  return (
    <div className="relative rounded-2xl overflow-hidden border border-slate-800 shadow-xl z-0 isolate" style={{ height }}>
      <MapContainer
        center={targetCenter}
        zoom={targetCenter[0] === 0 && targetCenter[1] === 0 ? 2 : 13}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%", background: "#090d16" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          maxZoom={19}
        />

        <MapController
          targetCenter={targetCenter}
          targetBounds={bounds}
          selectedId={selectedEmergency?.id}
          triggerRecenter={recenterCount}
        />

        {/* Emergencies */}
        {emergencies.map((e) => {
          if (e.latitude == null || e.longitude == null) return null;
          return (
            <Marker
              key={`emergency-${e.id}`}
              position={[e.latitude, e.longitude]}
              icon={createEmergencyIcon(e.priority)}
            >
              <Popup className="custom-popup">
                <div className="p-1 text-slate-900 font-sans">
                  <div className="font-bold text-sm flex items-center gap-1.5 flex-wrap">
                    <span>🚨 {e.client_generated_id || `Emergency #${e.id}`}</span>
                    <span
                      className="px-1.5 py-0.5 text-[10px] rounded text-white font-bold uppercase"
                      style={{ background: getPriorityColor(e.priority) }}
                    >
                      {e.priority || "MEDIUM"}
                    </span>
                    {e.is_guest && (
                      <span className="px-1.5 py-0.5 text-[9px] rounded bg-amber-400 text-slate-950 font-black">
                        GUEST SOS
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-semibold mt-1">{e.emergency_type}</div>
                  <div className="text-xs text-slate-600">{e.address}</div>
                  {e.caller_phone && <div className="text-[11px] text-slate-700 font-mono">Phone: {e.caller_phone}</div>}
                  {e.symptoms && <div className="text-[11px] mt-1 italic text-slate-500">{e.symptoms}</div>}
                  <div className="text-[10px] text-slate-500 font-mono mt-1 pt-1 border-t border-slate-200 flex justify-between">
                    <span>Lat: {e.latitude.toFixed(5)}, Lng: {e.longitude.toFixed(5)}</span>
                    {e.accuracy && <span>±{e.accuracy}m</span>}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Ambulances with smooth real-time position updates */}
        {ambulances.map((amb) => {
          if (amb.latitude == null || amb.longitude == null) return null;
          return (
            <Marker
              key={`amb-${amb.id}`}
              position={[amb.latitude, amb.longitude]}
              icon={ambulanceIcon}
            >
              <Tooltip direction="top" offset={[0, -20]} opacity={0.9} permanent={false}>
                <span className="font-bold text-xs">{amb.callsign}</span> ({amb.status})
              </Tooltip>
              <Popup>
                <div className="p-1 text-slate-900">
                  <div className="font-bold text-sm flex items-center gap-1">
                    <span>🚑 {amb.callsign}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-800 font-bold rounded">
                      {amb.type}
                    </span>
                  </div>
                  <div className="text-xs text-slate-700 font-medium mt-1">Paramedic: {amb.driver_name}</div>
                  <div className="text-xs text-slate-600">
                    Status: <strong className="text-blue-700 uppercase">{amb.status}</strong>
                  </div>
                  {amb.driver_phone && <div className="text-xs text-slate-500">Phone: {amb.driver_phone}</div>}
                  <div className="text-[10px] text-slate-400 font-mono mt-1 pt-1 border-t border-slate-200">
                    Telemetry: {amb.latitude.toFixed(5)}, {amb.longitude.toFixed(5)}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Hospitals */}
        {hospitals.map((hosp) => {
          if (hosp.latitude == null || hosp.longitude == null) return null;
          return (
            <Marker
              key={`hosp-${hosp.id}`}
              position={[hosp.latitude, hosp.longitude]}
              icon={hospitalIcon}
            >
              <Popup>
                <div className="p-1 text-slate-900">
                  <div className="font-bold text-sm">🏥 {hosp.name}</div>
                  <div className="text-xs text-slate-700">{hosp.address}</div>
                  <div className="text-xs font-semibold mt-1">
                    ER Beds: <span className="text-emerald-600 font-bold">{hosp.available_er_beds}</span> / {hosp.total_er_beds} | 
                    ICU: <span className="text-purple-600 font-bold">{hosp.available_icu_beds}</span> / {hosp.total_icu_beds}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">Status: <strong>{hosp.er_status}</strong></div>
                  <div className="text-[10px] text-slate-400 font-mono mt-1 pt-1 border-t border-slate-200">
                    Lat: {hosp.latitude.toFixed(5)}, Lng: {hosp.longitude.toFixed(5)}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Route Polyline connecting Ambulance -> Emergency -> Hospital */}
        {routeCoordinates.length > 1 && (
          <Polyline
            positions={routeCoordinates}
            pathOptions={{ color: "#38bdf8", weight: 4, dashArray: "6, 8", opacity: 0.85 }}
          />
        )}
      </MapContainer>

      {/* Recenter & Fit Controls Overlay */}
      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setRecenterCount(c => c + 1)}
          className="p-2 bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-700 rounded-xl shadow-lg transition cursor-pointer backdrop-blur-md flex items-center gap-1.5 text-xs font-semibold"
          title="Recenter and Fit View"
        >
          <Crosshair className="w-4 h-4 text-emerald-400" />
          <span className="hidden sm:inline">Recenter Map</span>
        </button>
      </div>

      {/* Map Legend Overlay */}
      <div className="absolute bottom-3 left-3 z-[1000] bg-slate-900/90 backdrop-blur-md border border-slate-800 p-2.5 rounded-xl shadow-lg text-[11px] text-slate-300 space-y-1">
        <div className="font-bold text-slate-200 border-b border-slate-800 pb-1 mb-1">Live Map Legend</div>
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping inline-block" />
          <span>Emergency Incident</span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
          <span>Active Ambulance</span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-purple-500 inline-block" />
          <span>Receiving Hospital</span>
        </div>
      </div>
    </div>
  );
};

