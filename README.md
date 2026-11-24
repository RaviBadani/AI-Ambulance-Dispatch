# AI-Driven Emergency Ambulance Dispatch and Coordination Platform

RESPONSAI is a modern emergency-response platform that receives emergency requests, analyzes their severity using AI, identifies the most suitable available ambulance, tracks the ambulance in real time, coordinates with nearby hospitals, and provides an emergency control-center dashboard.

## Features Overview

- **4 Role Dashboards**: Patient/Caller, Paramedic/Driver, Hospital ER Staff, Emergency Dispatcher/Admin.
- **AI Triage Classifier**: Auto-triages priority (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`), calculates severity score (0-100), required equipment, recommended vehicle type (`ALS`, `BLS`, `MICU`), and clinical rationale.
- **AI Dispatch Optimizer**: Haversine distance, travel time ETA, equipment match %, vehicle capability, and driver shift workload scoring.
- **AI Hospital Coordinator**: Trauma level matching, bed/ICU availability, and ER status (`OPEN`, `BUSY`, `DIVERSION`).
- **Interactive Live Map**: Leaflet dark-mode map showing real-time position updates for ambulances, emergency sites, and hospitals.
- **WebSocket Real-time Sync**: Asynchronous state propagation across all active user roles.
- **Dispatcher Manual Override**: Decision support model allowing full dispatcher manual override for safety compliance.
- **Analytics & Reports**: Response times by priority, category distribution, fleet utilization, and ICU bed occupancy.

## Getting Started

### Backend
```bash
cd backend
py -m pip install -r requirements.txt
py -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:3000` in your browser.

## CI/CD Pipeline (Jenkins) & Jira Integration

The project includes an enterprise automated declarative [`Jenkinsfile`](./Jenkinsfile) pipeline supporting multi-branch execution and Jira automation:
- **Dynamic SCM Checkout**: Dynamically fetches the active repository and branch.
- **Pre-Build Validation & Linting**: Validates backend dependencies and builds the frontend bundle before image creation.
- **Parallel Docker Builds**: Concurrently builds `ai-ambulance-dispatch-backend:latest` and `ai-ambulance-dispatch-frontend:latest`.
- **Zero-Downtime Deployment**: Recreates containers within the isolated `ambulance-network` bridge and mounts persistent volumes (`backend_data`).
- **Health Check Verification**: Verifies FastAPI `/health` and Nginx HTTP responses.
- **Jira Automation**: Links build status and auto-comments deployment notifications directly to Jira tickets (e.g. `AMB-101`).

### Jira Integration Features
- **In-App Incident Reporter**: The backend automatically provides Jira issue creation via `backend/app/services/jira_service.py`.
- **API Status & Testing**: Inspect status or test creation at `/api/v1/integrations/jira/status`.
- **Environment Template**: See `backend/.env.example` for configuring `JIRA_SERVER`, `JIRA_EMAIL`, and `JIRA_API_TOKEN`.
- **DevOps Helper Scripts**: Run `scripts/setup_devops.ps1` (Windows) or `scripts/setup_devops.sh` (Linux) to verify environment and Docker readiness.
