import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const maxUploadBytes = 1_500_000;
const maxProductId = 102;
const scrypt = promisify(scryptCallback);
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const customerSessionCookie = 'slv_customer_session';
const adminSessionCookie = 'slv_admin_session';

async function parseRequestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > 100_000) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function isLoopbackRequest(request: IncomingMessage): boolean {
  const remoteAddress = request.socket.remoteAddress ?? '';
  return remoteAddress === '::1'
    || remoteAddress === '127.0.0.1'
    || remoteAddress.startsWith('127.')
    || remoteAddress.startsWith('::ffff:127.');
}

function parseCookies(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries((request.headers.cookie ?? '').split(';').map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([name]) => name));
}

function isRewardTierList(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 30) return false;
  const ids = new Set<string>();
  let previousThreshold = 0;

  for (const tier of value) {
    if (!tier || typeof tier !== "object" || Array.isArray(tier)) return false;
    const candidate = tier as Record<string, unknown>;
    if (
      typeof candidate.id !== "string"
      || !/^[a-zA-Z0-9_-]{1,80}$/.test(candidate.id)
      || ids.has(candidate.id)
      || typeof candidate.threshold !== "number"
      || !Number.isSafeInteger(candidate.threshold)
      || candidate.threshold <= previousThreshold
      || typeof candidate.candleValue !== "number"
      || !Number.isSafeInteger(candidate.candleValue)
      || candidate.candleValue < 0
      || typeof candidate.crackerValue !== "number"
      || !Number.isSafeInteger(candidate.crackerValue)
      || candidate.crackerValue < 0
      || typeof candidate.bonusPack !== "string"
      || candidate.bonusPack.length > 100
      || typeof candidate.enabled !== "boolean"
    ) return false;
    ids.add(candidate.id);
    previousThreshold = candidate.threshold;
  }
  return true;
}

function productImageWriter(): Plugin {
  const sessions = new Map<string, { kind: 'customer' | 'admin'; userId: string; expiresAt: number }>();
  return {
    name: 'product-image-writer',
    handleHotUpdate({ file, server }) {
      if (file === resolve(server.config.root, 'src', 'productImages.json')) return [];
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const authPath = url.pathname === '/api/customers'
          || url.pathname === '/api/customers/password'
          || /^\/api\/(?:auth\/(?:register|login|session|logout)|admin\/(?:login|session|logout)|customer-cart|customer-welcome-offer\/redeem|customer-orders(?:\/[0-9a-f-]{36}\/confirm)?|orders)$/.test(url.pathname);
        if (url.pathname !== '/api/product-images' && url.pathname !== '/api/reward-tiers' && url.pathname !== '/api/customers' && !authPath) {
          next();
          return;
        }

        const sendJson = (status: number, payload: unknown) => {
          response.writeHead(status, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
          });
          response.end(JSON.stringify(payload));
        };

        const root = server.config.root;
        const imageDirectory = resolve(root, 'public', 'product-images');
        const manifestPath = resolve(root, 'src', 'productImages.json');
        const rewardTiersPath = resolve(root, 'src', 'rewardTiers.json');
        const dataDirectory = resolve(process.env.PHOTO_STORAGE_DIR || resolve(root, 'data'));
        const customersPath = resolve(dataDirectory, 'customers.json');
        const cartsPath = resolve(dataDirectory, 'customerCarts.json');
        const ordersPath = resolve(dataDirectory, 'customerOrders.json');

        const sendUnauthorized = (message: string) => sendJson(401, { error: message });
        const currentSession = (kind: 'customer' | 'admin') => {
          const token = parseCookies(request)[kind === 'customer' ? customerSessionCookie : adminSessionCookie];
          const session = token ? sessions.get(token) : undefined;
          if (!session || session.kind !== kind || session.expiresAt <= Date.now()) {
            if (token) sessions.delete(token);
            return null;
          }
          return session;
        };
        const setSessionCookie = (kind: 'customer' | 'admin', token: string | null) => {
          const name = kind === 'customer' ? customerSessionCookie : adminSessionCookie;
          response.setHeader('Set-Cookie', `${name}=${token ? encodeURIComponent(token) : ''}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? sessionLifetimeMs / 1000 : 0}`);
        };
        const readCustomers = async (): Promise<Record<string, unknown>[]> => {
          try {
            const saved: unknown = JSON.parse(await readFile(customersPath, 'utf8'));
            if (!Array.isArray(saved) || saved.length > 10_000) throw new Error('Saved customer records are invalid.');
            return saved as Record<string, unknown>[];
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
          }
        };
        const saveJson = async (path: string, value: unknown) => {
          await mkdir(dataDirectory, { recursive: true });
          const temporaryPath = `${path}.${randomUUID()}.tmp`;
          await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
          await rename(temporaryPath, path);
        };

        if (authPath) {
          if (!isLoopbackRequest(request)) {
            sendJson(403, { error: 'Authentication and customer carts are restricted to the local development machine.' });
            return;
          }
          const isAdminRoute = url.pathname.startsWith('/api/admin/');
          const kind = isAdminRoute ? 'admin' : 'customer';
          void (async () => {
            try {
              if (url.pathname.endsWith('/session') && request.method === 'GET') {
                const session = currentSession(kind);
                if (kind === 'admin') sendJson(200, { authenticated: Boolean(session) });
                else {
                  const customers = session ? await readCustomers() : [];
                  const customer = customers.find((item) => item.id === session?.userId);
                  sendJson(200, { user: customer ? {
                    id: customer.id,
                    name: customer.name,
                    phone: customer.phone,
                    email: customer.email,
                    welcomeOfferAvailable: !customer.welcomeOfferRedeemedAt,
                  } : null });
                }
                return;
              }
              if (url.pathname.endsWith('/logout') && request.method === 'POST') {
                const cookieName = kind === 'admin' ? adminSessionCookie : customerSessionCookie;
                const token = parseCookies(request)[cookieName];
                if (token) sessions.delete(token);
                setSessionCookie(kind, null);
                sendJson(200, { signedOut: true });
                return;
              }
              if (url.pathname === '/api/customers/password') {
                if (!currentSession('admin')) {
                  sendUnauthorized('Sign in as the administrator to reset customer passwords.');
                  return;
                }
                if (request.method !== 'POST') {
                  sendJson(405, { error: 'Use POST to reset a customer password.' });
                  return;
                }
                const customerId = request.headers['x-customer-id'];
                const payload: unknown = await parseRequestJson(request);
                const input = payload && typeof payload === 'object' && !Array.isArray(payload)
                  ? payload as Record<string, unknown>
                  : {};
                const password = typeof input.password === 'string' ? input.password : '';
                if (typeof customerId !== 'string' || password.length < 10 || password.length > 128) {
                  sendJson(400, { error: 'Choose a customer and enter a password between 10 and 128 characters.' });
                  return;
                }
                const customers = await readCustomers();
                const customer = customers.find((item) => item.id === customerId);
                if (!customer) {
                  sendJson(404, { error: 'Customer was not found.' });
                  return;
                }
                const salt = randomBytes(16);
                const hash = await scrypt(password, salt, 64) as Buffer;
                customer.passwordSalt = salt.toString('hex');
                customer.passwordHash = hash.toString('hex');
                await saveJson(customersPath, customers);
                for (const [token, session] of sessions) {
                  if (session.kind === 'customer' && session.userId === customerId) sessions.delete(token);
                }
                sendJson(200, { updated: true });
                return;
              }
              if (url.pathname === '/api/customers') {
                if (!currentSession('admin')) {
                  sendUnauthorized('Sign in as the administrator to view customer records.');
                  return;
                }
                const customers = await readCustomers();
                if (request.method === 'GET') {
                  sendJson(200, { customers: customers.map(({ id, name, phone, email, registeredAt, consentedAt }) => ({ id, name, phone, email, registeredAt, consentedAt })) });
                  return;
                }
                let input: Record<string, unknown> = {};
                if (request.method === 'POST' || request.method === 'PUT') {
                  const payload: unknown = await parseRequestJson(request);
                  input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
                }
                const name = typeof input.name === 'string' ? input.name.trim() : '';
                const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
                const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
                if (request.method === 'POST') {
                  if (name.length < 2 || name.length > 100 || !/^[0-9]{10}$/.test(phone) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    sendJson(400, { error: 'Enter a valid name, 10-digit mobile number, and email.' });
                    return;
                  }
                  if (customers.some((customer) => customer.email === email)) {
                    sendJson(409, { error: 'A customer with this email already exists.' });
                    return;
                  }
                  const timestamp = new Date().toISOString();
                  const customer = { id: randomUUID(), name, phone, email, registeredAt: timestamp, consentedAt: timestamp };
                  customers.push(customer);
                  await saveJson(customersPath, customers);
                  sendJson(201, { customer });
                  return;
                }
                const customerId = request.headers['x-customer-id'];
                const index = customers.findIndex((customer) => customer.id === customerId);
                if (typeof customerId !== 'string' || index < 0) {
                  sendJson(404, { error: 'Customer was not found.' });
                  return;
                }
                if (request.method === 'DELETE') {
                  customers.splice(index, 1);
                  await saveJson(customersPath, customers);
                  let savedCarts: Record<string, unknown> = {};
                  try {
                    const saved: unknown = JSON.parse(await readFile(cartsPath, 'utf8'));
                    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Saved carts are invalid.');
                    savedCarts = saved as Record<string, unknown>;
                  } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                  }
                  delete savedCarts[customerId];
                  await saveJson(cartsPath, savedCarts);
                  sendJson(200, { deleted: true });
                  return;
                }
                if (request.method !== 'PUT') {
                  sendJson(405, { error: 'Use GET, POST, PUT, or DELETE to manage customers.' });
                  return;
                }
                if (name.length < 2 || name.length > 100 || !/^[0-9]{10}$/.test(phone) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                  sendJson(400, { error: 'Enter a valid name, 10-digit mobile number, and email.' });
                  return;
                }
                if (customers.some((customer) => customer.id !== customerId && customer.email === email)) {
                  sendJson(409, { error: 'Another customer already uses this email.' });
                  return;
                }
                customers[index] = { ...customers[index], name, phone, email };
                await saveJson(customersPath, customers);
                sendJson(200, { customer: customers[index] });
                return;
              }
              if (url.pathname === '/api/customer-orders' && request.method === 'POST') {
                const session = currentSession('customer');
                if (!session) {
                  sendUnauthorized('Sign in to record an order attempt.');
                  return;
                }
                const customers = await readCustomers();
                const customer = customers.find((item) => item.id === session.userId);
                if (!customer) {
                  sendJson(404, { error: 'Customer account was not found.' });
                  return;
                }
                const payload: unknown = await parseRequestJson(request);
                const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
                const cart = input.cart;
                if (!Array.isArray(cart) || !cart.length || cart.length > 200 || cart.some((item) => {
                  if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
                  const product = item as Record<string, unknown>;
                  return !Number.isSafeInteger(product.id) || typeof product.name !== 'string'
                    || !Number.isSafeInteger(product.price) || Number(product.price) < 0
                    || !Number.isSafeInteger(product.quantity) || Number(product.quantity) < 1;
                })) {
                  sendJson(400, { error: 'An order must contain valid cart items.' });
                  return;
                }
                const subtotal = cart.reduce((sum, item) => {
                  const product = item as Record<string, unknown>;
                  return sum + Number(product.price) * Number(product.quantity);
                }, 0);
                const discount = Number.isSafeInteger(input.discount) ? Math.min(Math.max(Number(input.discount), 0), subtotal) : 0;
                let orders: Record<string, unknown>[] = [];
                try {
                  const saved: unknown = JSON.parse(await readFile(ordersPath, 'utf8'));
                  if (!Array.isArray(saved)) throw new Error('Saved orders are invalid.');
                  orders = saved as Record<string, unknown>[];
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                }
                const order = {
                  id: randomUUID(), customerId: customer.id, customerName: customer.name,
                  customerEmail: customer.email, customerPhone: customer.phone, items: cart,
                  subtotal, discount, total: subtotal - discount, status: 'attempted',
                  attemptedAt: new Date().toISOString(), confirmedAt: null,
                };
                orders.push(order);
                await saveJson(ordersPath, orders);
                sendJson(201, { orderId: order.id, total: order.total });
                return;
              }
              if (url.pathname === '/api/orders') {
                if (!currentSession('admin')) {
                  sendUnauthorized('Sign in as the administrator to view orders.');
                  return;
                }
                if (request.method !== 'GET') {
                  sendJson(405, { error: 'Use GET to view orders.' });
                  return;
                }
                let orders: unknown[] = [];
                try {
                  const saved: unknown = JSON.parse(await readFile(ordersPath, 'utf8'));
                  if (!Array.isArray(saved)) throw new Error('Saved orders are invalid.');
                  orders = saved;
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                }
                sendJson(200, { orders });
                return;
              }
              if (url.pathname === '/api/customer-orders' || url.pathname.startsWith('/api/customer-orders/')) {
                const session = currentSession('customer');
                if (!session) {
                  sendUnauthorized('Sign in to access your orders.');
                  return;
                }
                let orders: Record<string, unknown>[] = [];
                try {
                  const saved: unknown = JSON.parse(await readFile(ordersPath, 'utf8'));
                  if (!Array.isArray(saved)) throw new Error('Saved orders are invalid.');
                  orders = saved as Record<string, unknown>[];
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                }
                if (url.pathname === '/api/customer-orders' && request.method === 'GET') {
                  sendJson(200, { orders: orders.filter((order) => order.customerId === session.userId) });
                  return;
                }
                const confirmMatch = /^\/api\/customer-orders\/([0-9a-f-]{36})\/confirm$/i.exec(url.pathname);
                const order = confirmMatch && orders.find((item) => item.id === confirmMatch[1] && item.customerId === session.userId);
                if (request.method !== 'POST' || !order) {
                  sendJson(order ? 405 : 404, { error: order ? 'Use POST to confirm the order.' : 'Order was not found.' });
                  return;
                }
                order.status = 'customer-confirmed';
                order.confirmedAt ||= new Date().toISOString();
                await saveJson(ordersPath, orders);
                sendJson(200, { confirmed: true });
                return;
              }
              if (url.pathname === '/api/customer-cart') {
                const session = currentSession('customer');
                if (!session) {
                  sendUnauthorized('Sign in to load or save your cart.');
                  return;
                }
                let savedCarts: Record<string, unknown> = {};
                try {
                  const saved: unknown = JSON.parse(await readFile(cartsPath, 'utf8'));
                  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Saved carts are invalid.');
                  savedCarts = saved as Record<string, unknown>;
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                }
                if (request.method === 'GET') {
                  sendJson(200, { cart: Array.isArray(savedCarts[session.userId]) ? savedCarts[session.userId] : [] });
                  return;
                }
                if (request.method !== 'PUT') {
                  sendJson(405, { error: 'Use GET to load or PUT to save your cart.' });
                  return;
                }
                const payload: unknown = await parseRequestJson(request);
                const candidate = payload && typeof payload === 'object' && !Array.isArray(payload)
                  ? payload as Record<string, unknown>
                  : {};
                const cart = candidate.cart;
                if (!Array.isArray(cart) || cart.length > 200 || cart.some((item) => {
                  if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
                  const product = item as Record<string, unknown>;
                  return !Number.isSafeInteger(product.id)
                    || typeof product.name !== 'string'
                    || typeof product.category !== 'string'
                    || !Number.isSafeInteger(product.price)
                    || typeof product.pack !== 'string'
                    || !Number.isSafeInteger(product.quantity)
                    || Number(product.quantity) < 1;
                })) {
                  sendJson(400, { error: 'Cart contains invalid items or quantities.' });
                  return;
                }
                savedCarts[session.userId] = cart;
                await saveJson(cartsPath, savedCarts);
                sendJson(200, { saved: true });
                return;
              }
              if (url.pathname === '/api/customer-welcome-offer/redeem') {
                if (request.method !== 'POST') {
                  sendJson(405, { error: 'Use POST to redeem the welcome offer.' });
                  return;
                }
                const session = currentSession('customer');
                if (!session) {
                  sendUnauthorized('Sign in to redeem the welcome offer.');
                  return;
                }
                const customers = await readCustomers();
                const customer = customers.find((item) => item.id === session.userId);
                if (!customer) {
                  sendJson(404, { error: 'Customer account was not found.' });
                  return;
                }
                if (!customer.welcomeOfferRedeemedAt) {
                  customer.welcomeOfferRedeemedAt = new Date().toISOString();
                  await saveJson(customersPath, customers);
                }
                sendJson(200, { available: false });
                return;
              }
              if ((url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login') && request.method === 'POST') {
                const payload: unknown = await parseRequestJson(request);
                const input = payload && typeof payload === 'object' && !Array.isArray(payload)
                  ? payload as Record<string, unknown>
                  : {};
                const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
                const identifier = typeof input.identifier === 'string' ? input.identifier.trim() : email;
                const password = typeof input.password === 'string' ? input.password : '';
                if (password.length > 128) {
                  sendJson(400, { error: 'Password must be 128 characters or fewer.' });
                  return;
                }
                const customers = await readCustomers();
                let customer = customers.find((item) => item.email === email);
                if (url.pathname.endsWith('/register')) {
                  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
                    sendJson(400, { error: 'Enter a valid email address.' });
                    return;
                  }
                  const name = typeof input.name === 'string' ? input.name.trim() : '';
                  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
                  if (input.consented !== true || name.length < 2 || name.length > 100 || !/^[0-9]{10}$/.test(phone) || password.length < 10) {
                    sendJson(400, { error: 'Enter your name, 10-digit mobile, valid email, password (at least 10 characters), and consent.' });
                    return;
                  }
                  if (customer?.passwordHash) {
                    sendJson(409, { error: 'An account with this email already exists. Sign in instead.' });
                    return;
                  }
                  const salt = randomBytes(16);
                  const hash = await scrypt(password, salt, 64) as Buffer;
                  const timestamp = new Date().toISOString();
                  customer = {
                    id: typeof customer?.id === 'string' ? customer.id : randomUUID(),
                    name,
                    phone,
                    email,
                    passwordSalt: salt.toString('hex'),
                    passwordHash: hash.toString('hex'),
                    registeredAt: typeof customer?.registeredAt === 'string' ? customer.registeredAt : timestamp,
                    consentedAt: timestamp,
                    welcomeOfferRedeemedAt: customer?.welcomeOfferRedeemedAt,
                  };
                  if (customers.some((item) => item.email === email)) {
                    const index = customers.findIndex((item) => item.email === email);
                    customers[index] = customer;
                  } else {
                    if (customers.length >= 10_000) {
                      sendJson(507, { error: 'Customer registrations are full. Contact the site administrator.' });
                      return;
                    }
                    customers.push(customer);
                  }
                  await saveJson(customersPath, customers);
                } else {
                  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
                  const mobile = identifier.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
                  const candidates = isEmail
                    ? customers.filter((item) => item.email === identifier.toLowerCase())
                    : /^[0-9]{10}$/.test(mobile) ? customers.filter((item) => item.phone === mobile) : [];
                  if (candidates.length > 1) {
                    sendJson(400, { error: 'This mobile number is linked to multiple accounts. Sign in with your email instead.' });
                    return;
                  }
                  customer = candidates[0];
                  if (!customer?.passwordSalt || typeof customer.passwordHash !== 'string' || password.length < 1) {
                    sendJson(401, { error: 'Email/mobile number or password is incorrect.' });
                    return;
                  }
                  const hash = await scrypt(password, Buffer.from(String(customer.passwordSalt), 'hex'), 64) as Buffer;
                  const expected = Buffer.from(customer.passwordHash, 'hex');
                  if (hash.length !== expected.length || !timingSafeEqual(hash, expected)) {
                    sendJson(401, { error: 'Email/mobile number or password is incorrect.' });
                    return;
                  }
                }
                const token = randomBytes(32).toString('base64url');
                for (const [existingToken, session] of sessions) {
                  if (session.expiresAt <= Date.now()) sessions.delete(existingToken);
                }
                sessions.set(token, { kind: 'customer', userId: String(customer?.id), expiresAt: Date.now() + sessionLifetimeMs });
                setSessionCookie('customer', token);
                sendJson(url.pathname.endsWith('/register') ? 201 : 200, {
                  user: {
                    id: customer?.id,
                    name: customer?.name,
                    phone: customer?.phone,
                    email: customer?.email,
                    welcomeOfferAvailable: !customer?.welcomeOfferRedeemedAt,
                  },
                });
                return;
              }
              if (url.pathname === '/api/admin/login' && request.method === 'POST') {
                const adminEmail = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
                const adminPassword = process.env.ADMIN_PASSWORD ?? '';
                if (!adminEmail || !adminPassword) {
                  sendJson(503, { error: 'Admin sign-in is not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD for the Vite process.' });
                  return;
                }
                const payload: unknown = await parseRequestJson(request);
                const input = payload && typeof payload === 'object' && !Array.isArray(payload)
                  ? payload as Record<string, unknown>
                  : {};
                const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
                const password = typeof input.password === 'string' ? input.password : '';
                const emailBuffer = Buffer.from(email);
                const expectedEmail = Buffer.from(adminEmail);
                const passwordBuffer = Buffer.from(password);
                const expectedPassword = Buffer.from(adminPassword);
                const validEmail = emailBuffer.length === expectedEmail.length && timingSafeEqual(emailBuffer, expectedEmail);
                const validPassword = passwordBuffer.length === expectedPassword.length && timingSafeEqual(passwordBuffer, expectedPassword);
                if (!validEmail || !validPassword) {
                  sendUnauthorized('Admin email or password is incorrect.');
                  return;
                }
                const token = randomBytes(32).toString('base64url');
                sessions.set(token, { kind: 'admin', userId: '', expiresAt: Date.now() + sessionLifetimeMs });
                setSessionCookie('admin', token);
                sendJson(200, { authenticated: true });
                return;
              }
              sendJson(405, { error: 'Unsupported authentication request.' });
            } catch (error) {
              server.config.logger.error('Development authentication request failed.', {
                error: error instanceof Error ? error : new Error(String(error)),
              });
              sendJson(error instanceof Error && error.message === 'Request body is too large.' ? 413 : 400, {
                error: error instanceof Error && error.message === 'Request body is too large.'
                  ? error.message
                  : 'The request could not be completed.',
              });
            }
          })();
          return;
        }

        if (url.pathname === '/api/reward-tiers') {
          if (request.method === 'GET') {
            void readFile(rewardTiersPath, 'utf8')
              .then((contents) => sendJson(200, JSON.parse(contents)))
              .catch((error: NodeJS.ErrnoException) => {
                server.config.logger.error('Reward tiers could not be loaded.', {
                  error: error instanceof Error ? error : new Error(String(error)),
                });
                sendJson(500, { error: 'Reward tiers could not be loaded.' });
              });
            return;
          }
          if (request.method !== 'PUT') {
            sendJson(405, { error: 'Use GET to list or PUT to update reward tiers.' });
            return;
          }

          const remoteAddress = request.socket.remoteAddress ?? '';
          const isLocalRequest = remoteAddress === '::1'
            || remoteAddress === '127.0.0.1'
            || remoteAddress.startsWith('127.')
            || remoteAddress.startsWith('::ffff:127.');
          if (!isLocalRequest) {
            sendJson(403, { error: 'Reward updates are restricted to the local development machine.' });
            return;
          }

          const chunks: Buffer[] = [];
          let bodyBytes = 0;
          request.setEncoding('utf8');
          request.on('data', (chunk: string) => {
            bodyBytes += Buffer.byteLength(chunk);
            if (bodyBytes <= 100_000) chunks.push(Buffer.from(chunk));
          });
          request.on('end', async () => {
            if (bodyBytes > 100_000) {
              sendJson(413, { error: 'Reward update is too large.' });
              return;
            }
            try {
              const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { tiers?: unknown };
              if (!isRewardTierList(payload?.tiers)) {
                sendJson(400, { error: 'Reward tiers must be valid, uniquely ordered entries.' });
                return;
              }
              const temporaryPath = `${rewardTiersPath}.tmp`;
              await writeFile(temporaryPath, `${JSON.stringify(payload.tiers, null, 2)}\n`, 'utf8');
              await rename(temporaryPath, rewardTiersPath);
              sendJson(200, { tiers: payload.tiers });
            } catch (error) {
              server.config.logger.error('Reward tiers could not be saved.', {
                error: error instanceof Error ? error : new Error(String(error)),
              });
              sendJson(500, { error: 'Reward tiers could not be saved.' });
            }
          });
          return;
        }

        if (request.method === 'GET') {
          void readFile(manifestPath, 'utf8')
            .then((contents) => sendJson(200, JSON.parse(contents)))
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') sendJson(200, {});
              else {
                server.config.logger.error('Product photo manifest could not be read.', {
                  error: error instanceof Error ? error : new Error(String(error)),
                });
                sendJson(500, { error: 'Saved product photos could not be loaded.' });
              }
            });
          return;
        }

        if (request.method !== 'POST' && request.method !== 'DELETE') {
          sendJson(405, { error: 'Use GET to list, POST to save, or DELETE to remove product photos.' });
          return;
        }

        const remoteAddress = request.socket.remoteAddress ?? '';
        const isLocalRequest = remoteAddress === '::1'
          || remoteAddress === '127.0.0.1'
          || remoteAddress.startsWith('127.')
          || remoteAddress.startsWith('::ffff:127.');
        if (!isLocalRequest) {
          sendJson(403, { error: 'Project photo uploads are restricted to the local development machine.' });
          return;
        }

        const chunks: Buffer[] = [];
        let bodyBytes = 0;
        let tooLarge = false;
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => {
          bodyBytes += Buffer.byteLength(chunk);
          if (bodyBytes > maxUploadBytes) tooLarge = true;
          else chunks.push(Buffer.from(chunk));
        });
        request.on('end', async () => {
          if (tooLarge) {
            sendJson(413, { error: 'Image upload is too large.' });
            return;
          }
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const payload: { productId?: number; data?: string } = body ? JSON.parse(body) : {};
            const productId = Number(payload.productId ?? url.searchParams.get('productId'));
            if (!Number.isInteger(productId) || productId < 1 || productId > maxProductId) {
              sendJson(400, { error: 'Invalid catalog product ID.' });
              return;
            }

            const imagePath = resolve(imageDirectory, `${productId}.jpg`);
            let manifest: Record<string, string | null> = {};
            try {
              manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, string>;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }

            if (request.method === 'DELETE') {
              await unlink(imagePath).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== 'ENOENT') throw error;
              });
              manifest[String(productId)] = null;
              await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
              sendJson(200, { removed: true });
              return;
            }

            if (!payload.data || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(payload.data)) {
              sendJson(400, { error: 'Upload a valid JPEG image.' });
              return;
            }
            const imageData = Buffer.from(payload.data.slice('data:image/jpeg;base64,'.length), 'base64');
            if (imageData.length === 0 || imageData.length > maxUploadBytes) {
              sendJson(413, { error: 'Image must be smaller than 1.5 MB.' });
              return;
            }

            await mkdir(imageDirectory, { recursive: true });
            await writeFile(imagePath, imageData);
            const imageUrl = `/product-images/${productId}.jpg`;
            manifest[String(productId)] = imageUrl;
            await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
            sendJson(200, { image: imageUrl });
          } catch (error) {
            server.config.logger.error('Product photo could not be saved.', {
              error: error instanceof Error ? error : new Error(String(error)),
            });
            sendJson(500, { error: 'The product photo could not be saved in the project.' });
          }
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), productImageWriter()],
})
