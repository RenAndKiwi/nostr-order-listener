import { logger } from './logger.js';

export interface WcConfig {
  url: string;
  consumerKey: string;
  consumerSecret: string;
}

export interface WcProduct {
  id: number;
  name: string;
  status: string;
  description: string;
  short_description: string;
  price: string;
  regular_price: string;
  stock_quantity: number | null;
  in_stock: boolean;
  stock_status: string;
  images: Array<{ src: string }>;
  categories: Array<{ name: string }>;
  sku: string;
}

export async function fetchWooCommerceProducts(wc: WcConfig): Promise<WcProduct[]> {
  const products: WcProduct[] = [];
  const baseUrl = wc.url.replace(/\/+$/, '');
  let page = 1;

  while (true) {
    const url = `${baseUrl}/wp-json/wc/v3/products?status=publish&per_page=100&page=${page}&consumer_key=${encodeURIComponent(wc.consumerKey)}&consumer_secret=${encodeURIComponent(wc.consumerSecret)}`;

    try {
      const res = await fetch(url);

      if (!res.ok) {
        const err = await res.text();
        logger.error({ status: res.status, error: err }, 'WooCommerce API error');
        break;
      }

      const batch: WcProduct[] = await res.json();
      if (!batch.length) break;

      products.push(...batch);
      if (batch.length < 100) break;
      page++;
    } catch (err) {
      logger.error({ err, page }, 'Failed to fetch WooCommerce products');
      break;
    }
  }

  logger.info({ count: products.length }, 'Fetched WooCommerce products');
  return products;
}
