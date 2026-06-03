# 🍋 Limoo — V2Ray Subscription & Customization Hub

**Limoo** is a sleek, secure, full-stack Next.js web application designed to normalize, sort, and organize V2Ray client subscriptions. It parses uploaded configurations (Base64 subscription feeds or JSON blocks), simplifies and re-orders client node names (remarks) with serialized patterns, handles custom system announcement mock-nodes, and exposes highly optimized subscription endpoints.

Built with a clean UI and robust backend using **Turso DB / local SQLite (libsql)**.

---

## 🎨 Visual Identity & Key Features

- **🔒 Strong Administration Gateway**: High-security session validation protecting your subscription management platform.
- **🛠️ Smart Remark Normalization**: Easily specify custom rules to rename client profiles on the fly. Pattern matching serialization (such as using `*` for sequential indexes like `Limoo-DE-01`, `Limoo-DE-02`) provides a highly professional, organized feed experience.
- **📢 Dummy & Announcement Nodes**: Expose mock/informational servers (VLESS or other custom formats) to seamlessly announce instructions, expiration dates, or real-time system alerts directly inside subscription feed outputs.
- **🔗 Flexible Sub Route Scopes**: Create custom aliases and target endpoint slugs (e.g. `/sub/premium-line`).
- **⚡ Fast, Hybrid DB Access**: Seamless cloud scaling with Turso (libsql) over HTTP or absolute zero-configuration local SQLite (`v2ray_local.db`) for lightweight development.
- **📊 Interactive Metrics Hub**: Track subscriber connections with details on **IP address**, **devices**, and **Fetch Hit counters**, with the power to selectively purge individual metric entries.

---

## 🏗️ Manual Deployment Guide

Since automated deployments can occasionally misconfigure environments or result in repository synchronization problems, **Limoo** is designed to be set up manually to guarantee full security and path-level isolation.

### Part 1: Build & Environment Variables

Make sure the following variables are configured in your development environment or host container (e.g., Vercel, Cloud Run, VPS):

| Environment Variable | Description | Example Value | Required |
|---|---|---|---|
| `ADMIN_PASSWORD` | The master passkey used to access the Limoo panel. | `mySecretAdminPass123` | **Yes** |
| `TURSO_DATABASE_URL` | Turso connection protocol URL. If missing, defaults to SQLite file. | `libsql://my-database-user.turso.io` | No (falls back to local SQLite) |
| `TURSO_AUTH_TOKEN` | Bearer authorization token provided by your Turso instance. | `eyJhbGciOiJ...` | No (only if using Turso URL) |

### Part 2: Deployment Steps

#### 1. Database Setup (Turso)
1. Go to your **Turso Web Console** or use your CLI terminal.
2. Direct-create a database instance.
3. Copy your **Database URL** and **Authentication Bearer Token**.

#### 2. Deploy on Vercel / Cloud Provider
1. Sync or upload your repository to **GitHub**.
2. Go to **Vercel**, click **Add New > Project**, and import this repository.
3. Expand **Environment Variables** and enter:
   - `ADMIN_PASSWORD`
   - `TURSO_DATABASE_URL` *(Optional)*
   - `TURSO_AUTH_TOKEN` *(Optional)*
4. Keep compilation configurations to default (`next build`).
5. Click **Deploy**.

---

## 🚀 Local Development

For quick local testing or sandbox environment deployments:

1. **Clone & Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**:
   Create a `.env` in the root folder:
   ```env
   ADMIN_PASSWORD=admin123
   ```

3. **Launch the Development Server**:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) inside your web browser. Limoo will auto-generate system tables inside an offline sqlite database file (`v2ray_local.db`) at the root!
