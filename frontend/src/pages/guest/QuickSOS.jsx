import React, { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Siren,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
  Car,
  Heart,
  Flame,
  HelpCircle,
  Users,
  Phone,
  FileText,
  Loader2,
  RefreshCw,
  ArrowLeft,
  Truck,
  ShieldAlert,
  Send
} from "lucide-react";
import { api } from "../../services/api";
import {
  generateClientEmergencyId,
  enqueueEmergency,
  getEmergency,
  syncOfflineQueue,
  subscribeToOfflineQueue
} from "../../services/offlineQueue";

const EMERGENCY_TYPES = [
  { id: "ACCIDENT", label: "Accident", icon: Car, color: "text-amber-400 border-amber-500/30 bg-amber-500/10" },
  { id: "MEDICAL", label: "Medical", icon: Heart, color: "text-rose-400 border-rose-500/30 bg-rose-500/10" },
  { id: "FIRE", label: "Fire", icon: Flame, color: "text-orange-400 border-orange-500/30 bg-orange-500/10" },
  { id: "OTHER", label: "Other", icon: HelpCircle, color: "text-blue-400 border-blue-500/30 bg-blue-500/10" },
];

export const QuickSOS = () => {
  const [searchParams] = useSearchParams();
  const existingSosId = searchParams.get("id");

  // Form State
  const [emergencyType, setEmergencyType] = useState("ACCIDENT");
  const [peopleAffected, setPeopleAffected] = useState(1);
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");

  // Location State
  const [locationStatus, setLocationStatus] = useState("detecting"); // detecting | detected | unavailable | denied
  const [coords, setCoords] = useState(null); // { latitude, longitude, accuracy, timestamp }
  const [locationError, setLocationError] = useState("");

  // Network & Submission State
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [submitting, setSubmitting] = useState(false);
  const [submittedSos, setSubmittedSos] = useState(null);
  const [serverEmergency, setServerEmergency] = useState(null);
  const [statusCheckInterval, setStatusCheckInterval] = useState(null);

  const geoWatchIdRef = useRef(null);

  // 1. Monitor Browser Network Connectivity
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncOfflineQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // 2. Real Browser GPS Detection
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationStatus("unavailable");
      setLocationError("Geolocation is not supported by your browser/device.");
      return;
    }

    setLocationStatus("detecting");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          accuracy: Math.round(pos.coords.accuracy),
          timestamp: new Date(pos.timestamp).toISOString(),
        });
        setLocationStatus("detected");
        setLocationError("");
      },
      (err) => {
        console.warn("Geolocation initial fix error:", err.message);
        if (err.code === 1) {
          setLocationStatus("denied");
          setLocationError("Location permission denied. SOS can still be submitted.");
        } else {
          setLocationStatus("unavailable");
          setLocationError("Location unavailable. SOS can still be submitted.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 15000,
      }
    );

    // Optional continuous watch
    geoWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setCoords({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          accuracy: Math.round(pos.coords.accuracy),
          timestamp: new Date(pos.timestamp).toISOString(),
        });
        setLocationStatus("detected");
      },
      (err) => {
        // keep previous coordinates if watch errors out
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 }
    );

    return () => {
      if (geoWatchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
      }
    };
  }, []);

  // 3. Subscribe to IndexedDB Offline Queue Sync Updates
  useEffect(() => {
    const unsubscribe = subscribeToOfflineQueue((action, data) => {
      if (action === "SYNC_SUCCESS" && data?.client_generated_id) {
        if (submittedSos?.client_generated_id === data.client_generated_id) {
          setSubmittedSos((prev) => ({
            ...prev,
            sync_status: "SYNCED",
            serverResponse: data.response,
          }));
          setServerEmergency(data.response);
        }
      }
    });

    return () => unsubscribe();
  }, [submittedSos]);

  // 4. If URL contains an existing SOS ID, load from IndexedDB or Backend
  useEffect(() => {
    if (existingSosId) {
      loadExistingSos(existingSosId);
    }
  }, [existingSosId]);

  const loadExistingSos = async (sosId) => {
    try {
      const localItem = await getEmergency(sosId);
      if (localItem) {
        setSubmittedSos(localItem);
        if (localItem.serverResponse) {
          setServerEmergency(localItem.serverResponse);
        }
      }

      if (navigator.onLine) {
        try {
          const remote = await api.getGuestEmergency(sosId);
          if (remote) {
            setServerEmergency(remote);
            if (!submittedSos) {
              setSubmittedSos({
                client_generated_id: sosId,
                sync_status: "SYNCED",
                payload: remote,
                serverResponse: remote,
              });
            }
          }
        } catch (e) {
          console.log("Could not fetch remote status yet:", e.message);
        }
      }
    } catch (e) {
      console.error("Error loading existing SOS:", e);
    }
  };

  // 5. Polling for live status when emergency is synced & online
  useEffect(() => {
    if (submittedSos && isOnline) {
      const interval = setInterval(async () => {
        const idToCheck = submittedSos.client_generated_id;
        try {
          const updated = await api.getGuestEmergency(idToCheck);
          if (updated) {
            setServerEmergency(updated);
          }
        } catch (e) {
          // silent fail on poll
        }
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [submittedSos, isOnline]);

  // 6. Handle SOS Submission
  const handleSubmitSos = async (e) => {
    if (e) e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    const clientGenId = generateClientEmergencyId();

    const payload = {
      client_generated_id: clientGenId,
      emergency_type: emergencyType,
      description: description.trim() || `Quick SOS for ${emergencyType}`,
      people_affected: Number(peopleAffected) || 1,
      phone: phone.trim() || "",
      latitude: coords?.latitude || null,
      longitude: coords?.longitude || null,
      accuracy: coords?.accuracy || null,
      address: coords ? `GPS Fix: ${coords.latitude}, ${coords.longitude}` : "Location unavailable",
    };

    // Store immediately into durable IndexedDB Outbox
    try {
      const queuedEntry = await enqueueEmergency(payload);
      setSubmittedSos(queuedEntry);

      // If online, dispatch immediately to backend
      if (navigator.onLine) {
        try {
          const response = await api.createGuestEmergency(payload);
          setServerEmergency(response);
          // Mark local outbox entry as SYNCED
          queuedEntry.sync_status = "SYNCED";
          queuedEntry.serverResponse = response;
          setSubmittedSos({ ...queuedEntry });
        } catch (networkOrServerError) {
          console.warn("Direct network send failed; remaining in IndexedDB outbox:", networkOrServerError);
          // It remains queued in IndexedDB as PENDING_SYNC/FAILED, and auto-sync will deliver it
        }
      }
    } catch (dbError) {
      console.error("IndexedDB storage failed:", dbError);
    } finally {
      setSubmitting(false);
    }
  };

  // View: Status View if submitted
  if (submittedSos) {
    const isSynced = submittedSos.sync_status === "SYNCED" || !!serverEmergency;
    const currentStatus = serverEmergency?.status || (isSynced ? "PENDING" : "WAITING FOR NETWORK");
    const assignedAmbulance = serverEmergency?.assigned_ambulance;

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 lg:p-8 selection:bg-rose-500 selection:text-white">
        <div className="max-w-xl w-full mx-auto space-y-6">
          {/* Header Bar */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Portal</span>
            </Link>
            <div className="flex items-center gap-2">
              {isOnline ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Wifi className="w-3.5 h-3.5" /> Online
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                  <WifiOff className="w-3.5 h-3.5" /> Offline Mode
                </span>
              )}
            </div>
          </div>

          {/* Status Hero Card */}
          {isSynced ? (
            <div className="bg-gradient-to-br from-emerald-950/60 via-slate-900 to-slate-900 border border-emerald-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-emerald-500/20 rounded-2xl border border-emerald-500/30">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 animate-pulse" />
                </div>
                <div>
                  <h1 className="text-2xl font-black text-white">EMERGENCY RECEIVED</h1>
                  <p className="text-xs text-emerald-400 font-medium mt-0.5">
                    Live Dispatcher & Fleet Notified
                  </p>
                </div>
              </div>

              <div className="bg-slate-950/80 rounded-2xl p-4 border border-slate-800/80 space-y-3 mt-4 text-sm">
                <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                  <span className="text-slate-400 text-xs font-medium">Emergency ID:</span>
                  <span className="font-mono font-bold text-emerald-300">
                    {submittedSos.client_generated_id}
                  </span>
                </div>

                <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                  <span className="text-slate-400 text-xs font-medium">Status:</span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    {currentStatus}
                  </span>
                </div>

                <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                  <span className="text-slate-400 text-xs font-medium">Location:</span>
                  <span className="text-xs font-semibold text-slate-200 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                    {coords ? `${coords.latitude}, ${coords.longitude} (±${coords.accuracy}m)` : "Attached"}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400 text-xs font-medium">Ambulance:</span>
                  {assignedAmbulance ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300">
                      <Truck className="w-3.5 h-3.5" />
                      {assignedAmbulance.callsign} ({assignedAmbulance.status})
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400 italic flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                      Assigning nearest unit...
                    </span>
                  )}
                </div>
              </div>

              {assignedAmbulance && (
                <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
                  <div className="flex items-center gap-2 text-amber-300 text-xs font-bold">
                    <Truck className="w-4 h-4" />
                    <span>Unit En Route: {assignedAmbulance.callsign}</span>
                  </div>
                  {assignedAmbulance.driver_phone && (
                    <p className="text-xs text-slate-300 mt-1">
                      Driver Contact: <span className="font-mono font-semibold">{assignedAmbulance.driver_phone}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-gradient-to-br from-amber-950/60 via-slate-900 to-slate-900 border border-amber-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-amber-500/20 rounded-2xl border border-amber-500/30">
                  <WifiOff className="w-8 h-8 text-amber-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-black text-amber-300">SOS SAVED LOCALLY</h1>
                  <p className="text-xs text-amber-400/90 font-medium mt-0.5">
                    Waiting for network connectivity
                  </p>
                </div>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed">
                No network connection was detected. Your emergency has been safely recorded in durable offline storage on this device and will automatically be transmitted to Dispatch as soon as network returns.
              </p>

              <div className="bg-slate-950/80 rounded-2xl p-4 border border-slate-800/80 space-y-3 mt-4 text-sm">
                <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                  <span className="text-slate-400 text-xs font-medium">Emergency ID:</span>
                  <span className="font-mono font-bold text-amber-300">
                    {submittedSos.client_generated_id}
                  </span>
                </div>

                <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                  <span className="text-slate-400 text-xs font-medium">Status:</span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    WAITING FOR NETWORK
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400 text-xs font-medium">Storage:</span>
                  <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    IndexedDB Durable Outbox
                  </span>
                </div>
              </div>

              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => syncOfflineQueue()}
                  className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 border border-slate-700"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Try Sync Now
                </button>
              </div>
            </div>
          )}

          {/* Action Row */}
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => {
                setSubmittedSos(null);
                setServerEmergency(null);
              }}
              className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-2xl font-bold text-xs transition"
            >
              Send Another SOS
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-[11px] text-slate-400 mt-6">
          RESPONSAI Emergency Coordination System • Real-Time Geolocation & Offline-First Protocol
        </div>
      </div>
    );
  }

  // View: Quick SOS Form
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 lg:p-8 selection:bg-rose-500 selection:text-white">
      <div className="max-w-xl w-full mx-auto space-y-6">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-600/20 border border-rose-500/40 rounded-xl animate-pulse">
              <Siren className="w-6 h-6 text-rose-500" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
                <span>RESPONSAI</span>
                <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-full">
                  Quick SOS
                </span>
              </h1>
              <p className="text-[11px] text-slate-400">
                Direct Emergency Assistance • No Account Required
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isOnline ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Wifi className="w-3.5 h-3.5" /> Online
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <WifiOff className="w-3.5 h-3.5" /> Offline Mode
              </span>
            )}
          </div>
        </div>

        {/* SOS Form Card */}
        <form
          onSubmit={handleSubmitSos}
          className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-6"
        >
          {/* Incident Type Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
              What happened?
            </label>
            <div className="grid grid-cols-2 gap-3">
              {EMERGENCY_TYPES.map((t) => {
                const Icon = t.icon;
                const isSelected = emergencyType === t.id;
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => setEmergencyType(t.id)}
                    className={`flex items-center gap-3 p-4 rounded-2xl border text-left transition-all ${
                      isSelected
                        ? `${t.color} border-2 shadow-lg ring-1 ring-white/10`
                        : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white"
                    }`}
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    <span className="text-sm font-bold">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* People Affected */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              <span>People Affected</span>
            </label>
            <div className="flex items-center gap-3">
              {[1, 2, 3, "4+"].map((cnt) => {
                const numeric = typeof cnt === "number" ? cnt : 5;
                const isSelected = (cnt === "4+" && peopleAffected >= 4) || peopleAffected === cnt;
                return (
                  <button
                    type="button"
                    key={cnt}
                    onClick={() => setPeopleAffected(numeric)}
                    className={`flex-1 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                      isSelected
                        ? "bg-rose-600 text-white border-rose-500 shadow-md"
                        : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white"
                    }`}
                  >
                    {cnt}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Short Description */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span>Short Description</span>
              </span>
              <span className="text-[10px] text-slate-400 font-normal uppercase">Optional</span>
            </label>
            <input
              type="text"
              placeholder="e.g. 2-car collision, unconscious person, smoke..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-rose-500 transition"
              maxLength={200}
            />
          </div>

          {/* Phone Number */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>Phone Number</span>
              </span>
              <span className="text-[10px] text-slate-400 font-normal uppercase">Optional</span>
            </label>
            <input
              type="tel"
              placeholder="Optional contact for dispatcher / driver"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-rose-500 transition"
              maxLength={20}
            />
          </div>

          {/* Real GPS Location Status Banner */}
          <div className="p-4 rounded-2xl border transition-all bg-slate-950/80 border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <MapPin className={`w-4 h-4 ${
                  locationStatus === "detected" ? "text-emerald-400" :
                  locationStatus === "detecting" ? "text-amber-400 animate-pulse" :
                  "text-rose-400"
                }`} />
                <span className="text-xs font-bold text-slate-200">Location Status</span>
              </div>
              <div>
                {locationStatus === "detected" && (
                  <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                    🟢 Location detected
                  </span>
                )}
                {locationStatus === "detecting" && (
                  <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20">
                    <Loader2 className="w-3 h-3 animate-spin" /> Detecting location...
                  </span>
                )}
                {(locationStatus === "unavailable" || locationStatus === "denied") && (
                  <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20">
                    ⚠️ Location unavailable
                  </span>
                )}
              </div>
            </div>

            {coords ? (
              <div className="mt-2 text-[11px] font-mono text-slate-400 flex flex-wrap gap-x-4">
                <span>Lat: {coords.latitude}</span>
                <span>Lng: {coords.longitude}</span>
                <span>Accuracy: ±{coords.accuracy}m</span>
              </div>
            ) : (
              locationError && (
                <p className="mt-2 text-[11px] text-slate-400">
                  {locationError}
                </p>
              )
            )}
          </div>

          {/* Giant SOS Button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-5 bg-gradient-to-r from-rose-600 via-red-600 to-rose-700 hover:from-rose-500 hover:to-red-600 text-white rounded-2xl font-black text-lg tracking-wide uppercase shadow-2xl shadow-rose-900/50 hover:shadow-rose-900/70 border border-rose-500/40 transition-all transform active:scale-[0.98] flex items-center justify-center gap-3 cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>Broadcasting SOS...</span>
              </>
            ) : (
              <>
                <Siren className="w-6 h-6 animate-bounce" />
                <span>🚨 SEND SOS NOW</span>
              </>
            )}
          </button>
        </form>

        {/* Quick Nav to Standard Account Access */}
        <div className="flex items-center justify-between text-xs text-slate-400 px-2">
          <span>Are you a paramedic, hospital staff, or dispatcher?</span>
          <Link
            to="/login"
            className="font-bold text-rose-400 hover:text-rose-300 underline underline-offset-4"
          >
            Sign In Here →
          </Link>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-[11px] text-slate-400 mt-6">
        RESPONSAI Emergency Coordination System • Real-Time Geolocation & Offline-First Protocol
      </div>
    </div>
  );
};
