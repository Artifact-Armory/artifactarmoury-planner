#!/bin/bash

# ============================================================================
# CloudFront CDN Invalidation Strategy
# ============================================================================
# This script manages CloudFront cache invalidation for updated models
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# CONFIGURATION
# ============================================================================

DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"
INVALIDATION_LOG_FILE="cloudfront-invalidations.log"
MAX_PATHS_PER_INVALIDATION=3000  # AWS limit

# ============================================================================
# FUNCTIONS
# ============================================================================

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1" >> "$INVALIDATION_LOG_FILE"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] SUCCESS: $1" >> "$INVALIDATION_LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1" >> "$INVALIDATION_LOG_FILE"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1" >> "$INVALIDATION_LOG_FILE"
}

check_distribution_id() {
    if [ -z "$DISTRIBUTION_ID" ]; then
        log_error "CLOUDFRONT_DISTRIBUTION_ID not set"
        exit 1
    fi
    log_success "Distribution ID: $DISTRIBUTION_ID"
}

# ============================================================================
# INVALIDATION STRATEGIES
# ============================================================================

# Strategy 1: Invalidate specific model file
invalidate_model() {
    local model_path="$1"
    
    if [ -z "$model_path" ]; then
        log_error "Model path required"
        exit 1
    fi
    
    log_info "Invalidating model: $model_path"
    
    local invalidation_id=$(aws cloudfront create-invalidation \
        --distribution-id "$DISTRIBUTION_ID" \
        --paths "/$model_path" \
        --query 'Invalidation.Id' \
        --output text)
    
    log_success "Invalidation created: $invalidation_id"
    
    # Wait for invalidation to complete
    wait_for_invalidation "$invalidation_id"
}

# Strategy 2: Invalidate all models for an artist
invalidate_artist_models() {
    local artist_id="$1"
    
    if [ -z "$artist_id" ]; then
        log_error "Artist ID required"
        exit 1
    fi
    
    log_info "Invalidating all models for artist: $artist_id"
    
    local invalidation_id=$(aws cloudfront create-invalidation \
        --distribution-id "$DISTRIBUTION_ID" \
        --paths "/models/$artist_id/*" \
        --query 'Invalidation.Id' \
        --output text)
    
    log_success "Invalidation created: $invalidation_id"
    
    wait_for_invalidation "$invalidation_id"
}

# Strategy 3: Invalidate specific asset and related files
invalidate_asset() {
    local artist_id="$1"
    local asset_id="$2"
    
    if [ -z "$artist_id" ] || [ -z "$asset_id" ]; then
        log_error "Artist ID and Asset ID required"
        exit 1
    fi
    
    log_info "Invalidating asset: $artist_id/$asset_id"
    
    # Invalidate model, thumbnail, and preview
    local invalidation_id=$(aws cloudfront create-invalidation \
        --distribution-id "$DISTRIBUTION_ID" \
        --paths \
            "/models/$artist_id/$asset_id/*" \
            "/thumbnails/$artist_id/$asset_id/*" \
            "/images/$artist_id/$asset_id/*" \
        --query 'Invalidation.Id' \
        --output text)
    
    log_success "Invalidation created: $invalidation_id"
    
    wait_for_invalidation "$invalidation_id"
}

# Strategy 4: Invalidate all content (full cache clear)
invalidate_all() {
    log_warning "Invalidating ALL content - this is expensive!"
    read -p "Are you sure? (yes/no) " -n 3 -r
    echo
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        log_info "Cancelled"
        return
    fi
    
    log_info "Invalidating all content"
    
    local invalidation_id=$(aws cloudfront create-invalidation \
        --distribution-id "$DISTRIBUTION_ID" \
        --paths "/*" \
        --query 'Invalidation.Id' \
        --output text)
    
    log_success "Full invalidation created: $invalidation_id"
    
    wait_for_invalidation "$invalidation_id"
}

# Strategy 5: Invalidate by file extension
invalidate_by_type() {
    local file_type="$1"  # glb, stl, png, jpg, etc.
    
    if [ -z "$file_type" ]; then
        log_error "File type required (e.g., glb, stl, png)"
        exit 1
    fi
    
    log_info "Invalidating all .$file_type files"
    
    local invalidation_id=$(aws cloudfront create-invalidation \
        --distribution-id "$DISTRIBUTION_ID" \
        --paths "/*.$file_type" \
        --query 'Invalidation.Id' \
        --output text)
    
    log_success "Invalidation created: $invalidation_id"
    
    wait_for_invalidation "$invalidation_id"
}

# Strategy 6: Batch invalidation from file
invalidate_batch() {
    local file_path="$1"
    
    if [ -z "$file_path" ] || [ ! -f "$file_path" ]; then
        log_error "File path required and must exist"
        exit 1
    fi
    
    log_info "Reading paths from: $file_path"
    
    # Read paths from file and create invalidation
    local paths=()
    while IFS= read -r line; do
        if [ ! -z "$line" ]; then
            paths+=("$line")
        fi
    done < "$file_path"
    
    if [ ${#paths[@]} -eq 0 ]; then
        log_error "No paths found in file"
        exit 1
    fi
    
    log_info "Found ${#paths[@]} paths to invalidate"
    
    # Split into batches if needed
    local batch_size=$MAX_PATHS_PER_INVALIDATION
    local total_batches=$(( (${#paths[@]} + batch_size - 1) / batch_size ))
    
    for ((i = 0; i < ${#paths[@]}; i += batch_size)); do
        local batch=("${paths[@]:i:batch_size}")
        local batch_num=$(( i / batch_size + 1 ))
        
        log_info "Creating invalidation batch $batch_num/$total_batches (${#batch[@]} paths)"
        
        local invalidation_id=$(aws cloudfront create-invalidation \
            --distribution-id "$DISTRIBUTION_ID" \
            --paths "${batch[@]}" \
            --query 'Invalidation.Id' \
            --output text)
        
        log_success "Batch $batch_num invalidation created: $invalidation_id"
        
        wait_for_invalidation "$invalidation_id"
    done
}

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

wait_for_invalidation() {
    local invalidation_id="$1"
    
    log_info "Waiting for invalidation to complete..."
    
    aws cloudfront wait invalidation-completed \
        --distribution-id "$DISTRIBUTION_ID" \
        --id "$invalidation_id"
    
    log_success "Invalidation completed: $invalidation_id"
}

list_invalidations() {
    log_info "Recent invalidations:"
    
    aws cloudfront list-invalidations \
        --distribution-id "$DISTRIBUTION_ID" \
        --query 'InvalidationList.Items[0:10]' \
        --output table
}

get_invalidation_status() {
    local invalidation_id="$1"
    
    if [ -z "$invalidation_id" ]; then
        log_error "Invalidation ID required"
        exit 1
    fi
    
    log_info "Invalidation status: $invalidation_id"
    
    aws cloudfront get-invalidation \
        --distribution-id "$DISTRIBUTION_ID" \
        --id "$invalidation_id" \
        --output table
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    local command="$1"
    
    check_distribution_id
    
    case "$command" in
        model)
            invalidate_model "$2"
            ;;
        artist)
            invalidate_artist_models "$2"
            ;;
        asset)
            invalidate_asset "$2" "$3"
            ;;
        all)
            invalidate_all
            ;;
        type)
            invalidate_by_type "$2"
            ;;
        batch)
            invalidate_batch "$2"
            ;;
        list)
            list_invalidations
            ;;
        status)
            get_invalidation_status "$2"
            ;;
        *)
            print_usage
            ;;
    esac
}

print_usage() {
    cat << EOF
${BLUE}CloudFront CDN Invalidation Strategy${NC}

Usage: $0 <command> [options]

Commands:
  model <path>              Invalidate specific model file
                           Example: model models/artist1/asset1/model.glb
  
  artist <artist_id>        Invalidate all models for an artist
                           Example: artist artist123
  
  asset <artist_id> <asset_id>  Invalidate asset and related files
                           Example: asset artist123 asset456
  
  all                       Invalidate all content (full cache clear)
  
  type <extension>          Invalidate all files of type
                           Example: type glb
  
  batch <file>              Batch invalidation from file (one path per line)
                           Example: batch paths-to-invalidate.txt
  
  list                      List recent invalidations
  
  status <invalidation_id>  Get invalidation status
                           Example: status I1234567890ABC

Environment Variables:
  CLOUDFRONT_DISTRIBUTION_ID  CloudFront distribution ID (required)

Examples:
  # Invalidate single model
  ./cdn-invalidation-strategy.sh model models/artist1/asset1/model.glb
  
  # Invalidate all models for artist
  ./cdn-invalidation-strategy.sh artist artist123
  
  # Invalidate asset with all related files
  ./cdn-invalidation-strategy.sh asset artist123 asset456
  
  # Invalidate all GLB files
  ./cdn-invalidation-strategy.sh type glb
  
  # Batch invalidation
  ./cdn-invalidation-strategy.sh batch paths.txt

EOF
}

main "$@"

