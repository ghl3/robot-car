#!/bin/bash
set -euo pipefail

GDRIVE_FILE_ID="16OBLRNlrZaSkhVcC4xJ6VugtChmZw1_B"
VENV_DIR="$(dirname "$0")/../venv"
IMAGES_DIR="$(dirname "$0")/../images"
OUTPUT_NAME="waveshare-jetracer-ros"

mkdir -p "$IMAGES_DIR"

source "$VENV_DIR/bin/activate"

if ! command -v gdown &>/dev/null; then
    echo "Installing gdown..."
    pip install gdown
fi

cd "$IMAGES_DIR"

echo "Downloading image from Google Drive..."
gdown "https://drive.google.com/uc?id=$GDRIVE_FILE_ID"

ZIP_FILE=$(ls -t *.zip 2>/dev/null | head -1)
if [ -z "$ZIP_FILE" ]; then
    echo "Error: No .zip file found after download."
    exit 1
fi

echo "Extracting $ZIP_FILE..."
unzip "$ZIP_FILE"

IMG_FILE=$(ls -t *.img 2>/dev/null | head -1)
if [ -z "$IMG_FILE" ]; then
    echo "Error: No .img file found after extraction."
    exit 1
fi

mv "$IMG_FILE" "$OUTPUT_NAME.img"
rm "$ZIP_FILE"

ls -lh "$OUTPUT_NAME.img"
echo "Download complete: $IMAGES_DIR/$OUTPUT_NAME.img"
