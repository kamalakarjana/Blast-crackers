# SLV Crackers

React, TypeScript, and Vite storefront with a Node production server. Use `npm run dev` for local development, `npm run build` to create the production site, and `npm start` to serve it.

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
export ADMIN_EMAIL=owner@example.com
export ADMIN_PASSWORD="$(openssl rand -hex 24)"
npm start
```

For systemd, keep these values in `/etc/slv-crackers.env`, not in the frontend or a checked-in file. Create the file with `sudo nano /etc/slv-crackers.env` and set `PHOTO_UPLOAD_TOKEN`, `PHOTO_STORAGE_DIR`, `HOST`, `PORT`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`. Generate strong values for the secrets with `openssl rand -hex 32` and `openssl rand -hex 24`, then restrict the file:

```sh
sudo chown root:root /etc/slv-crackers.env
sudo chmod 600 /etc/slv-crackers.env
```

For a persistent systemd deployment on the provided Ubuntu EC2 layout, install the included service:

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

Open **PDF Catalog** to download the catalog. In the authenticated admin dashboard, use **Manage category photos** to add, replace, or remove product photos, and edit the stacked shopping reward tiers. Product photos and reward tiers are stored under `PHOTO_STORAGE_DIR` and persist across app rebuilds. Viewing the site, product photos, and rewards is public; changing photos and rewards requires an admin session (or the private upload token for direct API use).

Customer accounts collect a name, mobile number, email address, password, and explicit contact consent. Passwords are stored as salted scrypt hashes, never as plain text. Records are written to `PHOTO_STORAGE_DIR/customers.json`; account carts are stored separately in `customerCarts.json`. Existing contact-only records can be upgraded by registering with the same email. The customer **Sign in** page is at `/#/login`. Carts restore per account and remain on the server after sign-out.

The administrator signs in at `/#/admin/login` using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the server environment. There are no default or client-side admin credentials. The admin dashboard has a separate **Customer details** page; `/api/customers` requires an active admin session and never returns password hashes. Back up `PHOTO_STORAGE_DIR` securely and restrict access to that backup because it contains customer contact information and cart selections.

In local development, Vite provides the same account and admin APIs. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the environment before starting `npm run dev` to use the admin page. Development API writes are restricted to loopback requests and use `PHOTO_STORAGE_DIR` when set, otherwise the ignored project `data/` directory. Production account and customer-record APIs require HTTPS or a local SSH tunnel. Do not enter passwords or customer details on a public plain-HTTP page.

The cart's **Download PDF** action creates a branded portrait order summary using the catalog's emerald-and-gold style, with itemized quantities, discounts, total, and unlocked shopping rewards.

The downloadable portrait PDF groups the catalog into category headings and item/price tables across two pages. The Family Packs category includes the 45-Item Pack.

Shopping reward tiers stack: the configured ₹1,000, ₹2,000, ₹3,000, ₹4,000, ₹5,000, and ₹10,000 targets give the listed candle and cracker gift values, with a 5K Wala Crackers bonus at ₹10,000. Shoppers see their progress toward the next target on the storefront and in the cart. Admins can edit, add, remove, or disable tiers; public reward changes are written to `PHOTO_STORAGE_DIR/rewardTiers.json`.
