#!/bin/bash

# The-Tavern-Backend startup script
# Intended to be called by a systemd service.
# PM2 manages the Node.js process itself.

set -e

# Always run from the backend directory so relative paths work correctly.
cd "$(dirname "$0")"

# Load the user's shell environment so PM2 and Node are available when
# this script is launched by systemd.
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"

# Start the server under PM2 if it is not already running.
if pm2 describe tavern-backend >/dev/null 2>&1; then
    pm2 restart tavern-backend
else
    pm2 start server.js --name tavern-backend
fi

# Persist the PM2 process list.
pm2 save
