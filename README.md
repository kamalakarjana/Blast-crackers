# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Production deployment and product photos

Build and serve the production site on the Linux host:

```sh
npm ci
npm run build
sudo mkdir -p /var/lib/slv-crackers
sudo chown "$USER":"$USER" /var/lib/slv-crackers
export PHOTO_UPLOAD_TOKEN="$(openssl rand -hex 32)"
export PHOTO_STORAGE_DIR=/var/lib/slv-crackers
export HOST=127.0.0.1
export PORT=4173
npm start
```

Keep the token private in your process manager (for example, a systemd service environment file); the example above generates a new token when run and is suitable for a manual test. Do not put it in frontend code or expose port 4173 publicly. Put Nginx in front of the app and proxy requests to `127.0.0.1:4173`; expose ports 80/443 only. Keep `PHOTO_STORAGE_DIR` on persistent server storage, and back it up.

For a domain, point DNS at the server and configure TLS (for example, with Certbot). Proxy the HTTPS site to Node and redirect HTTP to HTTPS:

```nginx
server {
    listen 80;
    server_name your-domain.example;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.example;
    ssl_certificate /etc/letsencrypt/live/your-domain.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.example/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If you do not have a domain yet, keep port 4173 private and use an SSH tunnel for photo administration: `ssh -L 4173:127.0.0.1:4173 ubuntu@YOUR_SERVER_IP`, then open `http://localhost:4173/#/pdf-builder`. This encrypted tunnel is accepted for photo uploads. Do not enter the token on a public HTTP page.

Open **PDF Catalog**, enter the server's `PHOTO_UPLOAD_TOKEN` in **Photo upload token**, and use **Add photo** beside each item. The production server saves photos under `PHOTO_STORAGE_DIR/product-images/`, makes them available to all visitors, and keeps them across app rebuilds. The API token is required to add or remove photos; viewing the site and its photos is public.

The illustrated PDF includes all 102 products in a compact four-page landscape layout. Products without an uploaded photo show a placeholder.
