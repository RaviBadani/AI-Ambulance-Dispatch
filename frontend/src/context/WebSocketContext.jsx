import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "./AuthContext";

const WebSocketContext = createContext(null);

export const WebSocketProvider = ({ children }) => {
  const { token, user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("disconnected"); // 'connected' | 'reconnecting' | 'disconnected'
  const [lastMessage, setLastMessage] = useState(null);
  const [notifications, setNotifications] = useState([]);

  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const isExplicitlyClosedRef = useRef(false);

  const getWsUrl = useCallback(() => {
    if (import.meta.env.VITE_WS_URL) {
      const explicitUrl = import.meta.env.VITE_WS_URL;
      const currentToken = localStorage.getItem("token") || token;
      return currentToken ? `${explicitUrl}?token=${encodeURIComponent(currentToken)}` : explicitUrl;
    }

    if (typeof window !== "undefined") {
      const isSecure = window.location.protocol === "https:";
      const wsProtocol = isSecure ? "wss:" : "ws:";
      const host = window.location.host;
      const currentToken = localStorage.getItem("token") || token;
      const query = currentToken ? `?token=${encodeURIComponent(currentToken)}` : "";
      return `${wsProtocol}//${host}/ws${query}`;
    }

    return "ws://localhost:8000/ws";
  }, [token]);

  const connectWS = useCallback(() => {
    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Clean up previous socket if open or connecting
    if (socketRef.current) {
      try {
        socketRef.current.onclose = null;
        socketRef.current.onerror = null;
        socketRef.current.close(1000, "Reconnecting");
      } catch (e) {
        // ignore
      }
    }

    isExplicitlyClosedRef.current = false;
    setConnectionStatus(reconnectAttemptsRef.current === 0 ? "reconnecting" : "reconnecting");

    try {
      const url = getWsUrl();
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionStatus("connected");
        reconnectAttemptsRef.current = 0;
        setSocket(ws);
        console.log("🟢 WebSocket connected to dispatch platform:", url);

        // Also send explicit authentication payload
        const currentToken = localStorage.getItem("token") || token;
        if (currentToken) {
          try {
            ws.send(JSON.stringify({ type: "authenticate", token: currentToken }));
          } catch (e) {
            console.error("Error sending WS auth frame", e);
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastMessage(data);

          if (data.type && data.type !== "PONG" && data.type !== "ACK" && data.type !== "LOCATION_ACK") {
            const newNotification = {
              id: Date.now() + Math.random(),
              type: data.type,
              text: formatNotificationText(data),
              timestamp: new Date().toLocaleTimeString(),
            };
            setNotifications((prev) => [newNotification, ...prev.slice(0, 19)]);
          }
        } catch (e) {
          console.error("Error parsing websocket message", e);
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        setSocket(null);

        if (isExplicitlyClosedRef.current || event.code === 1000) {
          setConnectionStatus("disconnected");
          return;
        }

        setConnectionStatus("reconnecting");
        // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
        const attempt = reconnectAttemptsRef.current;
        const delay = Math.min(1000 * Math.pow(1.5, attempt), 15000);
        reconnectAttemptsRef.current += 1;

        console.log(`🟡 WebSocket disconnected. Reconnecting in ${(delay / 1000).toFixed(1)}s (Attempt ${reconnectAttemptsRef.current})...`);
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWS();
        }, delay);
      };

      ws.onerror = (err) => {
        console.warn("WebSocket transport error:", err);
        try {
          ws.close();
        } catch (e) {
          // ignore
        }
      };
    } catch (e) {
      console.error("Failed to initialize WebSocket connection:", e);
      setConnectionStatus("disconnected");
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWS();
      }, 3000);
    }
  }, [getWsUrl, token]);

  // Connect on mount and whenever token/user identity changes
  useEffect(() => {
    reconnectAttemptsRef.current = 0;
    connectWS();

    return () => {
      isExplicitlyClosedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (socketRef.current) {
        try {
          socketRef.current.close(1000, "Component unmounted");
        } catch (e) {
          // ignore
        }
      }
    };
  }, [connectWS]);

  const sendMessage = useCallback((message) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const payload = typeof message === "string" ? message : JSON.stringify(message);
      socketRef.current.send(payload);
      return true;
    }
    return false;
  }, []);

  const formatNotificationText = (msg) => {
    switch (msg.type) {
      case "EMERGENCY_CREATED":
        return `🚨 New ${msg.priority} Emergency: ${msg.emergency_type} at ${msg.address}`;
      case "EMERGENCY_STATUS_UPDATED":
        return `⚡ Emergency #${msg.emergency_id} status changed to ${msg.new_status}`;
      case "DISPATCH_OVERRIDE_EXECUTED":
        return `🛡️ Dispatcher assigned ${msg.ambulance_callsign} to Emergency #${msg.emergency_id}`;
      case "AMBULANCE_STATUS_CHANGED":
        return `🚑 ${msg.callsign} status changed to ${msg.status}`;
      case "AMBULANCE_LOCATION_UPDATED":
        return `📍 ${msg.callsign} updated GPS location (${msg.latitude?.toFixed(4)}, ${msg.longitude?.toFixed(4)})`;
      case "HOSPITAL_CAPACITY_UPDATED":
        return `🏥 ${msg.name} updated ER capacity: ${msg.available_er_beds} beds free (${msg.er_status})`;
      default:
        return `System Event: ${msg.type}`;
    }
  };

  const clearNotifications = () => setNotifications([]);

  return (
    <WebSocketContext.Provider
      value={{
        socket,
        isConnected,
        connectionStatus,
        lastMessage,
        notifications,
        clearNotifications,
        sendMessage
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => useContext(WebSocketContext);

