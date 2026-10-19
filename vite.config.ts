import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const maxUploadBytes = 1_500_000;
const maxProductId = 102;

function productImageWriter(): Plugin {
  return {
    name: 'product-image-writer',
    handleHotUpdate({ file, server }) {
      if (file === resolve(server.config.root, 'src', 'productImages.json')) return [];
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname !== '/__save-product-image') {
          next();
          return;
        }

        const sendJson = (status: number, payload: unknown) => {
          response.writeHead(status, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(payload));
        };

        if (request.method !== 'POST' && request.method !== 'DELETE') {
          sendJson(405, { error: 'Use POST to save or DELETE to remove a product photo.' });
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

        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => {
          body += chunk;
          if (Buffer.byteLength(body) > maxUploadBytes) {
            sendJson(413, { error: 'Image upload is too large.' });
            request.destroy();
          }
        });
        request.on('end', async () => {
          try {
            const payload: { productId?: number; data?: string } = body ? JSON.parse(body) : {};
            const productId = Number(payload.productId ?? url.searchParams.get('productId'));
            if (!Number.isInteger(productId) || productId < 1 || productId > maxProductId) {
              sendJson(400, { error: 'Invalid catalog product ID.' });
              return;
            }

            const root = server.config.root;
            const imageDirectory = resolve(root, 'public', 'product-images');
            const imagePath = resolve(imageDirectory, `${productId}.jpg`);
            const manifestPath = resolve(root, 'src', 'productImages.json');
            let manifest: Record<string, string> = {};
            try {
              manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, string>;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }

            if (request.method === 'DELETE') {
              await unlink(imagePath).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== 'ENOENT') throw error;
              });
              delete manifest[String(productId)];
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
