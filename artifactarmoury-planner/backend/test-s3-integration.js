#!/usr/bin/env node

/**
 * S3 Integration Test Script
 * Tests Backblaze B2 S3 connectivity and basic operations
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const S3_ENDPOINT = process.env.S3_ENDPOINT || 'https://eu-central-003.backblazeb2.com';
const S3_REGION = process.env.S3_REGION || 'eu-central-003';
const S3_BUCKET = process.env.S3_BUCKET || 'Artifactbuilder';
const S3_KEY_ID = process.env.S3_KEY_ID;
const S3_APPLICATION_KEY = process.env.S3_APPLICATION_KEY;
const STORAGE_MODE = process.env.STORAGE_MODE || 'local';

// ============================================================================
// TESTS
// ============================================================================

async function runTests() {
  console.log('\n🧪 S3 Integration Test Suite');
  console.log('=====================================\n');

  // Check environment variables
  console.log('📋 Configuration Check:');
  console.log(`  Storage Mode: ${STORAGE_MODE}`);
  console.log(`  S3 Endpoint: ${S3_ENDPOINT}`);
  console.log(`  S3 Region: ${S3_REGION}`);
  console.log(`  S3 Bucket: ${S3_BUCKET}`);
  console.log(`  S3 Key ID: ${S3_KEY_ID ? '✓ Set' : '✗ Missing'}`);
  console.log(`  S3 App Key: ${S3_APPLICATION_KEY ? '✓ Set' : '✗ Missing'}\n`);

  if (!S3_KEY_ID || !S3_APPLICATION_KEY) {
    console.error('❌ Error: S3_KEY_ID and S3_APPLICATION_KEY must be set in .env\n');
    process.exit(1);
  }

  if (STORAGE_MODE === 'local') {
    console.warn('⚠️  Warning: STORAGE_MODE is set to "local". Set to "s3" or "hybrid" to test S3.\n');
    process.exit(0);
  }

  try {
    // Import S3 storage service
    const s3Storage = require('./dist/services/s3Storage');

    console.log('✓ S3 Storage module loaded\n');

    // Test 1: Initialize S3 Client
    console.log('Test 1: Initialize S3 Client');
    try {
      const client = s3Storage.initializeS3Client();
      console.log('✓ S3 client initialized successfully\n');
    } catch (error) {
      console.error('✗ Failed to initialize S3 client:', error.message, '\n');
      process.exit(1);
    }

    // Test 2: Upload Test File
    console.log('Test 2: Upload Test File');
    const testKey = `test/${Date.now()}-test-file.txt`;
    const testContent = Buffer.from('Hello from Artifact Armoury S3 Integration Test!');

    try {
      const result = await s3Storage.uploadFile(testKey, testContent, 'text/plain');
      console.log(`✓ File uploaded successfully`);
      console.log(`  Key: ${result.key}`);
      console.log(`  URL: ${result.url}\n`);
    } catch (error) {
      console.error('✗ Failed to upload file:', error.message, '\n');
      process.exit(1);
    }

    // Test 3: Check File Exists
    console.log('Test 3: Check File Exists');
    try {
      const exists = await s3Storage.fileExists(testKey);
      if (exists) {
        console.log('✓ File exists in S3\n');
      } else {
        console.error('✗ File not found in S3\n');
        process.exit(1);
      }
    } catch (error) {
      console.error('✗ Failed to check file existence:', error.message, '\n');
      process.exit(1);
    }

    // Test 4: Get File Size
    console.log('Test 4: Get File Size');
    try {
      const size = await s3Storage.getFileSize(testKey);
      console.log(`✓ File size: ${size} bytes\n`);
    } catch (error) {
      console.error('✗ Failed to get file size:', error.message, '\n');
      process.exit(1);
    }

    // Test 5: Download File
    console.log('Test 5: Download File');
    try {
      const buffer = await s3Storage.downloadFile(testKey);
      const content = buffer.toString();
      if (content === 'Hello from Artifact Armoury S3 Integration Test!') {
        console.log('✓ File downloaded and content verified\n');
      } else {
        console.error('✗ Downloaded content does not match\n');
        process.exit(1);
      }
    } catch (error) {
      console.error('✗ Failed to download file:', error.message, '\n');
      process.exit(1);
    }

    // Test 6: Generate Signed URL
    console.log('Test 6: Generate Signed URL');
    try {
      const signedUrl = await s3Storage.generateSignedUrl(testKey, 3600);
      console.log(`✓ Signed URL generated`);
      console.log(`  URL: ${signedUrl.substring(0, 80)}...\n`);
    } catch (error) {
      console.error('✗ Failed to generate signed URL:', error.message, '\n');
      process.exit(1);
    }

    // Test 7: List Files
    console.log('Test 7: List Files');
    try {
      const files = await s3Storage.listFiles('test/', 10);
      console.log(`✓ Listed ${files.length} files in test/ prefix\n`);
    } catch (error) {
      console.error('✗ Failed to list files:', error.message, '\n');
      process.exit(1);
    }

    // Test 8: Delete File
    console.log('Test 8: Delete File');
    try {
      await s3Storage.deleteFile(testKey);
      console.log('✓ File deleted successfully\n');
    } catch (error) {
      console.error('✗ Failed to delete file:', error.message, '\n');
      process.exit(1);
    }

    // Test 9: Verify Deletion
    console.log('Test 9: Verify Deletion');
    try {
      const exists = await s3Storage.fileExists(testKey);
      if (!exists) {
        console.log('✓ File confirmed deleted\n');
      } else {
        console.error('✗ File still exists after deletion\n');
        process.exit(1);
      }
    } catch (error) {
      console.error('✗ Failed to verify deletion:', error.message, '\n');
      process.exit(1);
    }

    // All tests passed
    console.log('✅ All S3 Integration Tests Passed!');
    console.log('=====================================\n');
    console.log('Your Backblaze B2 S3 integration is working correctly.\n');
    process.exit(0);

  } catch (error) {
    console.error('❌ Test suite error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
runTests();

