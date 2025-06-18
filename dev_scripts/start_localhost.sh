#!/bin/bash

echo "Starting simple HTTP server for 10 hours..."
echo "Access your app at: http://localhost:8000"
echo "Press Ctrl+C to stop it earlier, or it will stop automatically after 10 hours."
timeout 10h python3.12 -m http.server