#!/bin/bash
set -euo pipefail

IMAGE_PATH=""

while getopts "i:" opt; do
    case $opt in
        i) IMAGE_PATH="$OPTARG" ;;
        *) echo "Usage: flash_sd_card.sh -i <image_path>"; exit 1 ;;
    esac
done

if [ -z "$IMAGE_PATH" ]; then
    echo "Usage: flash_sd_card.sh -i <image_path>"
    exit 1
fi

if [ ! -f "$IMAGE_PATH" ]; then
    echo "Error: Image file not found: $IMAGE_PATH"
    exit 1
fi

COMPRESSED=false
if [[ "$IMAGE_PATH" == *.gz ]]; then
    COMPRESSED=true
fi

DISK_LIST=$(diskutil list external)

DISK_ID=$(echo "$DISK_LIST" | grep -oE '/dev/disk[0-9]+' | head -1 | sed 's|/dev/||')

if [ -z "$DISK_ID" ]; then
    echo "Error: No external disk found."
    exit 1
fi

echo "$DISK_LIST"
echo ""
echo "Will flash $IMAGE_PATH to /dev/$DISK_ID"
echo "WARNING: This will ERASE ALL DATA on /dev/$DISK_ID"
printf "Type 'yes' to continue: "
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

echo "Flashing image (this may take a while)..."
if [ "$COMPRESSED" = true ]; then
    if ! gunzip -c "$IMAGE_PATH" | sudo dd of="/dev/r${DISK_ID}" bs=4m status=progress; then
        echo "Error: Flash failed."
        exit 1
    fi
else
    if ! sudo dd if="$IMAGE_PATH" of="/dev/r${DISK_ID}" bs=4m status=progress; then
        echo "Error: Flash failed."
        exit 1
    fi
fi

echo "Syncing..."
sync

echo "Ejecting /dev/$DISK_ID..."
if ! diskutil eject "/dev/$DISK_ID"; then
    echo "Error: Failed to eject /dev/$DISK_ID"
    exit 1
fi

echo "Flash complete. You can now insert the SD card into the Jetson Nano."
