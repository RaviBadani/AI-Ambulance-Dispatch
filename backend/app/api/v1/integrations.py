from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from app.api.deps import require_roles
from app.models.user import User
from app.core.config import settings
from app.services.jira_service import jira_service

router = APIRouter()

class JiraTestRequest(BaseModel):
    summary: str = "Test Emergency Incident Ticket"
    description: str = "This is a test incident report automatically created by the RESPONSAI Ambulance Dispatch platform."
    priority: str = "Medium"
    labels: Optional[List[str]] = ["test", "responsai"]

@router.get("/jira/status")
def get_jira_status(current_user: User = Depends(require_roles(["DISPATCHER"]))):
    """
    Returns the current Jira integration configuration status.
    """
    return {
        "jira_enabled": settings.JIRA_ENABLED,
        "jira_server": settings.JIRA_SERVER if settings.JIRA_ENABLED else "Not configured",
        "jira_project_key": settings.JIRA_PROJECT_KEY,
        "is_configured": bool(settings.JIRA_SERVER and settings.JIRA_EMAIL and settings.JIRA_API_TOKEN)
    }

@router.post("/jira/create-test-issue")
def create_test_jira_issue(
    payload: JiraTestRequest,
    current_user: User = Depends(require_roles(["DISPATCHER"]))
):
    """
    Creates a test incident issue in Jira. Requires DISPATCHER role.
    """
    if not settings.JIRA_ENABLED:
        raise HTTPException(
            status_code=400,
            detail="Jira integration is disabled. Set JIRA_ENABLED=true in backend environment."
        )

    issue_key = jira_service.create_incident_ticket(
        summary=payload.summary,
        description=f"{payload.description}\n\nReported by Dispatcher: {current_user.full_name} ({current_user.email})",
        priority=payload.priority,
        labels=payload.labels
    )

    if not issue_key:
        raise HTTPException(
            status_code=500,
            detail="Failed to create Jira issue. Verify Jira server URL, email, API token, and project permissions."
        )

    return {
        "success": True,
        "issue_key": issue_key,
        "issue_url": f"{settings.JIRA_SERVER.rstrip('/')}/browse/{issue_key}"
    }

