import logging
from typing import Optional, List
from app.core.config import settings

logger = logging.getLogger("jira_service")

class JiraService:
    def __init__(self):
        self._client = None
        self._initialized = False

    def _get_client(self):
        if not settings.JIRA_ENABLED:
            return None
        
        if self._initialized:
            return self._client

        if not (settings.JIRA_SERVER and settings.JIRA_EMAIL and settings.JIRA_API_TOKEN):
            logger.warning("Jira integration is enabled but credentials (SERVER, EMAIL, or API_TOKEN) are missing.")
            self._initialized = True
            return None

        try:
            from jira import JIRA
            self._client = JIRA(
                server=settings.JIRA_SERVER,
                basic_auth=(settings.JIRA_EMAIL, settings.JIRA_API_TOKEN)
            )
            self._initialized = True
            logger.info(f"Successfully connected to Jira instance: {settings.JIRA_SERVER}")
            return self._client
        except Exception as e:
            logger.error(f"Failed to initialize Jira client: {e}")
            self._initialized = True
            return None

    def create_incident_ticket(
        self,
        summary: str,
        description: str,
        issue_type: str = "Bug",
        priority: str = "High",
        labels: Optional[List[str]] = None
    ) -> Optional[str]:
        """
        Creates an incident ticket in Jira. Returns the created issue key (e.g. 'AMB-42') or None.
        """
        client = self._get_client()
        if not client:
            logger.info(f"[JIRA MOCK/DISABLED] Would have created ticket: {summary}")
            return None

        try:
            issue_dict = {
                "project": {"key": settings.JIRA_PROJECT_KEY},
                "summary": summary,
                "description": description,
                "issuetype": {"name": issue_type},
                "labels": labels or ["ambulance-dispatch", "automated-alert"]
            }
            new_issue = client.create_issue(fields=issue_dict)
            logger.info(f"Jira issue created successfully: {new_issue.key}")
            return new_issue.key
        except Exception as e:
            logger.error(f"Error creating Jira incident: {e}")
            return None

    def add_comment(self, issue_key: str, comment: str) -> bool:
        """
        Appends a comment to an existing Jira issue.
        """
        client = self._get_client()
        if not client:
            return False

        try:
            client.add_comment(issue_key, comment)
            return True
        except Exception as e:
            logger.error(f"Failed to add comment to Jira issue {issue_key}: {e}")
            return False

jira_service = JiraService()

