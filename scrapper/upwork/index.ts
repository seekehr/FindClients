import type { RawLead, Scraper, ScrapeContext } from '../../server/src/scrapers/types';

/**
 * Upwork scraper — PLACEHOLDER.
 *
 * TODO (you): fetch new job postings and map them to RawLead[].
 * Ideas: Upwork RSS feeds per search term, the GraphQL API, or headless
 * browsing. Respect Upwork's ToS and rate limits.
 *
 * The server handles de-duplication (by url/title), persistence, and
 * notifications — just return what you find. Returning [] is a valid no-op.
 */
export const upworkScraper: Scraper = {
  platform: 'upwork',
  name: 'Upwork',

  async scrape(ctx: ScrapeContext): Promise<RawLead[]> {
    ctx.log('upwork scraper not implemented yet');

    // Example of the shape to return (delete when you implement for real):
    //
    // return [{
    //   title: 'Need a Next.js developer',
    //   platform: 'upwork',
    //   description: 'Full job description text…',
    //   budget: '$2,000 - $4,000',
    //   timeline: '3 weeks',
    //   url: 'https://www.upwork.com/jobs/~0123456789',
    //   author: 'client-username',
    //   tags: ['Next.js', 'React'],
    //   postedAt: new Date(),
    // }];

    return [];
  },
};

export default upworkScraper;
