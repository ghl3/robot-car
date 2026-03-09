#!/bin/bash
set -euo pipefail

IMAGES_DIR="$(dirname "$0")/../images"
mkdir -p "$IMAGES_DIR"

OUTPUT_FILE="$IMAGES_DIR/jetson-backup-$(date +%Y-%m-%d).img.gz"

DISK_LIST=$(diskutil list external)

DISK_ID=$(echo "$DISK_LIST" | grep -oE '/dev/disk[0-9]+' | head -1 | sed 's|/dev/||')

if [ -z "$DISK_ID" ]; then
    echo "Error: No external disk found."
    exit 1
fi

echo "$DISK_LIST"
echo ""
echo "Will snapshot /dev/$DISK_ID to $OUTPUT_FILE"
printf "Continue? (yes/no): "
read -r REPLY
if [ "$REPLY" != "yes" ]; then
    echo "Aborted."
    exit 1
fi

echo "Unmounting /dev/$DISK_ID..."
if ! diskutil unmountDisk "/dev/$DISK_ID"; then
    echo "Error: Failed to unmount /dev/$DISK_ID"
    exit 1
fi

echo "Starting snapshot (this may take a while)..."
if ! sudo dd if="/dev/r${DISK_ID}" bs=4m status=progress | gzip > "$OUTPUT_FILE"; then
    echo "Error: dd failed."
    exit 1
fi

echo ""
ls -lh "$OUTPUT_FILE"
echo "Snapshot complete."
