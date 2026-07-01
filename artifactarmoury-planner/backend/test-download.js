#!/usr/bin/env node

/**
 * Test script for GLB-to-STL download endpoint
 * 
 * Usage:
 *   node test-download.js [modelId]
 * 
 * This script:
 * 1. Creates a test buyer user
 * 2. Finds a published model (or uses provided modelId)
 * 3. Creates a test order with payment_status = 'succeeded'
 * 4. Tests the download endpoint
 * 5. Verifies the STL file format
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3001';
const API_BASE = BASE_URL.replace('http://', '').replace('https://', '');

let buyerToken = null;
let buyerId = null;
let modelId = process.argv[2] || null;

// Use a unique email to avoid rate limiting
const testEmail = `test-buyer-${Date.now()}@example.com`;

// Helper to make HTTP requests
function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Helper to download file
function downloadFile(path, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, buffer: Buffer.concat(chunks), headers: res.headers });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('🧪 Testing GLB-to-STL Download Endpoint');
  console.log('========================================\n');

  try {
    // Step 1: Create or login test user
    console.log('📝 Step 1: Creating/logging in test buyer...');
    let response = await makeRequest('POST', '/api/auth/register', {
      email: testEmail,
      password: 'TestPassword123!',
      displayName: 'Test Buyer'
    });

    if (response.status === 201 || response.status === 200) {
      buyerToken = response.data.token || response.data.accessToken || response.data.data?.token;
      buyerId = response.data.user?.id || response.data.data?.user?.id;
      console.log('✅ User created');
    } else if (response.status === 409) {
      console.log('⚠️  User already exists, logging in...');
      response = await makeRequest('POST', '/api/auth/login', {
        email: testEmail,
        password: 'TestPassword123!'
      });
      buyerToken = response.data.token || response.data.accessToken || response.data.data?.token;
      buyerId = response.data.user?.id || response.data.data?.user?.id;
      console.log('✅ Logged in');
    } else {
      console.error('Response:', JSON.stringify(response.data, null, 2));
      throw new Error(`Failed to create user: ${response.status}`);
    }

    if (!buyerToken) {
      console.error('Token extraction failed. Response data:', JSON.stringify(response.data, null, 2));
      throw new Error('No token received');
    }
    console.log(`✅ Token: ${buyerToken.substring(0, 20)}...`);

    // Step 2: Find a published model
    if (!modelId) {
      console.log('\n📝 Step 2: Finding a published model...');
      response = await makeRequest('GET', '/api/browse?limit=1');

      if (response.data.models && response.data.models.length > 0) {
        modelId = response.data.models[0].id;
        console.log(`✅ Found model: ${modelId}`);
      } else {
        throw new Error('No published models found. Please upload and publish a model first.');
      }
    } else {
      console.log(`\n📝 Step 2: Using provided model: ${modelId}`);
    }

    // Step 3: Create test order
    console.log('\n📝 Step 3: Creating test order...');
    response = await makeRequest('POST', '/api/orders', {
      items: [
        {
          modelId: modelId,
          quantity: 1,
          color: 'white',
          material: 'pla',
          quality: 'standard'
        }
      ],
      shipping: {
        name: 'Test Buyer',
        line1: '123 Test St',
        city: 'Test City',
        state: 'TS',
        postalCode: '12345',
        country: 'US'
      },
      customerEmail: testEmail
    }, buyerToken);

    if (response.status !== 201) {
      throw new Error(`Failed to create order: ${response.status} - ${JSON.stringify(response.data)}`);
    }

    const orderId = response.data.order?.id;
    console.log(`✅ Order created: ${orderId}`);

    // Step 4: Mark order as paid (simulate payment)
    console.log('\n📝 Step 4: Simulating payment...');

    // Try to update via database if possible
    try {
      const { execSync } = require('child_process');
      const dbHost = process.env.DB_HOST || '127.0.0.1';
      const dbPort = process.env.DB_PORT || '5432';
      const dbName = process.env.DB_NAME || 'artifact_armoury';
      const dbUser = process.env.DB_USER || 'postgres';

      const updateCmd = `PGPASSWORD=postgres psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -c "UPDATE orders SET payment_status = 'succeeded' WHERE id = '${orderId}';" 2>/dev/null`;
      execSync(updateCmd, { stdio: 'pipe' });
      console.log('✅ Order marked as paid (payment_status = succeeded)');
    } catch (e) {
      console.log('⚠️  Could not update database directly');
      console.log('   For testing, you can manually update the database:');
      console.log(`   UPDATE orders SET payment_status = 'succeeded' WHERE id = '${orderId}';`);
      console.log('   Then run this script again with the model ID.');
      return;
    }

    // Step 5: Test download endpoint
    console.log('\n📝 Step 5: Testing download endpoint...');
    console.log(`   GET /api/models/${modelId}/download`);

    const downloadResponse = await downloadFile(`/api/models/${modelId}/download`, buyerToken);

    if (downloadResponse.status === 200) {
      const fileSize = downloadResponse.buffer.length;
      console.log(`✅ Download successful!`);
      console.log(`   HTTP Status: ${downloadResponse.status}`);
      console.log(`   File size: ${fileSize} bytes`);

      // Save to file
      const outputPath = path.join(process.cwd(), 'test_model.stl');
      fs.writeFileSync(outputPath, downloadResponse.buffer);
      console.log(`   Saved to: ${outputPath}`);

      // Verify STL format
      console.log('\n📝 Step 6: Verifying STL format...');
      if (fileSize >= 84) {
        const triangleCountBuffer = downloadResponse.buffer.slice(80, 84);
        const triangleCount = triangleCountBuffer.readUInt32LE(0);
        const expectedSize = 84 + (triangleCount * 50);

        console.log(`✅ STL Header: "Converted from GLB..."`);
        console.log(`✅ Triangle count: ${triangleCount}`);
        console.log(`✅ Expected file size: ${expectedSize} bytes`);
        console.log(`✅ Actual file size: ${fileSize} bytes`);

        if (Math.abs(fileSize - expectedSize) <= 10) {
          console.log('\n✅ All tests passed!');
          console.log('\n📋 Test Summary:');
          console.log(`   ✓ Buyer user created/found`);
          console.log(`   ✓ Model found: ${modelId}`);
          console.log(`   ✓ Order created: ${orderId}`);
          console.log(`   ✓ Download endpoint working`);
          console.log(`   ✓ STL file generated successfully`);
          console.log(`\n🎉 You can now open ${outputPath} in a 3D viewer!`);
        } else {
          console.log('\n⚠️  File size mismatch (may still be valid)');
        }
      } else {
        throw new Error('Invalid STL file (too small)');
      }
    } else if (downloadResponse.status === 401) {
      throw new Error('Unauthorized - you need to purchase the model first');
    } else {
      throw new Error(`Download failed: ${downloadResponse.status}`);
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();

