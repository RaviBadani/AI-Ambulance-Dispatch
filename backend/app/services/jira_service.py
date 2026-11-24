import logging
import requests
from typing import Optional, List
from app.core.config import settings

logger = logging.getLogger("jira_service")

class JiraService:
    @property
    def is_configured(self) -> bool:
        return bool(settings.JIRA_ENABLED and settings.JIRA_SERVER and settings.JIRA_EMAIL and settings.JIRA_API_TOKEN)

    def create_incident_ticket(
        self,
        summary: str,
        description: str,
        issue_type: str = "Bug",
        priority: str = "High",
        labels: Optional[List[str]] = None
    ) -> Optional[str]:
        """
        Creates an incident ticket in Jira using standard Atlassian REST API.
        """
        if not self.is_configured:
            logger.info(f"[JIRA MOCK/DISABLED] Would have created ticket: {summary}")
            return None

        server = settings.JIRA_SERVER.rstrip("/")
        url = f"{server}/rest/api/2/issue"
        auth = (settings.JIRA_EMAIL, settings.JIRA_API_TOKEN)
        headers = {"Accept": "application/json", "Content-Type": "application/json"}

        payload = {
            "fields": {
                "project": {"key": settings.JIRA_PROJECT_KEY},
                "summary": summary,
                "description": description,
                "issuetype": {"name": issue_type},
                "labels": labels or ["ambulance-dispatch", "automated-alert"]
            }
        }

        try:
            resp = requests.post(url, json=payload, auth=auth, headers=headers, timeout=10)
            if resp.status_code in (200, 201):
                data = resp.json()
                issue_key = data.get("key")
                logger.info(f"Jira issue created successfully: {issue_key}")
                return issue_key
            else:
                logger.error(f"Jira API error ({resp.status_code}): {resp.text}")
                return None
        except Exception as e:
            logger.error(f"Failed to call Jira REST API: {e}")
            return None

    def add_comment(self, issue_key: str, comment: str) -> bool:
        """
        Adds a comment to an existing Jira issue.
        """
        if not self.is_configured:
            return False

        server = settings.JIRA_SERVER.rstrip("/")
        url = f"{server}/rest/api/2/issue/{issue_key}/comment"
        auth = (settings.JIRA_EMAIL, settings.JIRA_API_TOKEN)
        headers = {"Accept": "application/json", "Content-Type": "application/json"}

        payload = {"body": comment}
        try:
            resp = requests.post(url, json=payload, auth=auth, headers=headers, timeout=10)
            return resp.status_code in (200, 201)
        except Exception as e:
            logger.error(f"Failed to post comment to Jira issue {issue_key}: {e}")
            return False

jira_service = JiraService()
