#!/bin/bash

# ============================================================================
# CloudFront CDN Deployment Script
# ============================================================================
# This script automates the deployment of CloudFront CDN for Artifact Armoury
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

ORIGIN_BUCKET="artifactarmoury-cdn-origin"
LOGS_BUCKET="artifactarmoury-cdn-logs"
STACK_NAME="artifactarmoury-cdn"
REGION="us-east-1"
DOMAIN_NAME="cdn.artifactarmoury.com"
ENVIRONMENT="${ENVIRONMENT:-production}"

# ============================================================================
# FUNCTIONS
# ============================================================================

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

check_aws_cli() {
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI not found. Please install it first."
        exit 1
    fi
    log_success "AWS CLI found"
}

check_aws_credentials() {
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured. Please run 'aws configure'"
        exit 1
    fi
    log_success "AWS credentials configured"
}

create_origin_bucket() {
    log_info "Creating S3 origin bucket..."
    
    if aws s3 ls "s3://$ORIGIN_BUCKET" 2>/dev/null; then
        log_warning "Bucket $ORIGIN_BUCKET already exists"
    else
        aws s3 mb "s3://$ORIGIN_BUCKET" --region "$REGION"
        log_success "Created bucket $ORIGIN_BUCKET"
    fi
    
    # Enable versioning
    aws s3api put-bucket-versioning \
        --bucket "$ORIGIN_BUCKET" \
        --versioning-configuration Status=Enabled
    log_success "Enabled versioning on $ORIGIN_BUCKET"
    
    # Block public access
    aws s3api put-public-access-block \
        --bucket "$ORIGIN_BUCKET" \
        --public-access-block-configuration \
        "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
    log_success "Blocked public access on $ORIGIN_BUCKET"
}

create_logs_bucket() {
    log_info "Creating S3 logs bucket..."
    
    if aws s3 ls "s3://$LOGS_BUCKET" 2>/dev/null; then
        log_warning "Bucket $LOGS_BUCKET already exists"
    else
        aws s3 mb "s3://$LOGS_BUCKET" --region "$REGION"
        log_success "Created bucket $LOGS_BUCKET"
    fi
    
    # Block public access
    aws s3api put-public-access-block \
        --bucket "$LOGS_BUCKET" \
        --public-access-block-configuration \
        "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
    log_success "Blocked public access on $LOGS_BUCKET"
}

deploy_cloudfront() {
    log_info "Deploying CloudFront distribution..."
    
    if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" 2>/dev/null; then
        log_warning "Stack $STACK_NAME already exists. Updating..."
        aws cloudformation update-stack \
            --stack-name "$STACK_NAME" \
            --template-body file://cloudfront-distribution.yaml \
            --parameters \
                ParameterKey=OriginBucket,ParameterValue="$ORIGIN_BUCKET" \
                ParameterKey=DomainName,ParameterValue="$DOMAIN_NAME" \
                ParameterKey=Environment,ParameterValue="$ENVIRONMENT" \
            --region "$REGION"
    else
        aws cloudformation create-stack \
            --stack-name "$STACK_NAME" \
            --template-body file://cloudfront-distribution.yaml \
            --parameters \
                ParameterKey=OriginBucket,ParameterValue="$ORIGIN_BUCKET" \
                ParameterKey=DomainName,ParameterValue="$DOMAIN_NAME" \
                ParameterKey=Environment,ParameterValue="$ENVIRONMENT" \
            --region "$REGION"
    fi
    
    log_success "CloudFormation stack deployment initiated"
}

wait_for_stack() {
    log_info "Waiting for CloudFormation stack to complete..."
    
    aws cloudformation wait stack-create-complete \
        --stack-name "$STACK_NAME" \
        --region "$REGION" 2>/dev/null || \
    aws cloudformation wait stack-update-complete \
        --stack-name "$STACK_NAME" \
        --region "$REGION" 2>/dev/null || true
    
    log_success "CloudFormation stack deployment completed"
}

get_distribution_info() {
    log_info "Retrieving distribution information..."
    
    DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`DistributionId`].OutputValue' \
        --output text)
    
    DISTRIBUTION_DOMAIN=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`DistributionDomain`].OutputValue' \
        --output text)
    
    OAI_ID=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`OriginAccessIdentityId`].OutputValue' \
        --output text)
    
    log_success "Distribution ID: $DISTRIBUTION_ID"
    log_success "Distribution Domain: $DISTRIBUTION_DOMAIN"
    log_success "Origin Access Identity: $OAI_ID"
}

sync_files() {
    log_info "Syncing files to S3 origin bucket..."
    
    read -p "Do you want to sync files from Backblaze B2? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        aws s3 sync s3://artifactbuilder s3://"$ORIGIN_BUCKET" \
            --source-region eu-central-003 \
            --region "$REGION" \
            --no-progress
        log_success "Files synced to origin bucket"
    else
        log_warning "Skipped file sync"
    fi
}

test_distribution() {
    log_info "Testing CloudFront distribution..."
    
    # Wait for distribution to be deployed
    log_info "Waiting for distribution to be deployed (this may take 5-10 minutes)..."
    sleep 30
    
    # Test with curl
    if curl -I "https://$DISTRIBUTION_DOMAIN" 2>/dev/null | grep -q "200\|403"; then
        log_success "CloudFront distribution is responding"
    else
        log_warning "Could not reach CloudFront distribution yet (still deploying)"
    fi
}

create_env_file() {
    log_info "Creating environment configuration file..."
    
    cat > .env.cloudfront << EOF
# CloudFront Configuration
CDN_ENABLED=true
CDN_URL=https://$DISTRIBUTION_DOMAIN
CLOUDFRONT_DISTRIBUTION_ID=$DISTRIBUTION_ID

# AWS Configuration
AWS_REGION=$REGION
S3_ORIGIN_BUCKET=$ORIGIN_BUCKET

# Environment
ENVIRONMENT=$ENVIRONMENT
EOF
    
    log_success "Created .env.cloudfront"
}

print_summary() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}          CloudFront Deployment Complete!                 ${BLUE}║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${GREEN}Distribution Information:${NC}"
    echo "  Distribution ID: $DISTRIBUTION_ID"
    echo "  Distribution Domain: $DISTRIBUTION_DOMAIN"
    echo "  Origin Bucket: $ORIGIN_BUCKET"
    echo "  Logs Bucket: $LOGS_BUCKET"
    echo ""
    echo -e "${GREEN}Next Steps:${NC}"
    echo "  1. Update DNS: Add CNAME record for $DOMAIN_NAME -> $DISTRIBUTION_DOMAIN"
    echo "  2. Update .env: Copy settings from .env.cloudfront"
    echo "  3. Sync files: aws s3 sync s3://artifactbuilder s3://$ORIGIN_BUCKET"
    echo "  4. Test: curl -I https://$DISTRIBUTION_DOMAIN/models/sample.glb"
    echo "  5. Monitor: Check CloudWatch metrics"
    echo ""
    echo -e "${YELLOW}Documentation:${NC}"
    echo "  - CLOUDFRONT_SETUP_GUIDE.md"
    echo "  - CLOUDFRONT_INTEGRATION_GUIDE.md"
    echo "  - CLOUDFRONT_MONITORING_GUIDE.md"
    echo "  - CLOUDFRONT_QUICK_REFERENCE.md"
    echo ""
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}     CloudFront CDN Deployment for Artifact Armoury       ${BLUE}║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    check_aws_cli
    check_aws_credentials
    
    create_origin_bucket
    create_logs_bucket
    deploy_cloudfront
    wait_for_stack
    get_distribution_info
    sync_files
    test_distribution
    create_env_file
    print_summary
}

main "$@"

