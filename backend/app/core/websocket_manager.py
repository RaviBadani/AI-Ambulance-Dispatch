from typing import List, Dict, Any, Optional, Callable
from fastapi import WebSocket
from datetime import datetime, timezone
import json
import logging
from jose import jwt, JWTError

from app.core.config import settings
from app.db.database import SessionLocal
from app.models.user import User
from app.models.ambulance import Ambulance
from app.models.emergency import Emergency

logger = logging.getLogger("websocket_manager")


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.connection_meta: Dict[WebSocket, Dict[str, Any]] = {}

    async def connect(self, websocket: WebSocket, token: Optional[str] = None):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_meta[websocket] = {
            "user_id": None,
            "role": None,
            "email": None,
            "full_name": None,
            "phone": None,
            "authenticated": False
        }
        if token:
            await self.authenticate_token(websocket, token)

        await websocket.send_text(json.dumps({"type": "CONNECTION_ESTABLISHED"}))
        logger.info(f"WebSocket client connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        if websocket in self.connection_meta:
            del self.connection_meta[websocket]
        logger.info(f"WebSocket client disconnected. Remaining connections: {len(self.active_connections)}")

    async def authenticate_token(self, websocket: WebSocket, token: str) -> bool:
        """Authenticates a connected websocket via JWT token."""
        if not token:
            return False
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            user_id = payload.get("sub")
            if not user_id:
                return False

            with SessionLocal() as db:
                user = db.query(User).filter(User.id == int(user_id)).first()
                if not user:
                    return False

                self.connection_meta[websocket] = {
                    "user_id": user.id,
                    "role": user.role,
                    "email": user.email,
                    "full_name": user.full_name,
                    "phone": user.phone,
                    "authenticated": True
                }
                logger.info(f"WebSocket authenticated user {user.email} (Role: {user.role})")
                return True
        except JWTError as e:
            logger.warning(f"WebSocket token validation failed: {e}")
            return False
        except Exception as e:
            logger.error(f"WebSocket auth exception: {e}")
            return False

    def get_meta(self, websocket: WebSocket) -> Dict[str, Any]:
        return self.connection_meta.get(websocket, {"authenticated": False, "role": None})

    async def broadcast(self, message: Dict[str, Any], filter_fn: Optional[Callable[[Dict[str, Any]], bool]] = None):
        """
        Broadcasts message to connected clients with authorization filtering.
        - DISPATCHER: receives all updates.
        - If filter_fn is provided, decides per-client delivery.
        - Automatically filters AMBULANCE_LOCATION_UPDATED based on role & emergency assignment.
        """
        message_str = json.dumps(message)
        disconnected = []
        msg_type = message.get("type")

        # Context for location updates
        assigned_emergency = None
        target_hospital_id = None
        caller_phone = None
        caller_name = None
        ambulance_driver_user_id = None

        if msg_type in ["AMBULANCE_LOCATION_UPDATED", "location_update"]:
            amb_id = message.get("ambulance_id")
            em_id = message.get("emergency_id")
            try:
                with SessionLocal() as db:
                    if amb_id:
                        amb = db.query(Ambulance).filter(Ambulance.id == amb_id).first()
                        if amb:
                            ambulance_driver_user_id = amb.driver_user_id
                    if em_id:
                        assigned_emergency = db.query(Emergency).filter(Emergency.id == em_id).first()
                    elif amb_id:
                        # find active emergency assigned to this ambulance
                        assigned_emergency = db.query(Emergency).filter(
                            Emergency.assigned_ambulance_id == amb_id,
                            Emergency.status.notin_(["RESOLVED", "CANCELLED"])
                        ).first()

                    if assigned_emergency:
                        target_hospital_id = assigned_emergency.target_hospital_id
                        caller_phone = assigned_emergency.caller_phone
                        caller_name = assigned_emergency.caller_name
            except Exception as e:
                logger.error(f"Error querying emergency context for broadcast: {e}")

        for connection in list(self.active_connections):
            meta = self.get_meta(connection)
            role = meta.get("role")

            # Check if this connection should receive this message
            should_send = True

            if filter_fn is not None:
                should_send = filter_fn(meta)
            elif msg_type in ["AMBULANCE_LOCATION_UPDATED", "location_update"]:
                # Role-based visibility enforcement:
                # 1. DISPATCHER: always receives all ambulance telemetry
                if role == "DISPATCHER":
                    should_send = True
                # 2. DRIVER: receives their own ambulance update
                elif role == "DRIVER":
                    should_send = (
                        ambulance_driver_user_id is not None
                        and meta.get("user_id") == ambulance_driver_user_id
                    )
                # 3. CALLER: only receives if this ambulance is assigned to their active emergency
                elif role == "CALLER":
                    should_send = False
                    if assigned_emergency:
                        # Match phone number or caller name
                        if meta.get("phone") and meta.get("phone") == caller_phone:
                            should_send = True
                        elif meta.get("full_name") and meta.get("full_name") == caller_name:
                            should_send = True
                # 4. HOSPITAL: only receives if assigned emergency targets their hospital
                elif role == "HOSPITAL":
                    should_send = target_hospital_id is not None
                else:
                    # Unauthenticated or unrecognized role does not receive live ambulance telemetry
                    should_send = False

            if should_send:
                try:
                    await connection.send_text(message_str)
                except Exception as e:
                    logger.error(f"Error sending websocket message: {e}")
                    disconnected.append(connection)

        for conn in disconnected:
            self.disconnect(conn)

    async def handle_client_message(self, websocket: WebSocket, raw_text: str):
        """Processes incoming client WebSocket messages."""
        try:
            data = json.loads(raw_text)
        except Exception:
            await websocket.send_json({"type": "ERROR", "message": "Invalid JSON format"})
            return

        msg_type = data.get("type")

        # 1. Heartbeat Ping
        if msg_type == "PING":
            await websocket.send_text(json.dumps({"type": "PONG", "timestamp": datetime.now(timezone.utc).isoformat()}))
            return

        # 2. Explicit Authentication
        if msg_type == "authenticate":
            token = data.get("token")
            success = await self.authenticate_token(websocket, token)
            meta = self.get_meta(websocket)
            await websocket.send_text(json.dumps({
                "type": "AUTH_RESPONSE",
                "authenticated": success,
                "role": meta.get("role"),
                "full_name": meta.get("full_name")
            }))
            return

        # 3. Driver Live Location Update
        if msg_type in ["location_update", "AMBULANCE_LOCATION_UPDATE"]:
            await self._process_location_update(websocket, data)
            return

        # Echo unhandled message
        await websocket.send_text(json.dumps({"type": "ACK", "received_type": msg_type}))

    async def _process_location_update(self, websocket: WebSocket, data: Dict[str, Any]):
        meta = self.get_meta(websocket)

        # Enforce authentication
        if not meta.get("authenticated"):
            await websocket.send_text(json.dumps({
                "type": "ERROR",
                "code": "UNAUTHENTICATED",
                "message": "Authentication required to publish location updates"
            }))
            return

        # Enforce DRIVER or DISPATCHER role
        role = meta.get("role")
        if role not in ["DRIVER", "DISPATCHER"]:
            await websocket.send_text(json.dumps({
                "type": "ERROR",
                "code": "FORBIDDEN",
                "message": f"Role '{role}' is not authorized to publish ambulance GPS coordinates"
            }))
            return

        # Validate coordinates
        latitude = data.get("latitude")
        longitude = data.get("longitude")
        accuracy = data.get("accuracy", 10)
        emergency_id = data.get("emergency_id")

        if latitude is None or longitude is None:
            await websocket.send_json({
                "type": "ERROR",
                "code": "INVALID_COORDINATES",
                "message": "Both latitude and longitude are required"
            })
            return

        try:
            lat = float(latitude)
            lng = float(longitude)
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
                raise ValueError("Coordinates out of range")
        except (ValueError, TypeError):
            await websocket.send_json({
                "type": "ERROR",
                "code": "INVALID_COORDINATES",
                "message": "Latitude must be between -90 and 90, longitude between -180 and 180"
            })
            return

        with SessionLocal() as db:
            user_id = meta.get("user_id")

            # Resolve driver's ambulance
            amb = None
            if role == "DRIVER":
                amb = db.query(Ambulance).filter(Ambulance.driver_user_id == user_id).first()
                if not amb:
                    # Fallback match by driver name
                    amb = db.query(Ambulance).filter(Ambulance.driver_name == meta.get("full_name")).first()
                if not amb and emergency_id:
                    # Check emergency assignment
                    em = db.query(Emergency).filter(Emergency.id == emergency_id).first()
                    if em and em.assigned_ambulance_id:
                        amb = db.query(Ambulance).filter(Ambulance.id == em.assigned_ambulance_id).first()
            elif role == "DISPATCHER":
                # Dispatcher may specify ambulance_id
                target_amb_id = data.get("ambulance_id")
                if target_amb_id:
                    amb = db.query(Ambulance).filter(Ambulance.id == target_amb_id).first()
                else:
                    amb = db.query(Ambulance).first()

            if not amb:
                await websocket.send_text(json.dumps({
                    "type": "ERROR",
                    "code": "AMBULANCE_NOT_FOUND",
                    "message": "No active ambulance assigned to current driver user"
                }))
                return

            # Verify active emergency assignment if emergency_id provided
            if emergency_id:
                em = db.query(Emergency).filter(Emergency.id == emergency_id).first()
                if not em:
                    await websocket.send_text(json.dumps({
                        "type": "ERROR",
                        "code": "EMERGENCY_NOT_FOUND",
                        "message": f"Emergency #{emergency_id} does not exist"
                    }))
                    return

                if em.assigned_ambulance_id != amb.id and role != "DISPATCHER":
                    await websocket.send_text(json.dumps({
                        "type": "ERROR",
                        "code": "UNAUTHORIZED_EMERGENCY",
                        "message": f"Ambulance {amb.callsign} is not assigned to Emergency #{emergency_id}"
                    }))
                    return

            # Update ambulance in database
            now = datetime.now(timezone.utc)
            amb.latitude = lat
            amb.longitude = lng
            amb.last_updated = now
            db.commit()
            db.refresh(amb)

            broadcast_payload = {
                "type": "AMBULANCE_LOCATION_UPDATED",
                "ambulance_id": amb.id,
                "callsign": amb.callsign,
                "latitude": amb.latitude,
                "longitude": amb.longitude,
                "accuracy": accuracy,
                "emergency_id": emergency_id,
                "status": amb.status,
                "timestamp": now.isoformat()
            }

        # Acknowledge to driver
        await websocket.send_text(json.dumps({
            "type": "LOCATION_ACK",
            "ambulance_id": broadcast_payload["ambulance_id"],
            "callsign": broadcast_payload["callsign"],
            "latitude": broadcast_payload["latitude"],
            "longitude": broadcast_payload["longitude"],
            "timestamp": broadcast_payload["timestamp"]
        }))

        # Broadcast to authorized recipients
        await self.broadcast(broadcast_payload)


ws_manager = ConnectionManager()

