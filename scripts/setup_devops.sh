#!/usr/bin/env bash
# ==============================================================
# RESPONSAI - DevOps, Jenkins & Jira Setup Script (Linux / macOS / Jenkins Agent)
# ==============================================================

set -e

echo -e "\033[1;36m==========================================\033[0m"
echo -e "\033[1;36m RESPONSAI - CI/CD & JIRA SETUP AUTOMATION\033[0m"
echo -e "\033[1;36m==========================================\033[0m"

# 1. Environment template
if [ ! -f "backend/.env" ]; then
    if [ -f "backend/.env.example" ]; then
        cp backend/.env.example backend/.env
        echo -e "\033[1;32m[✓] Created backend/.env from template.\033[0m"
    fi
else
    echo -e "\033[1;33m[i] backend/.env already exists.\033[0m"
fi

# 2. Check Git Remote
if git remote get-url origin > /dev/null 2>&1; then
    CURRENT_REMOTE=$(git remote get-url origin)
    echo -e "Current Git Remote: \033[1;37m$CURRENT_REMOTE\033[0m"
    if [[ "$CURRENT_REMOTE" == *"guruvardhan8374"* ]]; then
        echo -e "\033[1;33m[!] Note: Remote points to friend's repository.\033[0m"
        echo -e "    Update with: git remote set-url origin https://github.com/<your-username>/AI-Ambulance-Dispatch.git"
    fi
fi

# 3. Docker validation
if command -v docker > /dev/null 2>&1; then
    if docker info > /dev/null 2>&1; then
        echo -e "\033[1;32m[✓] Docker is active and accessible.\033[0m"
    else
        echo -e "\033[1;31m[!] Docker daemon is not running or user lacks permissions (check 'usermod -aG docker jenkins').\033[0m"
    fi
else
    echo -e "\033[1;31m[!] Docker is not installed.\033[0m"
fi

echo -e "\033[1;32mConfiguration complete.\033[0m"

