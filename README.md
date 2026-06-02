# 🚀 V2Ray Subscription Manager (Custom Remarks & Dummies)

A powerful, secure Next.js full-stack utility designed for creating custom V2Ray subscription lists. Easily manage multiple subscription configs with real-time JSON upload parsing, auto-incrementing remark custom tags, and custom dummy/announcement nodes. Optimized for deployment with Turso (libsql over HTTP) database persistence.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyour-username%2Fyour-repo-name&env=ADMIN_PASSWORD,TURSO_DATABASE_URL,TURSO_AUTH_TOKEN&project-name=v2ray-custom-sub&repository-name=v2ray-custom-sub&demo-title=V2Ray%20Subscription%20Manager&demo-description=Organize%20and%20customize%20V2Ray%20remarks%20with%20auto%20numbering%20and%20dummy%20announcement%20configurations.&demo-url=https%3A%2F%2Fv2ray-custom-sub.vercel.app)

---

## ✨ Features

- **🔒 Restricted Access**: Full authentication system with secure HTTP-only cookie validation safeguarding the admin workspace.
- **🛠️ Automated Remark Redefinitions**: Upload raw config files (base64 links or JSON array formats) and rewrite remarks (display names) automatically using a flexible template. A `*` inside the template will automatically serialize as consecutive index numbers (such as `Server #1`, `Server #2`).
- **📢 Custom Announcer & Stats nodes**: Generate custom informational dummy nodes (VLESS format) directly within subscriptions to publish news, remaining server time, or system announcements.
- **🔗 Multiple Distinct Custom Subscriptions**: Configure any number of independent subscriptions, each linked to their own designated endpoint routing (e.g. `/sub/vip-configs` or `/sub/backup-configs`).
- **⚡ Dual Storage Stack**: Turso DB integration when deployed dynamically on cloud infrastructure, with absolute zero-configuration SQLite (`v2ray_local.db` via libsql) local fallback for development testing inside local directories.

---

## ⚡ Quick Start: One-Click Automatic Vercel Deploy

1. Click the Vercel Deploy Button above.
2. Log in with your GitHub/Vercel account.
3. Vercel will prompt you to provide your admin password and Turso DB credentials:
   - `ADMIN_PASSWORD`: Enter your private administration credentials (e.g. `MySecurePassword123`).
   - `TURSO_DATABASE_URL`: Your Turso connection URL (e.g., `libsql://your-db-name.turso.io`).
   - `TURSO_AUTH_TOKEN`: Your Turso Database secret authorization token.
4. Your customized manager is ready immediately!

---

## 🏗️ Manual Deployment Guide

Follow these simple stages to set up your subscription pipeline:

### 1. Prerequisites
- A **GitHub** account
- A **Vercel** account
- A **Turso** account (Free tier SQLite over HTTP/REST)
- Node.js (v18+) installed on your workstation

### 2. Configure Turso Database
1. Go to your **Turso Dashboard** or use the Turso CLI tools.
2. Click **Create Database** and choose a location near your target customers.
3. Obtain your **Database URL** and generate an **Auth Token** from your Turso project settings page.

### 3. Deploy the Next.js Code
1. Push this repository to your GitHub profile.
2. In Vercel, click **Add New** > **Project** and import this repository.
3. Under the **Environment Variables** configuration panel, declare the following secrets:
   - `ADMIN_PASSWORD`: Your chosen admin dashboard secret password.
   - `TURSO_DATABASE_URL`: Your Turso DB URL.
   - `TURSO_AUTH_TOKEN`: Your Turso authentication bearer token.
4. Click **Deploy**. Vercel will compile the full stack app, expose your routes, and host your V2Ray Subscription Manager instantly!

---

## 🛠️ Local Development & Development Container Use

When running this app dynamically in development containers (or within the AI Studio workspace), you do not need active remote Turso services. The system naturally checks for the absence of `TURSO_DATABASE_URL` and cleanly operates with a secure offline file SQLite database fallback `v2ray_local.db` in your project root!
