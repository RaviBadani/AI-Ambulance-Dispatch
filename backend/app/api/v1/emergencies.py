from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone
import time

from app.api.deps import get_db, get_current_user, require_roles
from app.models.user import User
from app.models.emergency import Emergency
from app.models.ambulance import Ambulance
from app.models.hospital import Hospital
from app.models.log import DispatchLog
from app.schemas.emergency import (
    EmergencyCreate,
    EmergencyResponse,
    EmergencyStatusUpdate,
    DispatchOverrideRequest,
    GuestEmergencyCreate,
    GuestEmergencyResponse
)
from app.services.ai_classifier import classify_emergency
from app.core.websocket_manager import ws_manager

router = APIRouter()

_guest_rate_limits = {}

def check_guest_rate_limit(client_ip: str, max_requests: int = 30, window_sec: int = 60):
    now = time.time()
    history = _guest_rate_limits.get(client_ip, [])
    # Filter timestamps within window
    history = [t for t in history if now - t < window_sec]
    if len(history) >= max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many emergency requests from this device. Please wait a moment."
        )
    history.append(now)
    _guest_rate_limits[client_ip] = history

@router.post("/guest", response_model=GuestEmergencyResponse)
async def create_guest_emergency(
    req: GuestEmergencyCreate,
    request: Request,
    db: Session = Depends(get_db)
):
    # 1. Validation & Input Sanitization
    client_id = req.client_generated_id.strip()
    if not client_id or len(client_id) < 4:
        raise HTTPException(status_code=400, detail="A valid client_generated_id is required.")

    # 2. Duplicate Protection / Idempotency
    # If this emergency was already received and processed, return existing record
    existing = db.query(Emergency).filter(Emergency.client_generated_id == client_id).first()
    if existing:
        amb_dict = None
        if existing.assigned_ambulance_id:
            amb = db.query(Ambulance).filter(Ambulance.id == existing.assigned_ambulance_id).first()
            if amb:
                amb_dict = {
                    "id": amb.id,
                    "callsign": amb.callsign,
                    "type": amb.type,
                    "driver_name": amb.driver_name,
                    "driver_phone": amb.driver_phone,
                    "latitude": amb.latitude,
                    "longitude": amb.longitude,
                    "status": amb.status
                }
        return GuestEmergencyResponse(
            id=existing.id,
            client_generated_id=existing.client_generated_id,
            is_guest=True,
            emergency_type=existing.emergency_type,
            description=existing.symptoms,
            people_affected=existing.patient_count,
            phone=existing.caller_phone,
            address=existing.address,
            latitude=existing.latitude,
            longitude=existing.longitude,
            accuracy=existing.accuracy,
            priority=existing.priority,
            ai_severity_score=existing.ai_severity_score,
            ai_recommended_type=existing.ai_recommended_type,
            ai_urgency_reason=existing.ai_urgency_reason,
            status=existing.status,
            assigned_ambulance_id=existing.assigned_ambulance_id,
            assigned_ambulance=amb_dict,
            created_at=existing.created_at
        )

    # Rate limiting for new emergency submissions (30 requests/minute per client IP)
    client_ip = request.client.host if request.client else "127.0.0.1"
    check_guest_rate_limit(client_ip)

    # 3. Emergency Type Mapping & Normalization
    type_mapping = {
        "ACCIDENT": "Trauma",
        "accident": "Trauma",
        "MEDICAL": "Cardiac",
        "medical": "Cardiac",
        "FIRE": "Burn",
        "fire": "Burn",
        "OTHER": "Minor",
        "other": "Minor"
    }
    normalized_type = type_mapping.get(req.emergency_type, req.emergency_type)
    if normalized_type not in ["Cardiac", "Stroke", "Trauma", "Respiratory", "Obstetric", "Allergic", "Burn", "Minor"]:
        normalized_type = "Trauma"

    # 4. GPS Coordinates Validation
    lat = req.latitude
    lng = req.longitude
    if lat is not None and lng is not None:
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
            raise HTTPException(status_code=400, detail="Coordinates out of valid range (-90..90, -180..180).")
    else:
        lat = 0.0
        lng = 0.0

    # Address determination
    if req.address and req.address.strip():
        address_str = req.address.strip()
    elif lat != 0.0 or lng != 0.0:
        address_str = f"GPS Fix: {lat:.5f}, {lng:.5f}"
    else:
        address_str = "Location pending / unavailable from device"

    symptoms_str = req.description.strip() if req.description else f"Quick SOS report ({normalized_type})"
    caller_phone_str = req.phone.strip() if req.phone else "Quick SOS (No Phone)"
    caller_name_str = f"Guest SOS #{client_id[-6:]}"

    # 5. AI Severity Triage
    triage = classify_emergency(
        emergency_type=normalized_type,
        symptoms=symptoms_str,
        patient_count=req.people_affected,
        special_requirements=[]
    )

    emergency = Emergency(
        client_generated_id=client_id,
        is_guest=True,
        accuracy=req.accuracy,
        caller_name=caller_name_str,
        caller_phone=caller_phone_str,
        address=address_str,
        latitude=lat,
        longitude=lng,
        emergency_type=normalized_type,
        symptoms=symptoms_str,
        patient_count=req.people_affected,
        special_requirements=[],
        priority=triage["priority"],
        ai_severity_score=triage["ai_severity_score"],
        ai_recommended_type=triage["ai_recommended_type"],
        ai_urgency_reason=triage["ai_urgency_reason"],
        ai_required_equipment=triage.get("ai_required_equipment", []),
        status="PENDING",
        created_at=datetime.now(timezone.utc)
    )

    db.add(emergency)
    db.commit()
    db.refresh(emergency)

    # 6. Audit Trail Logging
    log = DispatchLog(
        emergency_id=emergency.id,
        action="GUEST_SOS_RECEIVED",
        actor_role="GUEST",
        description=f"Quick SOS received ({client_id}) via offline/guest gateway. AI Triaged as {emergency.priority} (Severity {emergency.ai_severity_score}/100)."
    )
    db.add(log)
    db.commit()

    # 7. Real-Time WebSocket Broadcast to Dispatcher & Fleet
    await ws_manager.broadcast({
        "type": "EMERGENCY_CREATED",
        "emergency_id": emergency.id,
        "client_generated_id": emergency.client_generated_id,
        "is_guest": True,
        "priority": emergency.priority,
        "emergency_type": emergency.emergency_type,
        "caller_name": emergency.caller_name,
        "address": emergency.address,
        "latitude": emergency.latitude,
        "longitude": emergency.longitude
    })

    return GuestEmergencyResponse(
        id=emergency.id,
        client_generated_id=emergency.client_generated_id,
        is_guest=True,
        emergency_type=emergency.emergency_type,
        description=emergency.symptoms,
        people_affected=emergency.patient_count,
        phone=emergency.caller_phone,
        address=emergency.address,
        latitude=emergency.latitude,
        longitude=emergency.longitude,
        accuracy=emergency.accuracy,
        priority=emergency.priority,
        ai_severity_score=emergency.ai_severity_score,
        ai_recommended_type=emergency.ai_recommended_type,
        ai_urgency_reason=emergency.ai_urgency_reason,
        status=emergency.status,
        assigned_ambulance_id=emergency.assigned_ambulance_id,
        assigned_ambulance=None,
        created_at=emergency.created_at
    )

@router.get("/guest/{client_generated_id}", response_model=GuestEmergencyResponse)
def get_guest_emergency(client_generated_id: str, db: Session = Depends(get_db)):
    emergency = db.query(Emergency).filter(Emergency.client_generated_id == client_generated_id).first()
    if not emergency:
        raise HTTPException(status_code=404, detail="Emergency SOS not found.")

    amb_dict = None
    if emergency.assigned_ambulance_id:
        amb = db.query(Ambulance).filter(Ambulance.id == emergency.assigned_ambulance_id).first()
        if amb:
            amb_dict = {
                "id": amb.id,
                "callsign": amb.callsign,
                "type": amb.type,
                "driver_name": amb.driver_name,
                "driver_phone": amb.driver_phone,
                "latitude": amb.latitude,
                "longitude": amb.longitude,
                "status": amb.status
            }

    return GuestEmergencyResponse(
        id=emergency.id,
        client_generated_id=emergency.client_generated_id,
        is_guest=emergency.is_guest or False,
        emergency_type=emergency.emergency_type,
        description=emergency.symptoms,
        people_affected=emergency.patient_count,
        phone=emergency.caller_phone,
        address=emergency.address,
        latitude=emergency.latitude,
        longitude=emergency.longitude,
        accuracy=emergency.accuracy,
        priority=emergency.priority,
        ai_severity_score=emergency.ai_severity_score,
        ai_recommended_type=emergency.ai_recommended_type,
        ai_urgency_reason=emergency.ai_urgency_reason,
        status=emergency.status,
        assigned_ambulance_id=emergency.assigned_ambulance_id,
        assigned_ambulance=amb_dict,
        created_at=emergency.created_at
    )


@router.post("/", response_model=EmergencyResponse)
async def create_emergency_request(
    req: EmergencyCreate,
    db: Session = Depends(get_db)
):
    # Run AI Classification
    triage = classify_emergency(
        emergency_type=req.emergency_type,
        symptoms=req.symptoms,
        patient_count=req.patient_count,
        special_requirements=req.special_requirements
    )

    emergency = Emergency(
        caller_name=req.caller_name,
        caller_phone=req.caller_phone,
        address=req.address,
        latitude=req.latitude,
        longitude=req.longitude,
        emergency_type=req.emergency_type,
        symptoms=req.symptoms,
        patient_count=req.patient_count,
        special_requirements=req.special_requirements,
        priority=triage["priority"],
        ai_severity_score=triage["ai_severity_score"],
        ai_recommended_type=triage["ai_recommended_type"],
        ai_required_equipment=triage["ai_required_equipment"],
        ai_urgency_reason=triage["ai_urgency_reason"],
        status="PENDING",
        created_at=datetime.now(timezone.utc)
    )

    db.add(emergency)
    db.commit()
    db.refresh(emergency)

    # Add log
    log = DispatchLog(
        emergency_id=emergency.id,
        action="AI_TRIAGED",
        actor_role="SYSTEM",
        description=f"AI Triaged emergency #{emergency.id} as {emergency.priority} priority (Score: {emergency.ai_severity_score})."
    )
    db.add(log)
    db.commit()

    # Broadcast real-time websocket event
    await ws_manager.broadcast({
        "type": "EMERGENCY_CREATED",
        "emergency_id": emergency.id,
        "priority": emergency.priority,
        "emergency_type": emergency.emergency_type,
        "caller_name": emergency.caller_name,
        "address": emergency.address,
        "latitude": emergency.latitude,
        "longitude": emergency.longitude
    })

    return emergency

@router.get("/", response_model=List[EmergencyResponse])
def get_emergencies(
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["DISPATCHER", "DRIVER", "HOSPITAL", "CALLER"]))
):
    query = db.query(Emergency)
    if status_filter:
        query = query.filter(Emergency.status == status_filter)
    return query.order_by(Emergency.created_at.desc()).all()

@router.get("/system/logs")
def get_dispatch_logs(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["DISPATCHER"]))
):
    logs = db.query(DispatchLog).order_by(DispatchLog.timestamp.desc()).limit(100).all()
    return [{
        "id": l.id,
        "emergency_id": l.emergency_id,
        "action": l.action,
        "actor_role": l.actor_role,
        "description": l.description,
        "timestamp": l.timestamp.isoformat() if l.timestamp else None,
        "created_at": l.timestamp.isoformat() if l.timestamp else None
    } for l in logs]

@router.get("/{emergency_id}", response_model=EmergencyResponse)
def get_emergency_detail(
    emergency_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["DISPATCHER", "DRIVER", "HOSPITAL", "CALLER"]))
):
    emergency = db.query(Emergency).filter(Emergency.id == emergency_id).first()
    if not emergency:
        raise HTTPException(status_code=404, detail="Emergency request not found")
    return emergency

@router.patch("/{emergency_id}/status", response_model=EmergencyResponse)
async def update_emergency_status(
    emergency_id: int,
    update: EmergencyStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["DRIVER", "HOSPITAL", "DISPATCHER"]))
):
    emergency = db.query(Emergency).filter(Emergency.id == emergency_id).first()
    if not emergency:
        raise HTTPException(status_code=404, detail="Emergency request not found")

    old_status = emergency.status
    emergency.status = update.status
    now = datetime.now(timezone.utc)

    if update.status == "DISPATCHED" and not emergency.dispatched_at:
        emergency.dispatched_at = now
    elif update.status == "ON_SCENE" and not emergency.arrived_scene_at:
        emergency.arrived_scene_at = now
    elif update.status == "ARRIVED_HOSPITAL" and not emergency.arrived_hospital_at:
        emergency.arrived_hospital_at = now
    elif update.status == "RESOLVED" and not emergency.resolved_at:
        emergency.resolved_at = now

    target_amb_id = update.assigned_ambulance_id or emergency.assigned_ambulance_id
    if target_amb_id:
        emergency.assigned_ambulance_id = target_amb_id
        amb = db.query(Ambulance).filter(Ambulance.id == target_amb_id).first()
        if amb:
            if update.status == "RESOLVED":
                amb.status = "AVAILABLE"
                if old_status != "RESOLVED":
                    amb.trips_today += 1
            elif update.status in ["DISPATCHED", "EN_ROUTE"]:
                amb.status = "DISPATCHED"
            elif update.status == "ON_SCENE":
                amb.status = "ON_SCENE"
            elif update.status in ["TRANSPORTING", "ARRIVED_HOSPITAL"]:
                amb.status = "TRANSPORTING"

    if update.target_hospital_id:
        emergency.target_hospital_id = update.target_hospital_id

    db.commit()
    db.refresh(emergency)

    # Log action
    log = DispatchLog(
        emergency_id=emergency.id,
        action=f"STATUS_{update.status}",
        actor_role=current_user.role,
        description=f"Status updated from {old_status} to {update.status} by {current_user.full_name} ({current_user.role})."
    )
    db.add(log)
    db.commit()

    # Broadcast update
    await ws_manager.broadcast({
        "type": "EMERGENCY_STATUS_UPDATED",
        "emergency_id": emergency.id,
        "old_status": old_status,
        "new_status": emergency.status,
        "assigned_ambulance_id": emergency.assigned_ambulance_id,
        "target_hospital_id": emergency.target_hospital_id
    })

    return emergency

@router.post("/{emergency_id}/override", response_model=EmergencyResponse)
async def dispatcher_override(
    emergency_id: int,
    req: DispatchOverrideRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["DISPATCHER"]))
):
    emergency = db.query(Emergency).filter(Emergency.id == emergency_id).first()
    if not emergency:
        raise HTTPException(status_code=404, detail="Emergency request not found")

    amb = db.query(Ambulance).filter(Ambulance.id == req.ambulance_id).first()
    if not amb:
        raise HTTPException(status_code=404, detail="Selected ambulance not found")

    emergency.assigned_ambulance_id = amb.id
    if req.hospital_id:
        emergency.target_hospital_id = req.hospital_id
        
    emergency.is_dispatcher_override = True
    emergency.override_reason = req.override_reason
    emergency.status = "DISPATCHED"
    emergency.dispatched_at = datetime.now(timezone.utc)
    amb.status = "DISPATCHED"

    db.commit()
    db.refresh(emergency)

    log = DispatchLog(
        emergency_id=emergency.id,
        action="DISPATCH_OVERRIDDEN",
        actor_role="DISPATCHER",
        description=f"Dispatcher manually assigned Ambulance {amb.callsign}. Reason: {req.override_reason}"
    )
    db.add(log)
    db.commit()

    await ws_manager.broadcast({
        "type": "DISPATCH_OVERRIDE_EXECUTED",
        "emergency_id": emergency.id,
        "assigned_ambulance_id": amb.id,
        "ambulance_callsign": amb.callsign,
        "target_hospital_id": emergency.target_hospital_id,
        "new_status": emergency.status,
        "override_reason": req.override_reason
    })

    return emergency

