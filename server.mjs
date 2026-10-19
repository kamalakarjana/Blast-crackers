import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const projectRoot = process.cwd();
const distDirectory = resolve(projectRoot, 'dist');
const builtImageDirectory = resolve(distDirectory, 'product-images');
const storageDirectory = resolve(process.env.PHOTO_STORAGE_DIR || resolve(projectRoot, 'data'));
const uploadDirectory = resolve(storageDirectory, 'product-images');
const manifestPath = resolve(storageDirectory, 'productImages.json');
const rewardTiersPath = resolve(storageDirectory, 'rewardTiers.json');
const customersPath = resolve(storageDirectory, 'customers.json');
const sourceManifestPath = resolve(projectRoot, 'src', 'productImages.json');
const sourceRewardTiersPath = resolve(projectRoot, 'src', 'rewardTiers.json');
const uploadToken = process.env.PHOTO_UPLOAD_TOKEN || '';
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const maximumProductId = 102;
const maximumImageBytes = 1_500_000;
const maximumRequestBytes = 2_100_000;
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

function isAuthorized(request) {
  if (!uploadToken) return false;
  const authorization = request.headers.authorization || '';
  const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const expected = Buffer.from(uploadToken);
  const supplied = Buffer.from(suppliedToken);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function isSecureUpload(request) {
  const remoteAddress = request.socket.remoteAddress || '';
  const isLoopback = remoteAddress === '::1'
    || remoteAddress === '127.0.0.1'
    || remoteAddress.startsWith('127.')
    || remoteAddress.startsWith('::ffff:127.');
  const forwardedProto = request.headers['x-forwarded-proto'];
  if (forwardedProto) {
    return isLoopback && forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
  }
  return isLoopback;
}

function normalizeCustomer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.consented !== true) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const phone = typeof value.phone === 'string' ? value.phone.trim() : '';
  const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
  if (name.length < 2 || name.length > 100) return null;
  if (!/^[0-9]{10}$/.test(phone)) return null;
  if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return null;
  return { name, phone, email };
}

async function readCustomers() {
  try {
    const value = JSON.parse(await readFile(customersPath, 'utf8'));
    if (!Array.isArray(value) || value.length > 10_000) {
      throw new Error('Saved customer registrations are invalid.');
    }
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function saveCustomers(customers) {
  await mkdir(storageDirectory, { recursive: true });
  const temporaryPath = `${customersPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(customers, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, customersPath);
}

async function handleCustomersApi(request, response) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST to register or GET to view registrations.' });
    return;
  }
  if (!isSecureUpload(request)) {
    sendJson(response, 400, { error: 'Customer registration and records require HTTPS or a local SSH tunnel.' });
    return;
  }
  if (request.method === 'GET') {
    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: 'Enter the server photo upload token to view customer registrations.' });
      return;
    }
    const customers = await readCustomers();
    sendJson(response, 200, { customers });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(request));
  } catch (error) {
    sendJson(response, error.statusCode || 400, { error: error.statusCode ? error.message : 'Registration details must be valid JSON.' });
    return;
  }
  const customer = normalizeCustomer(payload);
  if (!customer) {
    sendJson(response, 400, { error: 'Enter a valid name, 10-digit mobile number, and optional email address.' });
    return;
  }
  const customers = await readCustomers();
  if (customers.length >= 10_000) {
    sendJson(response, 507, { error: 'Customer registrations are full. Contact the site administrator.' });
    return;
  }
  const timestamp = new Date().toISOString();
  customers.push({ id: randomUUID(), ...customer, registeredAt: timestamp, consentedAt: timestamp });
  await saveCustomers(customers);
  sendJson(response, 201, { saved: true });
}

async function readManifest(path) {
  try {
    const contents = await readFile(path, 'utf8');
    const value = JSON.parse(contents);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function getPublicImages() {
  const [builtIn, saved] = await Promise.all([
    readManifest(sourceManifestPath),
    readManifest(manifestPath),
  ]);
  const merged = { ...builtIn };
  for (const [id, image] of Object.entries(saved)) {
    if (image === null) merged[id] = null;
    else if (typeof image === 'string') merged[id] = image;
  }
  return merged;
}

async function writeManifest(manifest) {
  await mkdir(storageDirectory, { recursive: true });
  const temporaryPath = `${manifestPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, manifestPath);
}

function isRewardTierList(value) {
  if (!Array.isArray(value) || value.length > 30) return false;
  const ids = new Set();
  let previousThreshold = 0;

  for (const tier of value) {
    if (!tier || typeof tier !== 'object' || Array.isArray(tier)) return false;
    if (
      typeof tier.id !== 'string'
      || !/^[a-zA-Z0-9_-]{1,80}$/.test(tier.id)
      || ids.has(tier.id)
      || !Number.isSafeInteger(tier.threshold)
      || tier.threshold <= previousThreshold
      || !Number.isSafeInteger(tier.candleValue)
      || tier.candleValue < 0
      || !Number.isSafeInteger(tier.crackerValue)
      || tier.crackerValue < 0
      || typeof tier.bonusPack !== 'string'
      || tier.bonusPack.length > 100
      || typeof tier.enabled !== 'boolean'
    ) return false;
    ids.add(tier.id);
    previousThreshold = tier.threshold;
  }
  return true;
}

async function getRewardTiers() {
  let tiers;
  try {
    tiers = JSON.parse(await readFile(rewardTiersPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    tiers = JSON.parse(await readFile(sourceRewardTiersPath, 'utf8'));
  }
  if (!isRewardTierList(tiers)) throw new Error('Saved reward tiers are invalid.');
  return tiers;
}

async function saveRewardTiers(tiers) {
  await mkdir(storageDirectory, { recursive: true });
  const temporaryPath = `${rewardTiersPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(tiers, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, rewardTiersPath);
}

async function readRequestBody(request) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maximumRequestBytes) {
      const error = new Error('Request exceeds the upload size limit.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function serveProductImage(response, productId, extension) {
  for (const directory of [uploadDirectory, builtImageDirectory]) {
    const imagePath = resolve(directory, `${productId}.${extension}`);
    try {
      const image = await readFile(imagePath);
      response.writeHead(200, {
        'Cache-Control': 'public, max-age=300',
        'Content-Type': mimeTypes[`.${extension}`],
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(image);
      return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

async function serveStatic(response, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(distDirectory, relativePath);
  if (filePath !== distDirectory && !filePath.startsWith(`${distDirectory}${sep}`)) {
    sendJson(response, 400, { error: 'Invalid file path.' });
    return;
  }

  try {
    const contents = await readFile(filePath);
    response.writeHead(200, {
      'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
      'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(contents);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const index = await readFile(resolve(distDirectory, 'index.html'));
      response.writeHead(200, { 'Content-Type': mimeTypes['.html'], 'Cache-Control': 'no-cache' });
      response.end(index);
      return;
    }
    throw error;
  }
}

async function handleImageApi(request, response, url) {
  if (request.method === 'GET') {
    sendJson(response, 200, await getPublicImages());
    return;
  }
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    sendJson(response, 405, { error: 'Use GET, POST, or DELETE for product photos.' });
    return;
  }
  if (!uploadToken) {
    sendJson(response, 503, { error: 'Photo uploads are not configured on this server.' });
    return;
  }
  if (!isSecureUpload(request)) {
    sendJson(response, 400, { error: 'Use HTTPS or an SSH tunnel to upload product photos.' });
    return;
  }
  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: 'Invalid photo upload token.' });
    return;
  }

  let payload = {};
  if (request.method === 'POST') {
    try {
      const parsed = JSON.parse(await readRequestBody(request));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        sendJson(response, 400, { error: 'Request body must be a JSON object.' });
        return;
      }
      payload = parsed;
    } catch (error) {
      sendJson(response, error.statusCode || 400, { error: error.statusCode ? error.message : 'Request body must be valid JSON.' });
      return;
    }
  }
  const productId = Number(payload.productId ?? url.searchParams.get('productId'));
  if (!Number.isInteger(productId) || productId < 1 || productId > maximumProductId) {
    sendJson(response, 400, { error: 'Invalid catalog product ID.' });
    return;
  }

  const savedManifest = await readManifest(manifestPath);
  if (request.method === 'DELETE') {
    await rm(resolve(uploadDirectory, `${productId}.jpg`), { force: true });
    savedManifest[String(productId)] = null;
    await writeManifest(savedManifest);
    sendJson(response, 200, { removed: true });
    return;
  }

  if (typeof payload.data !== 'string') {
    sendJson(response, 400, { error: 'Upload a valid JPEG image.' });
    return;
  }
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/.exec(payload.data);
  if (!match) {
    sendJson(response, 400, { error: 'Upload a valid JPEG image.' });
    return;
  }
  const image = Buffer.from(match[1], 'base64');
  if (image.length < 3 || image.length > maximumImageBytes || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) {
    sendJson(response, 413, { error: 'JPEG image is invalid or exceeds 1.5 MB.' });
    return;
  }

  await mkdir(uploadDirectory, { recursive: true });
  const imagePath = resolve(uploadDirectory, `${productId}.jpg`);
  const temporaryImagePath = `${imagePath}.tmp`;
  await writeFile(temporaryImagePath, image);
  await rename(temporaryImagePath, imagePath);
  const imageUrl = `/product-images/${productId}.jpg`;
  savedManifest[String(productId)] = imageUrl;
  await writeManifest(savedManifest);
  sendJson(response, 200, { image: imageUrl });
}

async function handleRewardTiersApi(request, response) {
  if (request.method === 'GET') {
    sendJson(response, 200, await getRewardTiers());
    return;
  }
  if (request.method !== 'PUT') {
    sendJson(response, 405, { error: 'Use GET to list or PUT to update reward tiers.' });
    return;
  }
  if (!uploadToken) {
    sendJson(response, 503, { error: 'Reward updates are not configured on this server.' });
    return;
  }
  if (!isSecureUpload(request)) {
    sendJson(response, 400, { error: 'Use HTTPS or an SSH tunnel to update rewards.' });
    return;
  }
  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: 'Invalid photo upload token.' });
    return;
  }

  let body;
  try {
    body = JSON.parse(await readRequestBody(request));
  } catch (error) {
    sendJson(response, error.statusCode || 400, { error: error.statusCode ? error.message : 'Request body must contain valid JSON.' });
    return;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !isRewardTierList(body.tiers)) {
    sendJson(response, 400, { error: 'Reward tiers must be valid, uniquely ordered entries.' });
    return;
  }
  await saveRewardTiers(body.tiers);
  sendJson(response, 200, { tiers: body.tiers });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/api/product-images') {
      await handleImageApi(request, response, url);
      return;
    }
    if (url.pathname === '/api/reward-tiers') {
      await handleRewardTiersApi(request, response);
      return;
    }
    if (url.pathname === '/api/customers') {
      await handleCustomersApi(request, response);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    const imageMatch = /^\/product-images\/([1-9]\d{0,2})\.(jpg|webp)$/.exec(url.pathname);
    if (imageMatch) {
      const productId = Number(imageMatch[1]);
      if (productId > maximumProductId || !(await serveProductImage(response, productId, imageMatch[2]))) {
        sendJson(response, 404, { error: 'Product image not found.' });
      }
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    console.error('Production request failed:', error);
    if (!response.headersSent) sendJson(response, 500, { error: 'The server could not complete the request.' });
    else response.destroy();
  }
});

server.listen(port, host, () => {
  console.log(`Production site listening at http://${host}:${port}`);
  console.log(uploadToken
    ? 'Product photo uploads are enabled.'
    : 'Product photo uploads are disabled; set PHOTO_UPLOAD_TOKEN to enable them.');
});
