#!/usr/bin/env python3
"""
RESPONSAI - Automated Jira Backlog Creator
Reads jira_backlog_import.csv and creates issues directly via Jira Cloud REST API.
"""
import os
import csv
import sys
import requests
from pathlib import Path

# Load environment variables from backend/.env if present
env_path = Path(__file__).resolve().parent.parent / "backend" / ".env"
env_vars = {}
if env_path.exists():
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env_vars[k.strip()] = v.strip().strip('"').strip("'")

JIRA_SERVER = os.getenv("JIRA_SERVER", env_vars.get("JIRA_SERVER", "https://ravibadani-dispatch.atlassian.net")).rstrip("/")
JIRA_EMAIL = os.getenv("JIRA_EMAIL", env_vars.get("JIRA_EMAIL", ""))
JIRA_API_TOKEN = os.getenv("JIRA_API_TOKEN", env_vars.get("JIRA_API_TOKEN", ""))
JIRA_PROJECT_KEY = os.getenv("JIRA_PROJECT_KEY", env_vars.get("JIRA_PROJECT_KEY", "KAN"))

CSV_PATH = Path(__file__).resolve().parent / "jira_backlog_import.csv"

def print_banner():
    print("=" * 65)
    print(" RESPONSAI - AUTOMATED JIRA BACKLOG CREATOR")
    print(f" Target Site: {JIRA_SERVER} | Project Key: {JIRA_PROJECT_KEY}")
    print("=" * 65)

def create_issue(summary, issue_type, description, priority, labels):
    url = f"{JIRA_SERVER}/rest/api/2/issue"
    auth = (JIRA_EMAIL, JIRA_API_TOKEN)
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    
    payload = {
        "fields": {
            "project": {"key": JIRA_PROJECT_KEY},
            "summary": summary,
            "description": description,
            "issuetype": {"name": "Task" if issue_type in ("Task", "Story") else issue_type},
            "priority": {"name": priority if priority in ("Highest", "High", "Medium", "Low") else "Medium"},
            "labels": [lbl.strip() for lbl in labels.split(";") if lbl.strip()]
        }
    }
    
    resp = requests.post(url, json=payload, auth=auth, headers=headers, timeout=15)
    if resp.status_code in (200, 201):
        return True, resp.json().get("key")
    else:
        return False, f"HTTP {resp.status_code}: {resp.text}"

def main():
    print_banner()
    if not (JIRA_EMAIL and JIRA_API_TOKEN):
        print("\n[!] Jira credentials not set in backend/.env or environment variables.")
        print(f"    You can import '{CSV_PATH.name}' directly in Jira:")
        print("    Jira -> Settings (gear icon) -> System -> External System Import -> CSV")
        print("\nDisplaying all 24 tasks ready to be created:\n")
        
        with open(CSV_PATH, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            count = 1
            for row in reader:
                print(f" {count:02d}. [{row['Priority']}] ({row['Issue Type']}) {row['Summary']}")
                print(f"     Labels: {row['Labels']} | Points: {row['Story Points']}")
                count += 1
        return

    print("\n[✓] Credentials detected! Creating issues in Jira Cloud...\n")
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        count = 1
        for row in reader:
            success, result = create_issue(
                summary=row["Summary"],
                issue_type=row["Issue Type"],
                description=row["Description"],
                priority=row["Priority"],
                labels=row["Labels"]
            )
            if success:
                print(f" [✓] Created issue {count:02d}: {result} - {row['Summary']}")
            else:
                print(f" [X] Failed to create issue {count:02d}: {result}")
            count += 1

    print("\n[✓] All backlog tasks processed successfully!")

if __name__ == "__main__":
    main()
