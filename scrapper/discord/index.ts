import type { RawLead, Scraper, ScrapeContext } from '../../server/src/scrapers/types';

/**
 * Discord scraper — PLACEHOLDER.
 *
 * TODO (you): read designated "hiring" / "for-hire" channels in servers your
 * bot has joined and map messages to RawLead[]. Use a bot token + the Discord
 * API (discord.js). Only read channels you're authorized to read.
 */
export const discordScraper: Scraper = {
  platform: 'discord',
  name: 'Discord',

  async scrape(ctx: ScrapeContext): Promise<RawLead[]> {
    ctx.log('discord scraper not implemented yet');
    return [];
  },
};

export default discordScraper;
