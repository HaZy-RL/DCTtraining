#!/usr/bin/env bash
# Build and copy the app into the chorebot FastAPI public dir so it is served at
# https://cloudcody.cc/DCTtraining/ (StaticFiles is mounted at "/" with html=True).
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${DCT_DEPLOY_DIR:-/home/cody/antigrav/chorebot/backend/public/DCTtraining}"
npm run build
mkdir -p "$TARGET"
rm -rf "${TARGET:?}"/*
cp -r dist/* "$TARGET"/
echo "Deployed to $TARGET  ->  https://cloudcody.cc/DCTtraining/"
