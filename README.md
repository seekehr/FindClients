# FindClients

This is a SaaS that basically allows you to monitor all leads through scrapping coming from platforms including: Upwork, Twitter, and Discord, and other platforms in the future.

## Repository layout

| Folder                       | What it is                                                                 |
| ---------------------------- | -------------------------------------------------------------------------- |
| [`website/`](website)        | Next.js frontend (dashboard, leads, connections, analytics, settings).     |
| [`server/`](server)          | REST API + auth + scheduler + notifications + billing + credential store. See [server/README.md](server/README.md). |
| [`scrapper/`](scrapper)      | Real platform scrapers (Twitter/X, Upwork) + a Discord placeholder. See [scrapper/README.md](scrapper/README.md). |

| [`supabase/`](supabase)      | The database schema, as SQL you run in your Supabase project.               |

### Quick start

**1. Configure.** Copy [`.env.example`](.env.example) to `.env` in this folder
and fill in `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (Supabase dashboard →
Project Settings → API). This one file is read by the server, the scrapers, and
the website — there is no per-workspace `.env` to keep in sync.

**2. Create the schema.** In the Supabase dashboard open **SQL Editor → New
query**, paste all of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql),
and run it. It is idempotent, so re-running it is safe.

**3. Run it.**

```bash
# Backend + scrapers
cd server && npm install && npm run dev            # http://localhost:4000
cd scrapper && npm install && npx playwright install chromium

# Frontend (new terminal)
cd website && npm install && npm run dev           # http://localhost:3000
```

Then open http://localhost:3000, **sign up**, set your keywords and platforms on
the **Config** page, and go to **Connections** to link a platform (paste your
session cookie). The scheduler scrapes on your behalf using your saved config,
and new leads appear on the Leads page.

Data lives in **Supabase Postgres**; identity is **Supabase Auth**. Session
cookies are stored **encrypted at rest** (AES-256-GCM) and never returned by the
API. Scraping real platforms may violate their Terms of Service and can put the
connected account at risk — see the notes in [server/README.md](server/README.md).

## Components

### 🌐 Website (Frontend)
The web application used by customers to:

- View newly discovered leads
- Search and filter opportunities
- Save/bookmark leads
- Configure scraping preferences
- Manage subscriptions
- Receive notifications
- View analytics and activity

---

### 🔐 Authentication Service
**Supabase Auth**, brokered by the API server (the browser never holds the
service key). Responsible for:

- User registration
- Login
- Password changes
- Access/refresh token management
- Email verification

---

### ⚙️ API Server
The central backend responsible for:

- User management
- Authentication
- Subscription handling
- Lead management
- Notifications
- Billing integration
- Dashboard data
- REST API

---

### 🕷️ Scraper Workers
Independent workers that scrape supported platforms.

Examples:

- Upwork Scraper
- Twitter/X Scraper
- Discord Scraper
- Reddit Scraper *(future)*
- LinkedIn Scraper *(future)*
- Freelancer Scraper *(future)*

Responsibilities:

- Fetch new posts/jobs
- Parse data
- Remove duplicates
- Push leads into the database

---

### ⏰ Scheduler
Runs scraping jobs on a schedule.

Responsibilities:

- Queue scraping tasks
- Respect platform rate limits
- Retry failed jobs
- Distribute work across workers

---

### 📨 Notification Service
Notifies users when matching leads are found.

Supports:

- Email
- Discord Webhooks
- Browser Push
- Slack *(future)*

---

### 💳 Billing Service
Handles subscriptions.

Responsibilities:

- Payments
- Subscription plans
- Invoices
- Usage limits

---

### 🗄️ Database
**Supabase Postgres.** Schema in [`supabase/migrations/`](supabase/migrations).
Row Level Security is enabled on every table. Stores:

- Users (`profiles`, mirroring `auth.users`)
- Per-user configuration (`user_config` — what the Config page edits)
- Leads (`leads`) and per-user lead state (`user_leads`)
- Connected platform sessions (`credentials`, encrypted)
- Scraping history (`scrape_runs`)
- Notifications
- Billing data (`subscriptions`)

---

### ⚡ Cache
Used for:

- Frequently accessed leads
- Sessions
- Rate limiting
- Temporary scraper data

---

### 📊 Analytics
Tracks:

- Leads discovered
- Platform performance
- User activity
- Search trends
- Conversion metrics

---

### 📂 Storage
Stores:

- User avatars
- Exported reports
- Scraper logs
- Attachments (if applicable)

## Data Flow

```
Scrapers
      ↓
 Scheduler
      ↓
 Processing
      ↓
 Database
      ↓
 API Server
      ↓
 Frontend
      ↓
 Notifications
```

## Supported Platforms

- Upwork
- Twitter/X
- Discord

### Planned

- Reddit
- LinkedIn
- Freelancer
- PeoplePerHour
- Fiverr
- RemoteOK
- Wellfound (AngelList)