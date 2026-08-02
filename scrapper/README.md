# scrapper/

Platform scrapers for FindClients. **These are placeholders for you to implement.**

The server (`../server`) loads `index.ts` at runtime, runs every scraper you list
in the exported `scrapers` array on a schedule, then handles de-duplication,
storage, and notifications for you.

## The contract

Every scraper implements the `Scraper` interface from the server:

```ts
import type { Scraper, RawLead, ScrapeContext } from '../server/src/scrapers/types';

export const myScraper: Scraper = {
  platform: 'upwork',           // 'upwork' | 'twitter' | 'discord' | 'reddit' | 'linkedin'
  name: 'Upwork',
  async scrape(ctx: ScrapeContext): Promise<RawLead[]> {
    // fetch → parse → return. Returning [] is fine.
    return [];
  },
};
```

A `RawLead` looks like:

```ts
{
  title: string;
  platform: Platform;
  description: string;
  budget?: string | null;
  timeline?: string | null;
  url?: string | null;      // used for de-duplication — prefer a stable permalink
  author?: string | null;
  tags?: string[];
  postedAt?: string | Date; // when it was posted on the source
}
```

## Wiring it up

1. Implement the `scrape()` method in `upwork/`, `twitter/`, or `discord/`.
2. Add the scraper to the `scrapers` array in [`index.ts`](./index.ts).
3. Anything you export there **overrides the server's demo scraper** for that
   platform. Set `USE_DEMO_SCRAPERS=false` in `server/.env` once your real
   scrapers produce leads.

## Notes

- Keep scrapers side-effect free: fetch + parse + return. Don't touch the DB.
- Respect each platform's Terms of Service and rate limits.
- Throwing is safe — the server records the failure in `scrape_runs` and keeps
  the other scrapers running.
