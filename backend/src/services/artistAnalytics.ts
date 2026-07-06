// backend/src/services/artistAnalytics.ts
// Read-side queries for the artist analytics dashboard. Reads the daily rollup
// tables (migration 015) for the intent funnel + sales, plus reviews / table_models
// / daily_search_terms. All artist-scoped and aggregate-only.

import { db } from '../db';

const num = (v: any) => Number(v ?? 0) || 0;

export interface Range {
  from: string; // 'YYYY-MM-DD' inclusive
  to: string;   // inclusive
}

/** Days in a range + the immediately-preceding equal-length range (for deltas). */
export function previousRange(r: Range): Range {
  const from = new Date(r.from + 'T00:00:00Z');
  const to = new Date(r.to + 'T00:00:00Z');
  const days = Math.round((to.getTime() - from.getTime()) / 86400_000) + 1;
  const prevTo = new Date(from.getTime() - 86400_000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

async function periodTotals(artistId: string, r: Range) {
  const res = await db.query(
    `SELECT COALESCE(SUM(units_sold),0) units, COALESCE(SUM(gross),0) gross,
            COALESCE(SUM(net),0) net, COALESCE(SUM(views),0) views,
            COALESCE(SUM(placements),0) placements, COALESCE(SUM(wishlist_adds),0) wishlist
     FROM daily_model_stats WHERE artist_id = $1 AND day BETWEEN $2 AND $3`,
    [artistId, r.from, r.to],
  );
  const row = res.rows[0] ?? {};
  const views = num(row.views);
  const units = num(row.units);
  return {
    sales: units,
    gross: num(row.gross),
    net: num(row.net),
    views,
    placements: num(row.placements),
    wishlist: num(row.wishlist),
    conversion: views > 0 ? units / views : 0,
  };
}

export async function getSummary(artistId: string, r: Range) {
  const [totals, prev] = await Promise.all([periodTotals(artistId, r), periodTotals(artistId, previousRange(r))]);

  const rating = await db.query(
    `SELECT COUNT(*) cnt, COALESCE(AVG(rating),0) avg,
            COUNT(*) FILTER (WHERE rating = 5) r5,
            COUNT(*) FILTER (WHERE rating = 4) r4,
            COUNT(*) FILTER (WHERE rating = 3) r3,
            COUNT(*) FILTER (WHERE rating = 2) r2,
            COUNT(*) FILTER (WHERE rating = 1) r1
     FROM reviews r JOIN models m ON m.id = r.model_id
     WHERE m.artist_id = $1 AND r.is_visible = true`,
    [artistId],
  );
  const rr = rating.rows[0] ?? {};

  const topModels = await db.query(
    `SELECT s.model_id, m.name, m.part_count,
            SUM(s.units_sold) units, SUM(s.gross) gross, SUM(s.views) views,
            CASE WHEN SUM(s.views) > 0 THEN SUM(s.units_sold)::float / SUM(s.views) ELSE 0 END conversion
     FROM daily_model_stats s JOIN models m ON m.id = s.model_id
     WHERE s.artist_id = $1 AND s.day BETWEEN $2 AND $3
     GROUP BY s.model_id, m.name, m.part_count
     ORDER BY units DESC, gross DESC, views DESC
     LIMIT 8`,
    [artistId, r.from, r.to],
  );

  const tables = await db.query(
    `SELECT COUNT(DISTINCT tm.table_id) AS featured
     FROM table_models tm JOIN user_tables ut ON ut.id = tm.table_id
     WHERE tm.artist_id = $1 AND ut.is_public = true`,
    [artistId],
  );
  const topTable = await db.query(
    `SELECT ut.id, ut.name, ut.view_count
     FROM table_models tm JOIN user_tables ut ON ut.id = tm.table_id
     WHERE tm.artist_id = $1 AND ut.is_public = true
     ORDER BY ut.view_count DESC NULLS LAST LIMIT 1`,
    [artistId],
  );

  const searches = await siteSearches(r);

  return {
    range: r,
    totals,
    prev,
    rating: {
      avg: num(rr.avg),
      count: num(rr.cnt),
      distribution: { 5: num(rr.r5), 4: num(rr.r4), 3: num(rr.r3), 2: num(rr.r2), 1: num(rr.r1) },
    },
    topModels: topModels.rows.map((m: any) => ({
      modelId: m.model_id,
      name: m.name,
      isSet: (m.part_count ?? 1) > 1,
      units: num(m.units),
      gross: num(m.gross),
      views: num(m.views),
      conversion: num(m.conversion),
    })),
    featuredInTables: num(tables.rows[0]?.featured),
    mostViewedTable: topTable.rows[0]
      ? { id: topTable.rows[0].id, name: topTable.rows[0].name, viewCount: num(topTable.rows[0].view_count) }
      : null,
    topSearches: searches.top,
    zeroResultSearches: searches.zero,
  };
}

/** Daily time-series for the artist (summed across their models). */
export async function getTimeseries(artistId: string, r: Range) {
  const res = await db.query(
    `SELECT day, SUM(units_sold) units, SUM(gross) gross, SUM(net) net,
            SUM(views) views, SUM(placements) placements, SUM(wishlist_adds) wishlist
     FROM daily_model_stats WHERE artist_id = $1 AND day BETWEEN $2 AND $3
     GROUP BY day ORDER BY day ASC`,
    [artistId, r.from, r.to],
  );
  return res.rows.map((d: any) => ({
    day: d.day instanceof Date ? d.day.toISOString().slice(0, 10) : String(d.day).slice(0, 10),
    units: num(d.units),
    gross: num(d.gross),
    net: num(d.net),
    views: num(d.views),
    placements: num(d.placements),
    wishlist: num(d.wishlist),
  }));
}

/** Per-product table for the range (leaderboard drill-down). */
export async function getProducts(artistId: string, r: Range, sort = 'units') {
  const orderBy =
    { units: 'units DESC', gross: 'gross DESC', views: 'views DESC', conversion: 'conversion DESC' }[sort] ??
    'units DESC';
  const res = await db.query(
    `SELECT s.model_id, m.name, m.part_count, m.base_price, m.status,
            SUM(s.units_sold) units, SUM(s.gross) gross, SUM(s.net) net,
            SUM(s.views) views, SUM(s.placements) placements, SUM(s.wishlist_adds) wishlist,
            CASE WHEN SUM(s.views) > 0 THEN SUM(s.units_sold)::float / SUM(s.views) ELSE 0 END conversion
     FROM daily_model_stats s JOIN models m ON m.id = s.model_id
     WHERE s.artist_id = $1 AND s.day BETWEEN $2 AND $3
     GROUP BY s.model_id, m.name, m.part_count, m.base_price, m.status
     ORDER BY ${orderBy}, gross DESC`,
    [artistId, r.from, r.to],
  );
  return res.rows.map((m: any) => ({
    modelId: m.model_id,
    name: m.name,
    isSet: (m.part_count ?? 1) > 1,
    basePrice: num(m.base_price),
    status: m.status,
    units: num(m.units),
    gross: num(m.gross),
    net: num(m.net),
    views: num(m.views),
    placements: num(m.placements),
    wishlist: num(m.wishlist),
    conversion: num(m.conversion),
  }));
}

/** Site-wide search demand + zero-result gaps (ambient + tagging signal). */
export async function siteSearches(r: Range) {
  const top = await db.query(
    `SELECT query, SUM(searches) searches, SUM(zero_result_searches) zero
     FROM daily_search_terms WHERE day BETWEEN $1 AND $2
     GROUP BY query ORDER BY searches DESC LIMIT 15`,
    [r.from, r.to],
  );
  const zero = await db.query(
    `SELECT query, SUM(zero_result_searches) zero, SUM(searches) searches
     FROM daily_search_terms WHERE day BETWEEN $1 AND $2
     GROUP BY query HAVING SUM(zero_result_searches) > 0
     ORDER BY zero DESC LIMIT 15`,
    [r.from, r.to],
  );
  return {
    top: top.rows.map((s: any) => ({ query: s.query, searches: num(s.searches), zeroResults: num(s.zero) })),
    zero: zero.rows.map((s: any) => ({ query: s.query, zeroResults: num(s.zero), searches: num(s.searches) })),
  };
}

/** Per-product funnel + daily series (the drill-down "workhorse"). Verifies ownership. */
export async function getModelFunnel(modelId: string, artistId: string, r: Range) {
  const owner = await db.query('SELECT artist_id, name FROM models WHERE id = $1', [modelId]);
  if (owner.rows.length === 0 || owner.rows[0].artist_id !== artistId) return null;

  const totals = await db.query(
    `SELECT COALESCE(SUM(views),0) views, COALESCE(SUM(wishlist_adds),0) wishlist,
            COALESCE(SUM(placements),0) placements, COALESCE(SUM(units_sold),0) units,
            COALESCE(SUM(gross),0) gross, COALESCE(SUM(net),0) net
     FROM daily_model_stats WHERE model_id = $1 AND day BETWEEN $2 AND $3`,
    [modelId, r.from, r.to],
  );
  const series = await db.query(
    `SELECT day, views, wishlist_adds wishlist, placements, units_sold units, gross
     FROM daily_model_stats WHERE model_id = $1 AND day BETWEEN $2 AND $3
     ORDER BY day ASC`,
    [modelId, r.from, r.to],
  );
  const t = totals.rows[0] ?? {};
  const views = num(t.views);
  const units = num(t.units);
  return {
    modelId,
    name: owner.rows[0].name,
    range: r,
    funnel: {
      views,
      wishlist: num(t.wishlist),
      placements: num(t.placements),
      sales: units,
      conversion: views > 0 ? units / views : 0,
    },
    gross: num(t.gross),
    net: num(t.net),
    series: series.rows.map((d: any) => ({
      day: d.day instanceof Date ? d.day.toISOString().slice(0, 10) : String(d.day).slice(0, 10),
      views: num(d.views),
      wishlist: num(d.wishlist),
      placements: num(d.placements),
      units: num(d.units),
      gross: num(d.gross),
    })),
  };
}
