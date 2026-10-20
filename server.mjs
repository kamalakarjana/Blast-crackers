import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { extname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const projectRoot = process.cwd();
const distDirectory = resolve(projectRoot, 'dist');
const builtImageDirectory = resolve(distDirectory, 'product-images');
const storageDirectory = resolve(process.env.PHOTO_STORAGE_DIR || resolve(projectRoot, 'data'));
const uploadDirectory = resolve(storageDirectory, 'product-images');
const manifestPath = resolve(storageDirectory, 'productImages.json');
const rewardTiersPath = resolve(storageDirectory, 'rewardTiers.json');
const customersPath = resolve(storageDirectory, 'customers.json');
const cartsPath = resolve(storageDirectory, 'customerCarts.json');
const sourceManifestPath = resolve(projectRoot, 'src', 'productImages.json');
const sourceRewardTiersPath = resolve(projectRoot, 'src', 'rewardTiers.json');
const uploadToken = process.env.PHOTO_UPLOAD_TOKEN || '';
const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || '';
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const tlsCertificatePath = process.env.TLS_CERT_FILE || '';
const tlsPrivateKeyPath = process.env.TLS_KEY_FILE || '';
const maximumProductId = 102;
const maximumImageBytes = 1_500_000;
const maximumRequestBytes = 2_100_000;
const derivePassword = promisify(scryptCallback);
const sessions = new Map();
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const passwordSaltBytes = 16;
const passwordHashBytes = 64;
const customerSessionCookie = 'slv_customer_session';
const adminSessionCookie = 'slv_admin_session';
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

function readCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([name]) => name));
}

function getSession(request, kind) {
  const cookieName = kind === 'admin' ? adminSessionCookie : customerSessionCookie;
  const token = readCookies(request)[cookieName];
  const session = token ? sessions.get(token) : null;
  if (!session || session.kind !== kind || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return session;
}

function setSessionCookie(response, kind, token, request) {
  const cookieName = kind === 'admin' ? adminSessionCookie : customerSessionCookie;
  const secure = Boolean(request.socket.encrypted) || request.headers['x-forwarded-proto'] === 'https';
  response.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetimeMs / 1000}${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(response, kind, request) {
  const cookieName = kind === 'admin' ? adminSessionCookie : customerSessionCookie;
  const secure = Boolean(request.socket.encrypted) || request.headers['x-forwarded-proto'] === 'https';
  response.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
}

function createSession(kind, userId = '') {
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, { kind, userId, expiresAt: Date.now() + sessionLifetimeMs });
  return token;
}

function sessionUser(customer) {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    welcomeOfferAvailable: !customer.welcomeOfferRedeemedAt,
  };
}

function isAuthorized(request) {
  const authorization = request.headers.authorization || '';
  const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const expected = Buffer.from(uploadToken);
  const supplied = Buffer.from(suppliedToken);
  const tokenAuthorized = Boolean(uploadToken)
    && expected.length === supplied.length
    && timingSafeEqual(expected, supplied);
  return tokenAuthorized || Boolean(getSession(request, 'admin'));
}

function isSecureUpload(request) {
  if (request.socket.encrypted) return true;
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

async function parseJsonBody(request, response, message) {
  try {
    return JSON.parse(await readRequestBody(request));
  } catch (error) {
    sendJson(response, error.statusCode || 400, { error: error.statusCode ? error.message : message });
    return null;
  }
}

function normalizeCustomer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.consented !== true) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const phone = typeof value.phone === 'string' ? value.phone.trim() : '';
  const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
  const password = typeof value.password === 'string' ? value.password : '';
  if (name.length < 2 || name.length > 100) return null;
  if (!/^[0-9]{10}$/.test(phone)) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (password.length < 10 || password.length > 128) return null;
  return { name, phone, email, password };
}

async function handleCustomerAuth(request, response, action) {
  if (!isSecureUpload(request)) {
    sendJson(response, 400, { error: 'Sign-in and registration require HTTPS or a local SSH tunnel.' });
    return;
  }
  if (action === 'session' && request.method === 'GET') {
    const session = getSession(request, 'customer');
    if (!session) {
      sendJson(response, 200, { user: null });
      return;
    }
    const customers = await readCustomers();
    const customer = customers.find((item) => item.id === session.userId);
    if (!customer) {
      sendJson(response, 200, { user: null });
      return;
    }
    sendJson(response, 200, { user: sessionUser(customer) });
    return;
  }
  if (action === 'logout' && request.method === 'POST') {
    const sessionToken = readCookies(request)[customerSessionCookie];
    if (sessionToken) sessions.delete(sessionToken);
    clearSessionCookie(response, 'customer', request);
    sendJson(response, 200, { signedOut: true });
    return;
  }
  if (request.method !== 'POST' || (action !== 'register' && action !== 'login')) {
    sendJson(response, 405, { error: 'Unsupported customer authentication request.' });
    return;
  }
  const payload = await parseJsonBody(request, response, 'Account details must be valid JSON.');
  if (!payload) return;
  const customers = await readCustomers();
  let customer;
  if (action === 'register') {
    const normalized = normalizeCustomer(payload);
    if (!normalized) {
      sendJson(response, 400, { error: 'Enter your name, 10-digit mobile, valid email, password (at least 10 characters), and consent.' });
      return;
    }
    const existingCustomerIndex = customers.findIndex((item) => item.email === normalized.email);
    const existingCustomer = existingCustomerIndex >= 0 ? customers[existingCustomerIndex] : null;
    if (existingCustomer?.passwordHash) {
      sendJson(response, 409, { error: 'An account with this email already exists. Sign in instead.' });
      return;
    }
    if (customers.length >= 10_000) {
      sendJson(response, 507, { error: 'Customer registrations are full. Contact the site administrator.' });
      return;
    }
    const salt = randomBytes(passwordSaltBytes);
    const passwordHash = await derivePassword(normalized.password, salt, passwordHashBytes);
    const timestamp = new Date().toISOString();
    customer = {
      id: randomUUID(),
      name: normalized.name,
      phone: normalized.phone,
      email: normalized.email,
      passwordSalt: salt.toString('hex'),
      passwordHash: passwordHash.toString('hex'),
      registeredAt: existingCustomer?.registeredAt || timestamp,
      consentedAt: timestamp,
    };
    if (existingCustomerIndex >= 0) customers[existingCustomerIndex] = customer;
    else customers.push(customer);
    await saveCustomers(customers);
  } else {
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const password = typeof payload.password === 'string' ? payload.password : '';
    customer = customers.find((item) => item.email === email && item.passwordSalt && item.passwordHash);
    if (!customer || password.length > 128) {
      sendJson(response, 401, { error: 'Email or password is incorrect.' });
      return;
    }
    const suppliedHash = await derivePassword(password, Buffer.from(customer.passwordSalt, 'hex'), passwordHashBytes);
    const storedHash = Buffer.from(customer.passwordHash, 'hex');
    if (suppliedHash.length !== storedHash.length || !timingSafeEqual(suppliedHash, storedHash)) {
      sendJson(response, 401, { error: 'Email or password is incorrect.' });
      return;
    }
  }
  const token = createSession('customer', customer.id);
  setSessionCookie(response, 'customer', token, request);
  sendJson(response, action === 'register' ? 201 : 200, { user: sessionUser(customer) });
}

async function handleAdminAuth(request, response, action) {
  if (!isSecureUpload(request)) {
    sendJson(response, 400, { error: 'Admin sign-in requires HTTPS or a local SSH tunnel.' });
    return;
  }
  if (action === 'session' && request.method === 'GET') {
    const authenticated = Boolean(getSession(request, 'admin'));
    sendJson(response, 200, { authenticated });
    return;
  }
  if (action === 'logout' && request.method === 'POST') {
    const sessionToken = readCookies(request)[adminSessionCookie];
    if (sessionToken) sessions.delete(sessionToken);
    clearSessionCookie(response, 'admin', request);
    sendJson(response, 200, { signedOut: true });
    return;
  }
  if (action !== 'login' || request.method !== 'POST') {
    sendJson(response, 405, { error: 'Unsupported administrator authentication request.' });
    return;
  }
  if (!adminEmail || !adminPassword) {
    sendJson(response, 503, { error: 'Admin sign-in is not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD on the server.' });
    return;
  }
  const payload = await parseJsonBody(request, response, 'Admin sign-in details must be valid JSON.');
  if (!payload) return;
  const suppliedEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const suppliedPassword = typeof payload.password === 'string' ? payload.password : '';
  const emailMatches = Buffer.from(suppliedEmail);
  const expectedEmail = Buffer.from(adminEmail);
  const passwordMatches = Buffer.from(suppliedPassword);
  const expectedPassword = Buffer.from(adminPassword);
  const validEmail = emailMatches.length === expectedEmail.length && timingSafeEqual(emailMatches, expectedEmail);
  const validPassword = passwordMatches.length === expectedPassword.length && timingSafeEqual(passwordMatches, expectedPassword);
  if (!validEmail || !validPassword) {
    sendJson(response, 401, { error: 'Admin email or password is incorrect.' });
    return;
  }
  const token = createSession('admin');
  setSessionCookie(response, 'admin', token, request);
  sendJson(response, 200, { authenticated: true });
}

async function handleCustomersApi(request, response) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Use GET to view customer registrations.' });
    return;
  }
  if (!isSecureUpload(request)) {
    sendJson(response, 400, { error: 'Customer records require HTTPS or a local SSH tunnel.' });
    return;
  }
  if (!getSession(request, 'admin')) {
    sendJson(response, 401, { error: 'Sign in as the administrator to view customer registrations.' });
    return;
  }
  const customers = await readCustomers();
  sendJson(response, 200, {
    customers: customers.map(({ id, name, phone, email, registeredAt, consentedAt }) => ({
      id, name, phone, email, registeredAt, consentedAt,
    })),
  });
}

function normalizeCart(value) {
  if (!Array.isArray(value) || value.length > 200) return null;
  const items = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (!Number.isSafeInteger(item.id) || item.id < 1 || item.id > 1_000_000) return null;
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 160) return null;
    if (typeof item.category !== 'string' || item.category.length > 100) return null;
    if (!Number.isSafeInteger(item.price) || item.price < 0 || item.price > 10_000_000) return null;
    if (typeof item.pack !== 'string' || item.pack.length > 160) return null;
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100_000) return null;
    const image = typeof item.image === 'string' && item.image.length <= 500
      && (item.image.startsWith('/product-images/') || item.image.startsWith('https://'))
      ? item.image
      : '';
    items.push({
      id: item.id,
      name: item.name.trim(),
      category: item.category,
      price: item.price,
      pack: item.pack,
      image,
      quantity: item.quantity,
    });
  }
  return items;
}

async function handleCustomerCart(request, response) {
  if (!isSecureUpload(request)) {
    sendJson(response, 400, { error: 'Customer carts require HTTPS or a local SSH tunnel.' });
    return;
  }
  const session = getSession(request, 'customer');
  if (!session) {
    sendJson(response, 401, { error: 'Sign in to load or save your cart.' });
    return;
  }
  let savedCarts = {};
  try {
    savedCarts = JSON.parse(await readFile(cartsPath, 'utf8'));
    if (!savedCarts || typeof savedCarts !== 'object' || Array.isArray(savedCarts)) throw new Error('Saved customer carts are invalid.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (request.method === 'GET') {
    sendJson(response, 200, { cart: normalizeCart(savedCarts[session.userId] || []) || [] });
    return;
  }
  if (request.method !== 'PUT') {
    sendJson(response, 405, { error: 'Use GET to load or PUT to save your cart.' });
    return;
  }
  const payload = await parseJsonBody(request, response, 'Cart details must be valid JSON.');
  if (!payload) return;
  const cart = normalizeCart(payload.cart);
  if (!cart) {
    sendJson(response, 400, { error: 'Cart contains invalid items or quantities.' });
    return;
  }
  savedCarts[session.userId] = cart;
  await mkdir(storageDirectory, { recursive: true });
  const temporaryPath = `${cartsPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(savedCarts, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, cartsPath);
  sendJson(response, 200, { saved: true });
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

async function handleWelcomeOfferRedemption(request, response) {
  if (!isSecureUpload(request)) {
    sendJson(response, 400, { error: 'Welcome offers require HTTPS or a local SSH tunnel.' });
    return;
  }
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST to redeem the welcome offer.' });
    return;
  }
  const session = getSession(request, 'customer');
  if (!session) {
    sendJson(response, 401, { error: 'Sign in to redeem the welcome offer.' });
    return;
  }
  const customers = await readCustomers();
  const customer = customers.find((item) => item.id === session.userId);
  if (!customer) {
    sendJson(response, 404, { error: 'Customer account was not found.' });
    return;
  }
  if (!customer.welcomeOfferRedeemedAt) {
    customer.welcomeOfferRedeemedAt = new Date().toISOString();
    await saveCustomers(customers);
  }
  sendJson(response, 200, { available: false });
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
  if (!uploadToken && !getSession(request, 'admin')) {
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
  if (!uploadToken && !getSession(request, 'admin')) {
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

if (Boolean(tlsCertificatePath) !== Boolean(tlsPrivateKeyPath)) {
  throw new Error('Set both TLS_CERT_FILE and TLS_KEY_FILE to enable HTTPS.');
}

const requestHandler = async (request, response) => {
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
    if (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login' || url.pathname === '/api/auth/session' || url.pathname === '/api/auth/logout') {
      await handleCustomerAuth(request, response, url.pathname.split('/').at(-1));
      return;
    }
    if (url.pathname === '/api/admin/login' || url.pathname === '/api/admin/session' || url.pathname === '/api/admin/logout') {
      await handleAdminAuth(request, response, url.pathname.split('/').at(-1));
      return;
    }
    if (url.pathname === '/api/customer-cart') {
      await handleCustomerCart(request, response);
      return;
    }
    if (url.pathname === '/api/customer-welcome-offer/redeem') {
      await handleWelcomeOfferRedemption(request, response);
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
};

const server = tlsCertificatePath
  ? createHttpsServer({
      cert: readFileSync(tlsCertificatePath),
      key: readFileSync(tlsPrivateKeyPath),
    }, requestHandler)
  : createServer(requestHandler);

server.listen(port, host, () => {
  console.log(`Production site listening at ${tlsCertificatePath ? 'https' : 'http'}://${host}:${port}`);
  console.log(uploadToken
    ? 'Administrator sessions and the configured upload token can manage product photos and rewards.'
    : 'Product photo and reward changes require an administrator session; PHOTO_UPLOAD_TOKEN is not configured.');
});
