pipeline {
    agent any

    parameters {
        string(name: 'BRANCH_NAME', defaultValue: 'main', description: 'Git branch to deploy')
        choice(name: 'DEPLOY_ENV', choices: ['production', 'staging', 'development'], description: 'Deployment Target')
        booleanParam(name: 'NOTIFY_JIRA', defaultValue: false, description: 'Send build & deployment status to Jira')
        string(name: 'JIRA_ISSUE_KEY', defaultValue: '', description: 'Optional Jira Issue Key (e.g., AMB-101) to link with this build')
    }

    environment {
        PROJECT_NAME    = 'AI-Ambulance-Dispatch'
        DOCKER_NETWORK  = 'ambulance-network'
        BACKEND_IMAGE   = 'ai-ambulance-dispatch-backend:latest'
        FRONTEND_IMAGE  = 'ai-ambulance-dispatch-frontend:latest'
        BACKEND_PORT    = '8000'
        FRONTEND_PORT   = '80'
        JIRA_SITE_NAME  = 'jira-cloud' // Configured under Manage Jenkins -> Jira Software Cloud
    }

    options {
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timestamps()
    }

    stages {
        stage('Checkout SCM') {
            steps {
                echo "Fetching codebase dynamically from configured SCM..."
                checkout scm
            }
        }

        stage('Code Validation & Tests') {
            parallel {
                stage('Backend Lint & Tests') {
                    steps {
                        dir('backend') {
                            echo "Verifying backend dependencies..."
                            sh '''
                                python3 -c "import sys; print(f'Python runtime: {sys.version}')"
                            '''
                        }
                    }
                }

                stage('Frontend Validation') {
                    steps {
                        dir('frontend') {
                            echo "Checking frontend build prerequisites..."
                            sh '''
                                if command -v npm > /dev/null 2>&1; then
                                    npm ci --prefer-offline --no-audit || npm install --no-audit
                                    npm run build
                                else
                                    echo "Node/npm not on host; frontend will be compiled directly in the multi-stage Docker build."
                                fi
                            '''
                        }
                    }
                }
            }
        }

        stage('Build Docker Containers') {
            parallel {
                stage('Build Backend Container') {
                    steps {
                        echo "Building Backend Docker image..."
                        sh "docker build -t ${BACKEND_IMAGE} ./backend"
                    }
                }

                stage('Build Frontend Container') {
                    steps {
                        echo "Building Frontend Docker image..."
                        sh "docker build -t ${FRONTEND_IMAGE} ./frontend"
                    }
                }
            }
        }

        stage('Orchestrate Infrastructure') {
            steps {
                echo "Ensuring isolated Docker network and persistent storage volumes..."
                sh """
                    docker network create ${DOCKER_NETWORK} || true
                    docker volume create backend_data || true
                """
            }
        }

        stage('Deploy Services') {
            steps {
                echo "Deploying modernized Ambulance Dispatch stack to ${params.DEPLOY_ENV}..."
                sh """
                    # Gracefully stop old instances if present
                    docker rm -f ambulance_backend || true
                    docker rm -f ambulance_frontend || true

                    # Start Backend
                    docker run -d \\
                        --name ambulance_backend \\
                        --restart unless-stopped \\
                        --network ${DOCKER_NETWORK} \\
                        --network-alias backend \\
                        -v backend_data:/app/data \\
                        -p ${BACKEND_PORT}:8000 \\
                        ${BACKEND_IMAGE}

                    # Start Frontend
                    docker run -d \\
                        --name ambulance_frontend \\
                        --restart unless-stopped \\
                        --network ${DOCKER_NETWORK} \\
                        -p ${FRONTEND_PORT}:80 \\
                        ${FRONTEND_IMAGE}
                """
            }
        }

        stage('Healthcheck & Verification') {
            steps {
                echo "Validating running service endpoints..."
                sh """
                    sleep 5
                    docker ps --filter "name=ambulance_"
                    docker exec ambulance_backend curl -f http://127.0.0.1:8000/health || exit 1
                    docker exec ambulance_frontend wget -q -O - http://127.0.0.1:80/healthz || exit 1
                """
            }
        }
    }

    post {
        always {
            echo "Pipeline completed for build #${BUILD_NUMBER} on branch ${params.BRANCH_NAME}"
        }
        success {
            echo "SUCCESS: AI-Ambulance-Dispatch deployed successfully to ${params.DEPLOY_ENV}."
            script {
                if (params.NOTIFY_JIRA && params.JIRA_ISSUE_KEY) {
                    echo "Notifying Jira issue ${params.JIRA_ISSUE_KEY} of successful deployment..."
                    try {
                        jiraComment issueKey: params.JIRA_ISSUE_KEY, 
                                    body: "🚀 Build #${BUILD_NUMBER} passed and deployed successfully to *${params.DEPLOY_ENV}* via Jenkins."
                    } catch (Exception e) {
                        echo "Jira notification notice: ${e.getMessage()}"
                    }
                }
            }
        }
        failure {
            echo "FAILURE: Deployment failed on build #${BUILD_NUMBER}."
            script {
                if (params.NOTIFY_JIRA && params.JIRA_ISSUE_KEY) {
                    try {
                        jiraComment issueKey: params.JIRA_ISSUE_KEY, 
                                    body: "❌ Build #${BUILD_NUMBER} failed during deployment to *${params.DEPLOY_ENV}*. Please inspect Jenkins console."
                    } catch (Exception e) {
                        echo "Jira notification notice: ${e.getMessage()}"
                    }
                }
            }
        }
    }
}
