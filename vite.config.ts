import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const maxUploadBytes = 1_500_000;
const maxProductId = 102;

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
  return {
    name: 'product-image-writer',
    handleHotUpdate({ file, server }) {
      if (file === resolve(server.config.root, 'src', 'productImages.json')) return [];
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname !== '/api/product-images' && url.pathname !== '/api/reward-tiers') {
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
