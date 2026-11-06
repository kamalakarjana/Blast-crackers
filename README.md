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
export HOST=0.0.0.0
export PORT=4173
export ADMIN_EMAIL=owner@example.com
export ADMIN_PASSWORD="$(openssl rand -hex 24)"
export TLS_CERT_FILE=/etc/slv-crackers/tls/fullchain.pem
export TLS_KEY_FILE=/etc/slv-crackers/tls/private-key.pem
npm start
```

For permanent direct-IP access, reserve a static Elastic IP for the EC2 server and obtain a publicly trusted TLS certificate whose Subject Alternative Name includes that exact public IP address. Ordinary domain-only certificates and self-signed certificates will not work in browsers for this IP. Confirm your certificate authority supports public-IP certificates, including renewals; never disable certificate validation. Store the certificate chain and private key on the server with permissions that allow the `ubuntu` service account to read them while keeping the private key restricted.

Keep settings in `/etc/slv-crackers.env`, not in the frontend or a checked-in file. Create it with `sudo nano /etc/slv-crackers.env` and set `PHOTO_UPLOAD_TOKEN`, `PHOTO_STORAGE_DIR`, `HOST=0.0.0.0`, `PORT=4173`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `TLS_CERT_FILE`, and `TLS_KEY_FILE`. Both TLS file settings are required to enable HTTPS:

```sh
sudo chown root:root /etc/slv-crackers.env
sudo chmod 600 /etc/slv-crackers.env
```

Allow inbound TCP port 4173 in the EC2 security group and host firewall. With TLS configured, access the site using **`https://YOUR_STATIC_PUBLIC_IP:4173/`** (not `http://`). Use `/#/login` for customer accounts and `/#/admin/login` for the administrator. Renew the IP certificate before it expires and restart the service after renewal so Node loads the renewed files.

For a persistent systemd deployment on the provided Ubuntu EC2 layout, install the included service:

```sh
sudo cp deploy/slv-crackers.service /etc/systemd/system/slv-crackers.service
sudo systemctl daemon-reload
sudo systemctl enable --now slv-crackers
sudo systemctl status slv-crackers
```

Restart it after a new build or certificate renewal with `sudo systemctl restart slv-crackers`; inspect logs with `sudo journalctl -u slv-crackers -f`. Keep secrets private and do not put them in frontend code. Keep `PHOTO_STORAGE_DIR` on persistent server storage, and back it up.

For a domain, point DNS at the server and configure TLS (for example, with Certbot). Proxy the HTTPS site to Node and redirect HTTP to HTTPS:

The Nginx virtual host must proxy **all paths**, including `/api/*`, to the Node server. Do not use a static `root` or SPA `try_files` fallback for API paths: serving `index.html` for `/api/catalogue` makes the admin appear to save changes locally while other browsers cannot load them. This repository includes the domain configuration in `deploy/nginx-slv-crackers.conf`. On the server, configure the Node service with `HOST=127.0.0.1`, `PORT=4173`, and one persistent `PHOTO_STORAGE_DIR` (for example `/var/lib/slv-crackers`). When Nginx terminates HTTPS, leave `TLS_CERT_FILE` and `TLS_KEY_FILE` unset so the Node upstream uses HTTP on loopback.

Review the active Nginx virtual host with `sudo nginx -T`, update it to match the included configuration (adjust certificate paths if needed), then validate and reload Nginx:

```sh
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl restart slv-crackers
```

Confirm `sudo systemctl status slv-crackers` shows the Node `server.mjs` service running, then check the public API:

```sh
curl -i https://slvcrackers.shop/api/catalogue
```

The response must have `Content-Type: application/json` and a JSON object containing `products` and `categoryOffers`; an HTML response means Nginx is still serving the SPA instead of proxying to Node. Admin offer and catalogue changes are stored in the shared `PHOTO_STORAGE_DIR/catalogue.json`; all customer browsers load that shared file. Do not run multiple app instances with different storage directories.

If the public-IP certificate is not installed yet, keep port 4173 private and use an SSH tunnel for administration: `ssh -L 4173:127.0.0.1:4173 ubuntu@YOUR_SERVER_IP`, then open `http://localhost:4173`. This encrypted tunnel is accepted for administration and customer registration. Do not enter the token or customer contact details on a public HTTP page.

The customer storefront remains public for browsing and selecting products. **Order entry** and **Manage category photos** are available only after administrator sign-in; direct visits to `/#/order-entry` and `/#/pdf-builder` redirect to admin sign-in when no admin session is active. The PDF Catalog link is not shown in public navigation. Product photos, catalogue items, item and category percentage offers, and reward tiers are stored under `PHOTO_STORAGE_DIR` and persist across app rebuilds. In the admin catalogue, add an item to an existing category or type a new category name; it becomes available in shop navigation, category URLs, and order entry. Admin edits to built-in and newly added products, including item-specific discounts and reward eligibility, are stored in the shared catalogue so all browsers receive them. Category offers apply a 1–90% discount to items in that category unless an item-specific offer overrides it. Discounted items are excluded from target rewards by default. Admins can set the category-level **Count discounted items toward target rewards** option, then override that setting for an individual discounted item in its product editor. Eligible discounted items count toward targets at their discounted selling price. Catalogue data is stored in `PHOTO_STORAGE_DIR/catalogue.json`. Customer storefronts refresh shared catalogue and offer changes on page focus and every 15 seconds while open.

Customer accounts collect a name, mobile number, email address, password, and explicit contact consent. Customers can sign in with their registered email or 10-digit mobile number (optionally prefixed with India's `+91` country code) and password. If a mobile number is shared by multiple accounts, sign in with email instead. Passwords are stored as salted scrypt hashes, never as plain text. Records are written to `PHOTO_STORAGE_DIR/customers.json`; account carts are stored separately in `customerCarts.json`. Existing contact-only records can be upgraded by registering with the same email. The customer **Sign in** page is at `/#/login`. The **Forgot password?** link opens WhatsApp with a reset request; support must verify the customer's identity and an administrator then sets a new password from the customer management page. The admin reset immediately revokes that customer's existing sessions. Carts restore per account and remain on the server after sign-out. Opening a populated cart or downloading its PDF prompts visitors to register or sign in; saved account details are reused on later logins. Downloaded catalog and order PDFs use the signed-in customer's name as the filename prefix when available.

The administrator signs in at `/#/admin/login` using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the server environment. There are no default or client-side admin credentials. The admin dashboard has a separate **Customer details** page; `/api/customers` requires an active admin session and never returns password hashes. Admins can add, edit, remove, or export customer records and download a separate CSV of checkout attempts with line items and amounts. Customer emails are unique; repeat checkout attempts create separate order records. Attempts are stored in `PHOTO_STORAGE_DIR/customerOrders.json` with an `attempted` status; the customer's “I have completed the payment” action changes it to `customer-confirmed`, which records the customer's confirmation and is not independent payment verification. Admins can delete an individual duplicate order attempt from the customer order history; deletion is permanent and requires confirmation. Removing a customer keeps their order records for reporting. The storefront defaults to day mode and the header switch toggles between day and night themes; a previously saved theme preference is remembered. Back up `PHOTO_STORAGE_DIR` securely and restrict access to that backup because it contains customer contact information, carts, and order details.

Signed-in customers can open **My bookings** to view their own checkout history and download a PDF of one booking or their full history. Administrators can download an individual booking PDF, a customer's booking-history PDF, or a combined PDF of up to 500 bookings from the customer management page. PDFs are generated in the browser from the saved order records.

In local development, Vite provides the same account and admin APIs. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the environment before starting `npm run dev` to use the admin page. Development API writes are restricted to loopback requests and use `PHOTO_STORAGE_DIR` when set, otherwise the ignored project `data/` directory. Production account and customer-record APIs require HTTPS or a local SSH tunnel. Do not enter passwords or customer details on a public plain-HTTP page.

New customer accounts receive a one-time ₹50 welcome discount on their first order. Eligibility is stored on the customer record and marked redeemed when the customer confirms the order; cart PDFs and the payment total include the discount while eligible. The cart's **Download PDF** action creates a branded portrait order summary using the catalog's emerald-and-gold style, with itemized quantities, discounts, total, and unlocked shopping rewards. Placeholder pack text ("As per product listing") is omitted from the billing PDF.

The downloadable portrait PDF groups the catalog into category headings and item/price tables across two pages. The Family Packs category includes the 45-Item Pack.

Shopping reward tiers stack: the configured ₹1,000, ₹2,000, ₹3,000, ₹4,000, ₹5,000, and ₹10,000 targets give the listed candle and fancy-cracker gift values, with a 5K Wala Crackers bonus at ₹10,000. Shoppers see their progress toward the next target on the storefront and in the cart. Fancy-cracker and candle values describe gifts, not cash discounts; target rewards are subject to terms and conditions. Admins can edit, add, remove, or disable tiers; public reward changes are written to `PHOTO_STORAGE_DIR/rewardTiers.json`.
