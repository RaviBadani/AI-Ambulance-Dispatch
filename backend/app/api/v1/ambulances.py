from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone

from app.api.deps import get_db, require_roles
from app.models.user import User
from app.models.ambulance import Ambulance
from app.schemas.ambulance import AmbulanceResponse, AmbulanceLocationUpdate, AmbulanceStatusUpdate
from app.core.websocket_manager import ws_manager

router = APIRouter()

@router.get("/", response_model=List[AmbulanceResponse])
def get_ambulances(
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["DISPATCHER", "DRIVER", "HOSPITAL", "CALLER"]))
):
    query = db.query(Ambulance)
    if status_filter:
        query = query.filter(Ambulance.status == status_filter)
    return query.all()

@router.get("/{ambulance_id}", response_model=AmbulanceResponse)
def get_ambulance(
    ambulance_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["DISPATCHER", "DRIVER", "HOSPITAL", "CALLER"]))
):
    amb = db.query(Ambulance).filter(Ambulance.id == ambulance_id).first()
    if not amb:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    return amb

@router.patch("/{ambulance_id}/location", response_model=AmbulanceResponse)
async def update_ambulance_location(
    ambulance_id: int,
    location: AmbulanceLocationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["DRIVER", "DISPATCHER"]))
):
    amb = db.query(Ambulance).filter(Ambulance.id == ambulance_id).first()
    if not amb:
        raise HTTPException(status_code=404, detail="Ambulance not found")

    # RBAC: Drivers can only update their own assigned ambulance
    if current_user.role == "DRIVER":
        if amb.driver_user_id and amb.driver_user_id != current_user.id:
            raise HTTPException(
                status_code=403,
                detail=f"Driver '{current_user.full_name}' is not authorized to update Ambulance {amb.callsign}."
            )
        elif not amb.driver_user_id:
            amb.driver_user_id = current_user.id

    if not (-90.0 <= location.latitude <= 90.0 and -180.0 <= location.longitude <= 180.0):
        raise HTTPException(status_code=400, detail="Latitude must be between -90 and 90, longitude between -180 and 180.")

    now = datetime.now(timezone.utc)
    amb.latitude = location.latitude
    amb.longitude = location.longitude
    amb.last_updated = now
    db.commit()
    db.refresh(amb)

    await ws_manager.broadcast({
        "type": "AMBULANCE_LOCATION_UPDATED",
        "ambulance_id": amb.id,
        "callsign": amb.callsign,
        "latitude": amb.latitude,
        "longitude": amb.longitude,
        "status": amb.status,
        "timestamp": now.isoformat()
    })

    return amb


@router.patch("/{ambulance_id}/status", response_model=AmbulanceResponse)
async def update_ambulance_status(
    ambulance_id: int,
    status_in: AmbulanceStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["DRIVER", "DISPATCHER"]))
):
    amb = db.query(Ambulance).filter(Ambulance.id == ambulance_id).first()
    if not amb:
        raise HTTPException(status_code=404, detail="Ambulance not found")

    amb.status = status_in.status
    amb.last_updated = datetime.now(timezone.utc)
    db.commit()
    db.refresh(amb)

    await ws_manager.broadcast({
        "type": "AMBULANCE_STATUS_CHANGED",
        "ambulance_id": amb.id,
        "callsign": amb.callsign,
        "status": amb.status
    })

    return amb
