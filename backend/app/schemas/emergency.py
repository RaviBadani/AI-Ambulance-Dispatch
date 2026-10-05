from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class EmergencyCreate(BaseModel):
    caller_name: str
    caller_phone: str
    address: str
    latitude: float
    longitude: float
    emergency_type: str
    symptoms: Optional[str] = ""
    patient_count: int = 1
    special_requirements: List[str] = []

class GuestEmergencyCreate(BaseModel):
    client_generated_id: str = Field(..., min_length=4, max_length=64)
    emergency_type: str = Field(..., min_length=2, max_length=50)
    description: Optional[str] = Field(default="", max_length=500)
    people_affected: int = Field(default=1, ge=1, le=50)
    phone: Optional[str] = Field(default="", max_length=30)
    latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    accuracy: Optional[float] = Field(default=None, ge=0.0, le=10000.0)
    address: Optional[str] = Field(default="", max_length=250)

class EmergencyStatusUpdate(BaseModel):
    status: str
    assigned_ambulance_id: Optional[int] = None
    target_hospital_id: Optional[int] = None

class DispatchOverrideRequest(BaseModel):
    ambulance_id: int
    hospital_id: Optional[int] = None
    override_reason: str

class EmergencyResponse(BaseModel):
    id: int
    client_generated_id: Optional[str] = None
    is_guest: Optional[bool] = False
    accuracy: Optional[float] = None
    caller_name: str
    caller_phone: str
    address: str
    latitude: float
    longitude: float
    emergency_type: str
    symptoms: Optional[str]
    patient_count: int
    special_requirements: List[str]
    priority: Optional[str]
    ai_severity_score: Optional[float]
    ai_recommended_type: Optional[str]
    ai_required_equipment: List[str]
    ai_urgency_reason: Optional[str]
    status: str
    assigned_ambulance_id: Optional[int]
    target_hospital_id: Optional[int]
    is_dispatcher_override: bool
    override_reason: Optional[str]
    created_at: datetime
    dispatched_at: Optional[datetime]
    arrived_scene_at: Optional[datetime]
    arrived_hospital_at: Optional[datetime]
    resolved_at: Optional[datetime]

    class Config:
        from_attributes = True

class GuestEmergencyResponse(BaseModel):
    id: int
    client_generated_id: Optional[str] = None
    is_guest: bool = True
    emergency_type: str
    description: Optional[str] = None
    people_affected: int = 1
    phone: Optional[str] = None
    address: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy: Optional[float] = None
    priority: Optional[str] = None
    ai_severity_score: Optional[float] = None
    ai_recommended_type: Optional[str] = None
    ai_urgency_reason: Optional[str] = None
    status: str
    assigned_ambulance_id: Optional[int] = None
    assigned_ambulance: Optional[dict] = None
    created_at: datetime

    class Config:
        from_attributes = True

