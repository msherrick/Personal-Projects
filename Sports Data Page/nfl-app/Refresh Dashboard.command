#!/bin/bash
# Double-click to refresh the dashboard (Mac). First time only: right-click, Open.
cd "$(dirname "$0")"
python3 src/refresh.py
echo
read -n 1 -s -r -p "Press any key to close this window"
