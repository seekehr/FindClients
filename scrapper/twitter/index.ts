import type { RawLead, Scraper, ScrapeContext } from '../../server/src/scrapers/types';

/**
 * Twitter/X scraper — PLACEHOLDER.
 *
 * TODO (you): search recent tweets for hiring intent (e.g. "looking for a
 * developer", "hiring", "DM me") and map matches to RawLead[]. Options: the
 * X API v2 recent-search endpoint, or a third-party provider. Mind rate limits.
 */
export const twitterScraper: Scraper = {
  platform: 'twitter',
  name: 'Twitter/X',

  async scrape(ctx: ScrapeContext): Promise<RawLead[]> {
    ctx.log('twitter scraper not implemented yet');
    return [];
  },
};

export default twitterScraper;
