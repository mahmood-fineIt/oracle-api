// Cash-forecasting dataset: the AR / AP / overhead actuals and the sales / purchase / overhead
// forecasts the Cash Flow AI ingest step otherwise takes as two Excel files.
// Served only to the cash-forecasting login, so the other logins keep seeing their own data.
// Data lives in data/cashforecast.json, one collection per sheet, rows keyed by the sheet's columns.
import fs from 'fs';
import express from 'express';

export const CF_USER = process.env.MOCK_CF_USER || 'cashforecast.integration';
export const CF_PASSWORD = process.env.MOCK_CF_PASSWORD || 'Welcome1';

const datasets = JSON.parse(fs.readFileSync(new URL('./data/cashforecast.json', import.meta.url), 'utf8'));

export function cashForecastRouter(collection, applyQ) {
  const r = express.Router();

  // Catalogue of what this login can pull: one entry per collection, with its kind (actual | forecast).
  r.get('/cashForecastSources', (req, res) => res.json(collection(applyQ(datasets.map(d => ({
    Resource: d.resource, Kind: d.kind, Name: d.label, RowCount: d.rows.length, Columns: d.headers,
  })), req.query.q), req)));

  for (const d of datasets) {
    r.get(`/${d.resource}`, (req, res) => res.json(collection(applyQ(d.rows, req.query.q), req)));
  }
  return r;
}
