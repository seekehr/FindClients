# FindClients

This is a SaaS that basically allows you to monitor all leads through scrapping coming from platforms including: Upwork, Twitter, and Discord, and other platforms in the future.

## Repository layout

| Folder                       | What it is                                                                 |
| ---------------------------- | -------------------------------------------------------------------------- |
| [`website/`](website)        | Next.js frontend (dashboard, leads, analytics, settings).                  |
| [`server/`](server)          | REST API + auth + scheduler + notifications + billing. See [server/README.md](server/README.md). |
| [`scrapper/`](scrapper)      | Platform scrapers — **placeholders you implement**. See [scrapper/README.md](scrapper/README.md). |

### Quick start (backend)

```bash
cd server
npm install
npm run dev        # http://localhost:4000  (demo login: demo@findclients.dev / demo12345)
```

The server runs as a **zero-config demo**: it uses Node's built-in SQLite (no
database server, no native build), seeds sample data on first boot, and runs
built-in *demo scrapers* on a schedule so the whole pipeline is visibly alive
before the real scrapers in `scrapper/` are implemented.

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
Responsible for:

- User registration
- Login
- Password resets
- Session/JWT management
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
Stores:

- Users
- Leads
- Saved leads
- Scraping history
- Notifications
- Billing data
- Settings

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