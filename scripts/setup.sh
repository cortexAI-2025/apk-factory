#!/bin/bash
# APK Factory - Initial Setup Script
set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ___  ____  _  __  _____          _"
echo " / _ \|  _ \| |/ / |  ___|_ _  ___| |_ ___  _ __ _   _"
echo "| | | | |_) | ' /  | |_ / _\` |/ __| __/ _ \| '__| | | |"
echo "| |_| |  __/| . \  |  _| (_| | (__| || (_) | |  | |_| |"
echo " \___/|_|   |_|\_\ |_|  \__,_|\___|\__\___/|_|   \__, |"
echo "                                                    |___/"
echo -e "${NC}"
echo -e "${GREEN}APK Factory - Setup Script${NC}"
echo ""

# Check dependencies
check_command() {
  if ! command -v "$1" &>/dev/null; then
    echo -e "${RED}✗ $1 is required but not installed${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ $1 found${NC}"
}

echo "Checking dependencies..."
check_command docker
check_command docker-compose
check_command node
check_command npm
echo ""

# Create .env if not exists
if [ ! -f .env ]; then
  echo -e "${YELLOW}Creating .env from .env.example...${NC}"
  cp .env.example .env

  # Generate random secrets
  JWT_SECRET=$(openssl rand -hex 32)
  WORKER_SECRET=$(openssl rand -hex 24)
  PG_PASS=$(openssl rand -hex 16)
  REDIS_PASS=$(openssl rand -hex 16)

  sed -i "s/JWT_SECRET=.*/JWT_SECRET=${JWT_SECRET}/" .env
  sed -i "s/WORKER_SECRET=.*/WORKER_SECRET=${WORKER_SECRET}/" .env
  sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${PG_PASS}/" .env
  sed -i "s/REDIS_PASSWORD=.*/REDIS_PASSWORD=${REDIS_PASS}/" .env

  echo -e "${GREEN}✓ .env created with random secrets${NC}"
  echo -e "${YELLOW}  → Please add your ANTHROPIC_API_KEY to .env for AI AutoFix${NC}"
fi

# Install backend deps
echo ""
echo -e "${CYAN}Installing backend dependencies...${NC}"
cd backend && npm install && cd ..

# Install worker deps
echo ""
echo -e "${CYAN}Installing worker dependencies...${NC}"
cd worker && npm install && cd ..

# Install frontend deps
echo ""
echo -e "${CYAN}Installing frontend dependencies...${NC}"
cd frontend && npm install && cd ..

# Generate Prisma client
echo ""
echo -e "${CYAN}Generating Prisma client...${NC}"
cd backend && npx prisma generate && cd ..

echo ""
echo -e "${GREEN}✓ Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Edit .env and add your ANTHROPIC_API_KEY"
echo "  2. Run: docker-compose up -d postgres redis"
echo "  3. Run: cd backend && npx prisma migrate deploy"
echo "  4. Run: docker-compose up -d"
echo "  5. Open: http://localhost:3000"
echo ""
echo -e "${CYAN}Or for development:${NC}"
echo "  docker-compose up -d postgres redis"
echo "  cd backend && npm run start:dev &"
echo "  cd worker && npm run start:dev &"
echo "  cd frontend && npm run dev &"
