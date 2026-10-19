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

Keep the token private in your process manager; the example above generates a new token and is suitable for a manual test. For a persistent systemd deployment on the provided Ubuntu EC2 layout, install the included service:

```sh
sudo cp deploy/slv-crackers.service /etc/systemd/system/slv-crackers.service
sudo systemctl daemon-reload
sudo systemctl enable --now slv-crackers
sudo systemctl status slv-crackers
```

Restart it after a new build with `sudo systemctl restart slv-crackers`; inspect logs with `sudo journalctl -u slv-crackers -f`. Keep the token private, do not put it in frontend code, and do not expose port 4173 publicly. Put Nginx in front of the app and proxy requests to `127.0.0.1:4173`; expose ports 80/443 only. Keep `PHOTO_STORAGE_DIR` on persistent server storage, and back it up.

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

If you do not have a domain yet, keep port 4173 private and use an SSH tunnel for photo, reward, and customer administration: `ssh -L 4173:127.0.0.1:4173 ubuntu@YOUR_SERVER_IP`, then open `http://localhost:4173`. This encrypted tunnel is accepted for administration and customer registration. Do not enter the token or customer contact details on a public HTTP page.

Open **PDF Catalog** to add, replace, or remove product photos by category. In the admin dashboard, use **Manage category photos** for the same controls and edit the stacked shopping reward tiers. Enter the server's `PHOTO_UPLOAD_TOKEN` when saving changes. Product photos and reward tiers are stored under `PHOTO_STORAGE_DIR` and persist across app rebuilds. Viewing the site, product photos, and rewards is public; changing photos and rewards requires the token.

Customer registrations collect a name, mobile number, email address, and explicit contact consent; passwords are not collected or stored. Records are written to `PHOTO_STORAGE_DIR/customers.json`. In **Shop management**, use **Customer registrations** and enter `PHOTO_UPLOAD_TOKEN` to view contacts and follow up by phone or email. The production customer API requires HTTPS or a local SSH tunnel, and the customer list also requires the token. Back up `PHOTO_STORAGE_DIR` securely and restrict access to that backup; it contains personal contact details. Local Vite development registrations are saved under the ignored project `data/` directory.

The cart's **Download PDF** action creates a branded portrait order summary using the catalog's emerald-and-gold style, with itemized quantities, discounts, total, and unlocked shopping rewards.

The downloadable portrait PDF groups the catalog into category headings and item/price tables across two pages. The Family Packs category includes the 45-Item Pack.

Shopping reward tiers stack: the configured ₹1,000, ₹2,000, ₹3,000, ₹4,000, ₹5,000, and ₹10,000 targets give the listed candle and cracker gift values, with a 5K Wala Crackers bonus at ₹10,000. Shoppers see their progress toward the next target on the storefront and in the cart. Admins can edit, add, remove, or disable tiers; public reward changes are written to `PHOTO_STORAGE_DIR/rewardTiers.json`.
