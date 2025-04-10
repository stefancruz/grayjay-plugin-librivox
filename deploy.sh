#!/bin/sh
DOCUMENT_ROOT=/var/www/sources

# Use environment variable to determine deployment type
PRE_RELEASE=${PRE_RELEASE:-false}  # Default to false if not set

# Determine deployment directory
if [ "$PRE_RELEASE" = "true" ]; then
    RELATIVE_PATH="pre-release/LibriVox"
else
    RELATIVE_PATH="LibriVox"
fi

DEPLOY_DIR="$DOCUMENT_ROOT/$RELATIVE_PATH"
PLUGIN_URL_ROOT="https://plugins.grayjay.app/$RELATIVE_PATH"
SOURCE_URL="$PLUGIN_URL_ROOT/LibriVoxConfig.json"

# Take site offline
echo "Taking site offline..."
touch $DOCUMENT_ROOT/maintenance.file

# Swap over the content
echo "Deploying content..."
mkdir -p "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR/assets"  # Create media directory if it doesn't exist
cp LibriVoxIcon.png "$DEPLOY_DIR"
cp LibriVoxConfig.json "$DEPLOY_DIR"
cp LibriVoxScript.js "$DEPLOY_DIR"
cp assets/default-book-cover.png "$DEPLOY_DIR/assets/"  # Copy the speaker.png file to media folder
# Update the sourceUrl in LibriVoxConfig.json
echo "Updating sourceUrl in LibriVoxConfig.json..."
jq --arg sourceUrl "$SOURCE_URL" '.sourceUrl = $sourceUrl' "$DEPLOY_DIR/LibriVoxConfig.json" > "$DEPLOY_DIR/LibriVoxConfig_temp.json"
if [ $? -eq 0 ]; then
    mv "$DEPLOY_DIR/LibriVoxConfig_temp.json" "$DEPLOY_DIR/LibriVoxConfig.json"
else
    echo "Failed to update LibriVoxConfig.json" >&2
    exit 1
fi

sh sign.sh "$DEPLOY_DIR/LibriVoxScript.js" "$DEPLOY_DIR/LibriVoxConfig.json"

# Notify Cloudflare to wipe the CDN cache
echo "Purging Cloudflare cache for zone $CLOUDFLARE_ZONE_ID..."
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     -H "Content-Type: application/json" \
     --data '{"files":["'"$PLUGIN_URL_ROOT/LibriVoxIcon.png"'", "'"$PLUGIN_URL_ROOT/LibriVoxConfig.json"'", "'"$PLUGIN_URL_ROOT/LibriVoxScript.js"'", "'"$PLUGIN_URL_ROOT/media/speaker.png"'"]}'

# Take site back online
echo "Bringing site back online..."
rm "$DOCUMENT_ROOT/maintenance.file"
