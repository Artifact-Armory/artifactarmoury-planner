/**
 * S3 Storage Service - Backblaze B2 Integration
 * 
 * Handles file operations with Backblaze B2 using S3-compatible API
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import logger from '../utils/logger';

// ============================================================================
// CONFIGURATION
// ============================================================================

const S3_ENDPOINT = process.env.S3_ENDPOINT || 'https://eu-central-003.backblazeb2.com';
const S3_REGION = process.env.S3_REGION || 'eu-central-003';
const S3_BUCKET = process.env.S3_BUCKET || 'artifactbuilder';
const S3_KEY_ID = process.env.S3_KEY_ID || '';
const S3_APPLICATION_KEY = process.env.S3_APPLICATION_KEY || '';

// ============================================================================
// S3 CLIENT INITIALIZATION
// ============================================================================

let s3Client: S3Client | null = null;

export function initializeS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  if (!S3_KEY_ID || !S3_APPLICATION_KEY) {
    throw new Error('S3_KEY_ID and S3_APPLICATION_KEY environment variables are required');
  }

  s3Client = new S3Client({
    region: S3_REGION,
    endpoint: S3_ENDPOINT,
    credentials: {
      accessKeyId: S3_KEY_ID,
      secretAccessKey: S3_APPLICATION_KEY,
    },
  });

  logger.info('S3 client initialized', { endpoint: S3_ENDPOINT, bucket: S3_BUCKET });
  return s3Client;
}

export function getS3Client(): S3Client {
  if (!s3Client) {
    return initializeS3Client();
  }
  return s3Client;
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/**
 * Upload file to S3
 */
export async function uploadFile(
  key: string,
  body: Buffer | Readable,
  contentType: string = 'application/octet-stream',
  metadata?: Record<string, string>
): Promise<{ key: string; url: string }> {
  try {
    const client = getS3Client();

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
    });

    await client.send(command);

    logger.info('File uploaded to S3', { key, bucket: S3_BUCKET });

    return {
      key,
      url: `${S3_ENDPOINT}/${S3_BUCKET}/${key}`,
    };
  } catch (error) {
    logger.error('Failed to upload file to S3', { error, key });
    throw error;
  }
}

/**
 * Download file from S3
 */
export async function downloadFile(key: string): Promise<Buffer> {
  try {
    const client = getS3Client();

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    });

    const response = await client.send(command);

    if (!response.Body) {
      throw new Error('Empty response body');
    }

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    const stream = response.Body as Readable;

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  } catch (error) {
    logger.error('Failed to download file from S3', { error, key });
    throw error;
  }
}

/**
 * Get file stream from S3
 */
export async function getFileStream(key: string): Promise<Readable> {
  try {
    const client = getS3Client();

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    });

    const response = await client.send(command);

    if (!response.Body) {
      throw new Error('Empty response body');
    }

    return response.Body as Readable;
  } catch (error) {
    logger.error('Failed to get file stream from S3', { error, key });
    throw error;
  }
}

/**
 * Delete file from S3
 */
export async function deleteFile(key: string): Promise<void> {
  try {
    const client = getS3Client();

    const command = new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    });

    await client.send(command);

    logger.info('File deleted from S3', { key });
  } catch (error) {
    logger.error('Failed to delete file from S3', { error, key });
    throw error;
  }
}

/**
 * Check if file exists in S3
 */
export async function fileExists(key: string): Promise<boolean> {
  try {
    const client = getS3Client();

    const command = new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    });

    await client.send(command);
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    logger.error('Error checking file existence in S3', { error, key });
    throw error;
  }
}

/**
 * Get file size from S3
 */
export async function getFileSize(key: string): Promise<number> {
  try {
    const client = getS3Client();

    const command = new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    });

    const response = await client.send(command);
    return response.ContentLength || 0;
  } catch (error) {
    logger.error('Failed to get file size from S3', { error, key });
    throw error;
  }
}

/**
 * Generate signed URL for file download
 */
export async function generateSignedUrl(
  key: string,
  expirationSeconds: number = 3600
): Promise<string> {
  try {
    const client = getS3Client();

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    });

    const url = await getSignedUrl(client, command, { expiresIn: expirationSeconds });

    logger.debug('Generated signed URL', { key, expiresIn: expirationSeconds });

    return url;
  } catch (error) {
    logger.error('Failed to generate signed URL', { error, key });
    throw error;
  }
}

/**
 * List files in S3 with prefix
 */
export async function listFiles(prefix: string, maxKeys: number = 1000): Promise<string[]> {
  try {
    const client = getS3Client();

    const command = new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: prefix,
      MaxKeys: maxKeys,
    });

    const response = await client.send(command);

    return (response.Contents || []).map((obj) => obj.Key || '').filter(Boolean);
  } catch (error) {
    logger.error('Failed to list files from S3', { error, prefix });
    throw error;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  initializeS3Client,
  getS3Client,
  uploadFile,
  downloadFile,
  getFileStream,
  deleteFile,
  fileExists,
  getFileSize,
  generateSignedUrl,
  listFiles,
};

