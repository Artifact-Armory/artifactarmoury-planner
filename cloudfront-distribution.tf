# ============================================================================
# CloudFront CDN Distribution for Artifact Armoury Planner
# ============================================================================

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ============================================================================
# VARIABLES
# ============================================================================

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "origin_bucket" {
  description = "S3 bucket name for CloudFront origin"
  type        = string
  default     = "artifactarmoury-cdn-origin"
}

variable "custom_domain" {
  description = "Custom domain name for CloudFront"
  type        = string
  default     = "cdn.artifactarmoury.com"
}

variable "acm_certificate_arn" {
  description = "ARN of ACM certificate for custom domain"
  type        = string
  default     = ""
}

# ============================================================================
# ORIGIN ACCESS IDENTITY
# ============================================================================

resource "aws_cloudfront_origin_access_identity" "oai" {
  comment = "OAI for Artifact Armoury CDN - ${var.environment}"
}

# ============================================================================
# S3 BUCKET POLICY
# ============================================================================

resource "aws_s3_bucket_policy" "cdn_bucket_policy" {
  bucket = var.origin_bucket

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = aws_cloudfront_origin_access_identity.oai.iam_arn
        }
        Action   = "s3:GetObject"
        Resource = "arn:aws:s3:::${var.origin_bucket}/*"
      },
      {
        Effect = "Allow"
        Principal = {
          AWS = aws_cloudfront_origin_access_identity.oai.iam_arn
        }
        Action   = "s3:ListBucket"
        Resource = "arn:aws:s3:::${var.origin_bucket}"
      }
    ]
  })
}

# ============================================================================
# CLOUDFRONT DISTRIBUTION
# ============================================================================

resource "aws_cloudfront_distribution" "cdn" {
  origin {
    domain_name = "${var.origin_bucket}.s3.${var.aws_region}.amazonaws.com"
    origin_id   = "S3Origin"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.oai.cloudfront_access_identity_path
    }

    origin_shield {
      enabled              = true
      origin_shield_region = var.aws_region
    }
  }

  # ========================================================================
  # DEFAULT CACHE BEHAVIOR (Static Assets)
  # ========================================================================

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3Origin"

    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"  # Managed-CachingOptimized
    response_headers_policy_id = "efc63b51-395f-45e7-9675-021797e2fb94"  # Managed-SecurityHeadersPolicy

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
      headers = ["Origin", "Access-Control-Request-Headers", "Access-Control-Request-Method"]
    }
  }

  # ========================================================================
  # CACHE BEHAVIORS (3D Models, Images, Thumbnails)
  # ========================================================================

  # 3D Models
  ordered_cache_behavior {
    path_pattern     = "models/*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3Origin"

    compress               = true
    viewer_protocol_policy = "https-only"

    cache_policy_id = "4135ea3d-c35d-46eb-81d7-reeSJHXJ1EY"  # Managed-CachingDisabled

    forwarded_values {
      query_string = true
      cookies {
        forward = "none"
      }
    }
  }

  # Images
  ordered_cache_behavior {
    path_pattern     = "images/*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3Origin"

    compress               = true
    viewer_protocol_policy = "https-only"

    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"  # Managed-CachingOptimized

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  # Thumbnails
  ordered_cache_behavior {
    path_pattern     = "thumbnails/*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3Origin"

    compress               = true
    viewer_protocol_policy = "https-only"

    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"  # Managed-CachingOptimized

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  # ========================================================================
  # DISTRIBUTION SETTINGS
  # ========================================================================

  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  comment             = "Artifact Armoury CDN - ${var.environment}"
  default_root_object = ""

  # Custom domain
  aliases = var.acm_certificate_arn != "" ? [var.custom_domain] : []

  # Viewer certificate
  viewer_certificate {
    cloudfront_default_certificate = var.acm_certificate_arn == "" ? true : false
    acm_certificate_arn            = var.acm_certificate_arn != "" ? var.acm_certificate_arn : null
    ssl_support_method             = var.acm_certificate_arn != "" ? "sni-only" : null
    minimum_protocol_version       = var.acm_certificate_arn != "" ? "TLSv1.2_2021" : null
  }

  # Logging
  logging_config {
    include_cookies = false
    bucket          = "${var.origin_bucket}-logs.s3.${var.aws_region}.amazonaws.com"
    prefix          = "cloudfront-logs/"
  }

  # Restrictions
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = {
    Environment = var.environment
    Project     = "ArtifactArmoury"
    ManagedBy   = "Terraform"
  }
}

# ============================================================================
# OUTPUTS
# ============================================================================

output "distribution_id" {
  description = "CloudFront Distribution ID"
  value       = aws_cloudfront_distribution.cdn.id
}

output "distribution_domain" {
  description = "CloudFront Distribution Domain Name"
  value       = aws_cloudfront_distribution.cdn.domain_name
}

output "oai_id" {
  description = "Origin Access Identity ID"
  value       = aws_cloudfront_origin_access_identity.oai.id
}

output "custom_domain" {
  description = "Custom Domain Name"
  value       = var.acm_certificate_arn != "" ? var.custom_domain : "Not configured"
}

