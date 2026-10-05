import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../../services/api";
import { useWebSocket } from "../../context/WebSocketContext";
import { LiveMap } from "../../components/common/LiveMap";
import { 
  Navigation as NavIcon, 
  Truck, 
  MapPin, 
  Hospital, 
  Play, 
  RotateCcw, 
  Clock, 
  ArrowLeft,
  Compass,
  CheckCircle2,
  AlertTriangle,
  Pause
} from "lucide-react";

export const Navigation = () => {
  const { lastMessage, sendMessage } = useWebSocket();
  const [ambulances, setAmbulances] = useState([]);
  const [selectedAmbulanceId, setSelectedAmbulanceId] = useState(null);
  const [activeEmergency, setActiveEmergency] = useState(null);
  const [hospitals, setHospitals] = useState([]);
  const [isLiveGpsActive, setIsLiveGpsActive] = useState(false);
  const [gpsData, setGpsData] = useState({ latitude: null, longitude: null, accuracy: null });
  const [gpsError, setGpsError] = useState(null);
  const watchIdRef = useRef(null);

  const fetchData = async () => {
    try {
      const [ambData, emergData, hospData] = await Promise.all([
        api.getAmbulances(),
        api.getEmergencies(),
        api.getHospitals()
      ]);

      setAmbulances(ambData);
      setHospitals(hospData);

      const amb = ambData.find(a => a.id === selectedAmbulanceId) || ambData[0];
      if (!selectedAmbulanceId && amb) {
        setSelectedAmbulanceId(amb.id);
      }

      const active = emergData.find(e => 
        (e.assigned_ambulance_id === amb?.id || (!e.assigned_ambulance_id && e.status === "DISPATCHED")) &&
        e.status !== "RESOLVED" && e.status !== "CANCELLED"
      ) || emergData[0] || null;

      setActiveEmergency(active);
    } catch (err) {
      console.error("Navigation data error:", err);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedAmbulanceId]);

  // WebSocket message listener
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === "AMBULANCE_LOCATION_UPDATED") {
      setAmbulances(prev => prev.map(a => a.id === lastMessage.ambulance_id ? {
        ...a,
        latitude: lastMessage.latitude,
        longitude: lastMessage.longitude
      } : a));
    } else if (lastMessage.type === "EMERGENCY_STATUS_UPDATED") {
      setActiveEmergency(prev => {
        if (prev && prev.id === lastMessage.emergency_id) {
          return { ...prev, status: lastMessage.new_status };
        }
        return prev;
      });
    }
  }, [lastMessage]);

  const currentAmbulance = ambulances.find(a => a.id === selectedAmbulanceId) || ambulances[0];
  const targetHospital = hospitals.find(h => h.id === activeEmergency?.target_hospital_id) || hospitals[0];

  // Continuous Real Web GPS Watch
  const startLiveGps = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGpsError("Geolocation is not supported by your browser.");
      return;
    }
    setGpsError(null);

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const acc = Math.round(pos.coords.accuracy);

        setGpsData({ latitude: lat, longitude: lng, accuracy: acc });
        setIsLiveGpsActive(true);

        if (currentAmbulance) {
          setAmbulances(prev => prev.map(a => a.id === currentAmbulance.id ? { ...a, latitude: lat, longitude: lng } : a));
          sendMessage({
            type: "location_update",
            emergency_id: activeEmergency?.id || null,
            ambulance_id: currentAmbulance.id,
            latitude: lat,
            longitude: lng,
            accuracy: acc,
            timestamp: new Date().toISOString()
          });
        }
      },
      (err) => {
        setGpsError(err.message || "Failed to acquire GPS fix.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
    watchIdRef.current = id;
    setIsLiveGpsActive(true);
  }, [currentAmbulance, activeEmergency, sendMessage]);

  const stopLiveGps = useCallback(() => {
    if (watchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsLiveGpsActive(false);
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const handleStepGPS = async () => {
    if (!currentAmbulance || !activeEmergency) return;
    try {
      const isHeadingToHospital = activeEmergency.status === "TRANSPORTING";
      const targetLat = isHeadingToHospital && targetHospital ? targetHospital.latitude : activeEmergency.latitude;
      const targetLng = isHeadingToHospital && targetHospital ? targetHospital.longitude : activeEmergency.longitude;

      const newLat = Number((currentAmbulance.latitude + (targetLat - currentAmbulance.latitude) * 0.35).toFixed(6));
      const newLng = Number((currentAmbulance.longitude + (targetLng - currentAmbulance.longitude) * 0.35).toFixed(6));

      sendMessage({
        type: "location_update",
        emergency_id: activeEmergency.id,
        ambulance_id: currentAmbulance.id,
        latitude: newLat,
        longitude: newLng,
        accuracy: 15,
        timestamp: new Date().toISOString()
      });

      setAmbulances(prev => prev.map(a => a.id === currentAmbulance.id ? { ...a, latitude: newLat, longitude: newLng } : a));
    } catch (err) {
      console.error("GPS update error:", err);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-blue-400 text-xs font-bold uppercase tracking-wider">
            <Compass className="w-4 h-4 animate-spin-slow" />
            <span>Turn-by-Turn GPS HUD</span>
          </div>
          <h1 className="text-2xl font-black text-white mt-0.5">
            Tactical Mission Navigation
          </h1>
          <p className="text-xs text-slate-400">
            Field route guidance linking Ambulance, Emergency Scene, and Receiving Hospital ER.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={isLiveGpsActive ? stopLiveGps : startLiveGps}
            className={`inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold shadow transition cursor-pointer ${
              isLiveGpsActive
                ? "bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400 animate-pulse"
                : "bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/40"
            }`}
          >
            <MapPin className="w-4 h-4" />
            <span>{isLiveGpsActive ? "Live GPS: Active (Stop)" : "Enable Live Location"}</span>
          </button>

          <button
            type="button"
            disabled={isLiveGpsActive}
            onClick={handleStepGPS}
            className={`inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition ${
              isLiveGpsActive
                ? "opacity-40 cursor-not-allowed bg-slate-900 text-slate-500 border-slate-800"
                : "bg-blue-600 hover:bg-blue-500 text-white border-blue-500 cursor-pointer shadow"
            }`}
          >
            <Play className="w-4 h-4" />
            <span>Simulate Move Forward</span>
          </button>

          <Link
            to="/driver/dashboard"
            className="inline-flex items-center space-x-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Dashboard</span>
          </Link>
        </div>
      </div>

      {gpsError && (
        <div className="bg-rose-950/80 border border-rose-500/50 rounded-2xl p-4 text-xs text-rose-200">
          <AlertTriangle className="w-4 h-4 text-rose-400 inline mr-2" />
          <span>{gpsError}</span>
        </div>
      )}

      {/* Main Full-Screen Styled Map */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className={`w-2.5 h-2.5 rounded-full ${isLiveGpsActive ? "bg-emerald-400 animate-ping" : "bg-blue-400"}`}></span>
            <span className="text-xs font-black text-white">{currentAmbulance?.callsign} Live Nav Path</span>
            <span className="text-xs text-slate-400 font-mono hidden sm:inline">
              Mode: {isLiveGpsActive ? "🟢 Real Device GPS" : "⚪ Simulation Standby"} | Lat: {currentAmbulance?.latitude?.toFixed(4)}, Lng: {currentAmbulance?.longitude?.toFixed(4)}
            </span>
          </div>

          <div className="flex items-center space-x-3 text-xs">
            <span className="text-slate-400">Destination:</span>
            <span className="font-bold text-emerald-400">
              {activeEmergency?.status === "TRANSPORTING" ? targetHospital?.name : activeEmergency?.address}
            </span>
          </div>
        </div>

        <div className="h-[580px] w-full">
          <LiveMap
            emergencies={activeEmergency ? [activeEmergency] : []}
            ambulances={currentAmbulance ? [currentAmbulance] : []}
            hospitals={targetHospital ? [targetHospital] : []}
            selectedEmergency={activeEmergency}
            height="580px"
          />
        </div>
      </div>

    </div>
  );
};

