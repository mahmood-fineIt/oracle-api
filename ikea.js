// IKEA KSA dataset for HiveIQ's Oracle integration (accounts sync, trial balance, segment values).
// Served only to the HiveIQ login, so the lease-hive logins keep seeing exactly the original mock.
// Data lives in data/ikea-ksa.json: Aug–Oct 2026 closing balances per account combination.
import fs from 'fs';
import express from 'express';

export const IKEA_USER = process.env.MOCK_IKEA_USER || 'hiveiq.integration';
export const IKEA_PASSWORD = process.env.MOCK_IKEA_PASSWORD || 'Welcome1';

const data = JSON.parse(fs.readFileSync(new URL('./data/ikea-ksa.json', import.meta.url), 'utf8'));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const periodName = (p) => `${MONTHS[Number(p.slice(5)) - 1]}-${p.slice(2, 4)}`; // 2026-10 -> Oct-26
const periodsByName = new Map(Object.keys(data.balances).map((p) => [periodName(p), p]));
const periodKeys = Object.keys(data.balances).sort();

const VALUE_SETS = [
  { ValueSetId: 300201, ValueSetCode: 'IKSA_COMPANY', Description: 'Company', hash: '00020000000EACED0005770800000000000A0001', values: [{ value: data.company, description: 'Ghassan Ahmed Al Sulaiman Furniture (IKEA KSA)' }] },
  { ValueSetId: 300202, ValueSetCode: 'IKSA_ACCOUNT', Description: 'Natural account', hash: '00020000000EACED0005770800000000000A0002', values: data.accounts },
  ...['IKSA_DEPARTMENT', 'IKSA_PROJECT', 'IKSA_SERVICE_LINE'].map((code, i) => ({
    ValueSetId: 300203 + i, ValueSetCode: code, Description: code.replace('IKSA_', '').replace('_', ' '), hash: `00020000000EACED0005770800000000000A000${3 + i}`, values: data.valueSets[code],
  })),
];

const valueItem = (v, i) => ({
  ValueId: 500000 + i, Value: v.value, Description: v.description, AccountType: v.type || null,
  EnabledFlag: 'Y', SummaryFlag: 'N', DetailPostingAllowed: 'Y', StartDateActive: null, EndDateActive: null,
});

export function ikeaRouter(BASE, collection, applyQ) {
  const r = express.Router();

  r.get(`/ledgersLOV`, (req, res) => res.json(collection(applyQ([data.ledger], req.query.q), req)));

  const setItem = (req, vs) => {
    const self = `${req.protocol}://${req.get('host')}${BASE}/valueSets/${vs.hash}`;
    return { ValueSetId: vs.ValueSetId, ValueSetCode: vs.ValueSetCode, Description: vs.Description,
      links: [{ rel: 'self', href: self, name: 'valueSets', kind: 'item' }, { rel: 'child', href: `${self}/child/values`, name: 'values', kind: 'collection' }] };
  };
  r.get(`/valueSets`, (req, res) => {
    const [finder, ...pairs] = String(req.query.finder || '').split(';');
    const args = Object.fromEntries(pairs.map((p) => p.split('=')));
    const sets = finder === 'ValueSetCodeFinder' ? VALUE_SETS.filter((v) => v.ValueSetCode === decodeURIComponent(args.ValueSetCode || '')) : VALUE_SETS;
    res.json(collection(sets.map((v) => setItem(req, v)), req));
  });
  r.get(`/valueSets/:hash/child/values`, (req, res) => {
    const vs = VALUE_SETS.find((v) => v.hash === req.params.hash);
    if (!vs) return res.status(404).json({ title: 'Not Found' });
    res.json(collection(applyQ(vs.values.map(valueItem), req.query.q), req));
  });

  // Closing balances per account combination for one period, as the ledgerBalances resource returns them:
  //   GET /ledgerBalances?finder=AccountBalanceByCombinationFinder;ledgerName=…;accountingPeriod=Oct-26;currencyCode=SAR
  // EndingBalance is net (debit +, credit −); income-statement accounts are year-to-date, as in Fusion.
  r.get(`/ledgerBalances`, (req, res) => {
    const [, ...pairs] = String(req.query.finder || '').split(';');
    const args = Object.fromEntries(pairs.map((p) => { const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))]; }));
    if (args.ledgerName && args.ledgerName !== data.ledger.Name) return res.status(400).json({ title: 'Bad Request', detail: `Ledger "${args.ledgerName}" was not found` });
    if (!args.accountingPeriod) return res.status(400).json({ title: 'Bad Request', detail: 'accountingPeriod is required' });
    const period = periodsByName.get(args.accountingPeriod);
    if (!period) return res.json(collection([], req));
    const prev = periodKeys[periodKeys.indexOf(period) - 1];
    const prevNet = new Map((prev ? data.balances[prev] : []).map((b) => [b.slice(0, 4).join('|'), b[4]]));
    const items = data.balances[period].map(([acct, dept, proj, sl, net]) => {
      const begin = prevNet.has([acct, dept, proj, sl].join('|')) ? prevNet.get([acct, dept, proj, sl].join('|')) : 0;
      const delta = Math.round((net - begin) * 100) / 100;
      return {
        LedgerName: data.ledger.Name, Currency: data.ledger.CurrencyCode, PeriodName: args.accountingPeriod, ActualFlag: 'A',
        AccountCombination: [data.company, acct, dept, proj, sl].join('-'),
        Segment1: data.company, Segment2: acct, Segment3: dept, Segment4: proj, Segment5: sl,
        BeginningBalance: begin, PeriodActivityDr: delta > 0 ? delta : 0, PeriodActivityCr: delta < 0 ? -delta : 0, EndingBalance: net,
      };
    });
    res.json(collection(items, req));
  });

  return r;
}
