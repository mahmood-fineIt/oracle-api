// Mock Oracle Fusion ERP — just enough of the GL journal import API to build against.
// Real Fusion: upload a zipped GlInterface.csv via erpintegrations (importBulkData),
// which queues the "Import Journals" ESS job; the caller then polls the job status.
import express from 'express';
import AdmZip from 'adm-zip';
import { ikeaRouter, IKEA_USER, IKEA_PASSWORD } from './ikea.js';

const PORT = process.env.PORT || 5050;
const USERNAME = process.env.MOCK_USER || 'fusion.integration';
const PASSWORD = process.env.MOCK_PASSWORD || 'Welcome1';
const BASE = '/fscmRestApi/resources/11.13.18.05';

// ---------------------------------------------------------------------------
// Fake setup data
// ---------------------------------------------------------------------------
const LEDGERS = [
  { LedgerId: 300000001, Name: 'KSA Primary Ledger', CurrencyCode: 'SAR', ChartOfAccountsId: 101, PeriodSetName: 'Monthly', AccountedPeriodType: 'Month' },
  { LedgerId: 300000002, Name: 'UAE Primary Ledger', CurrencyCode: 'AED', ChartOfAccountsId: 101, PeriodSetName: 'Monthly', AccountedPeriodType: 'Month' },
  { LedgerId: 300000003, Name: 'Group USD Ledger', CurrencyCode: 'USD', ChartOfAccountsId: 101, PeriodSetName: 'Monthly', AccountedPeriodType: 'Month' },
];

const JOURNAL_SOURCES = ['Contract Hive', 'Manual', 'Spreadsheet', 'Payables', 'Receivables', 'Assets'];
const JOURNAL_CATEGORIES = ['Lease Accounting', 'Adjustment', 'Accrual', 'Depreciation', 'Reclassification'];

// Chart of accounts: Company-CostCentre-Account-Intercompany
// Same shape as a typical Xero chart (bank, revenue, expenses, assets, liabilities, equity)
// plus the IFRS 16 lease accounts. Types: A asset, L liability, O equity, R revenue, E expense.
const NATURAL_ACCOUNTS = [
  // Bank & current assets
  ['10900', 'Business Bank Account', 'A'],
  ['10910', 'Business Savings Account', 'A'],
  ['12000', 'Accounts Receivable', 'A'],
  ['12100', 'Prepayments', 'A'],
  ['12200', 'Prepaid Rent', 'A'],
  ['12300', 'Lease Security Deposits', 'A'],
  // Fixed assets
  ['17100', 'Office Equipment', 'A'],
  ['17110', 'Less Accumulated Depreciation on Office Equipment', 'A'],
  ['17200', 'Computer Equipment', 'A'],
  ['17210', 'Less Accumulated Depreciation on Computer Equipment', 'A'],
  ['17300', 'Motor Vehicles', 'A'],
  ['17310', 'Less Accumulated Depreciation on Motor Vehicles', 'A'],
  // Right-of-use assets (IFRS 16)
  ['15100', 'Right-of-Use Asset - Buildings', 'A'],
  ['15110', 'Right-of-Use Asset - Land', 'A'],
  ['15120', 'Right-of-Use Asset - Vehicles', 'A'],
  ['15130', 'Right-of-Use Asset - Equipment', 'A'],
  ['15200', 'Accumulated Depreciation - ROU Buildings', 'A'],
  ['15210', 'Accumulated Depreciation - ROU Land', 'A'],
  ['15220', 'Accumulated Depreciation - ROU Vehicles', 'A'],
  ['15230', 'Accumulated Depreciation - ROU Equipment', 'A'],
  // Current liabilities
  ['21100', 'Accounts Payable', 'L'],
  ['21200', 'Unpaid Expense Claims', 'L'],
  ['21300', 'VAT Payable', 'L'],
  ['21400', 'Income Tax Payable', 'L'],
  ['21500', 'Lease Liability - Current', 'L'],
  ['21600', 'Accrued Interest on Lease Liability', 'L'],
  ['21700', 'Accrued Lease Payments', 'L'],
  ['21800', 'Lease Payments Clearing', 'L'],
  ['21900', 'Suspense', 'L'],
  // Non-current liabilities
  ['25100', 'Loan', 'L'],
  ['25500', 'Lease Liability - Non Current', 'L'],
  ['25600', 'Provision for Restoration Costs', 'L'],
  ['25700', 'Deferred Gain on Sale and Leaseback', 'L'],
  // Equity
  ['31000', 'Retained Earnings', 'O'],
  ['32000', 'Share Capital', 'O'],
  // Revenue
  ['40000', 'Sales', 'R'],
  ['42000', 'Other Revenue', 'R'],
  ['42100', 'Sublease Income', 'R'],
  ['42700', 'Interest Income', 'R'],
  // Expenses
  ['50000', 'Cost of Goods Sold', 'E'],
  ['60000', 'Advertising', 'E'],
  ['60400', 'Bank Fees', 'E'],
  ['60800', 'Cleaning', 'E'],
  ['61200', 'Consulting & Accounting', 'E'],
  ['61600', 'Depreciation', 'E'],
  ['61700', 'Depreciation Expense - Right-of-Use Assets', 'E'],
  ['62000', 'Entertainment', 'E'],
  ['62900', 'General Expenses', 'E'],
  ['63300', 'Insurance', 'E'],
  ['63700', 'Interest Expense', 'E'],
  ['63710', 'Interest Expense - Lease Liabilities', 'E'],
  ['64100', 'Legal Expenses', 'E'],
  ['64500', 'Light, Power, Heating', 'E'],
  ['64900', 'Motor Vehicle Expenses', 'E'],
  ['65300', 'Office Expenses', 'E'],
  ['66900', 'Rent', 'E'],
  ['66910', 'Short-term and Low-value Lease Expense', 'E'],
  ['66920', 'Variable Lease Payments', 'E'],
  ['67300', 'Repairs and Maintenance', 'E'],
  ['67700', 'Wages and Salaries', 'E'],
  ['68900', 'Telephone & Internet', 'E'],
  ['69300', 'Travel', 'E'],
  ['70100', 'Gain/Loss on Lease Modification', 'E'],
  ['70200', 'Gain/Loss on Lease Termination', 'E'],
  ['70300', 'Foreign Exchange Gain/Loss', 'E'],
  ['70400', 'Impairment of Right-of-Use Assets', 'E'],
  ['91900', 'Old Suspense (DISABLED)', 'E'],
];
const COMPANIES = ['101', '102', '103'];
const COMPANY_LEDGER = { 101: 300000001, 102: 300000002, 103: 300000003 }; // company segment -> ledger it belongs to
let ccid = 10000;
const ACCOUNT_COMBINATIONS = [];
for (const company of COMPANIES) {
  for (const [account, description, type] of NATURAL_ACCOUNTS) {
    ACCOUNT_COMBINATIONS.push({
      _CODE_COMBINATION_ID: ++ccid,
      _CHART_OF_ACCOUNTS_ID: 101,
      EnabledFlag: account === '91900' ? 'N' : 'Y',
      AccountType: type,
      Segment1: company,
      Segment2: '000',
      Segment3: account,
      Segment4: '000',
      ConcatenatedSegments: `${company}-000-${account}-000`,
      Description: `${{ 101: 'KSA', 102: 'UAE', 103: 'Group' }[company]} - ${description}`,
    });
  }
}
const SEGMENT_COUNT = 4;
const comboByCode = new Map(ACCOUNT_COMBINATIONS.map(c => [c.ConcatenatedSegments, c]));

// ---------------------------------------------------------------------------
// GlInterface.csv layout (no header row). Positions follow the field order of Oracle's
// GlInterface.ctl loader (JournalImportTemplate.xlsm).
// ---------------------------------------------------------------------------
const COL = {
  STATUS: 0, LEDGER_ID: 1, ACCOUNTING_DATE: 2, SOURCE: 3, CATEGORY: 4, CURRENCY: 5,
  DATE_CREATED: 6, ACTUAL_FLAG: 7, SEGMENT1: 8, // SEGMENT1..SEGMENT30 = 8..37
  ENTERED_DR: 38, ENTERED_CR: 39, ACCOUNTED_DR: 40, ACCOUNTED_CR: 41,
  REFERENCE1: 42, // REFERENCE1..REFERENCE10 = 42..51 (1 batch name, 4 journal name, 5 journal desc, 10 line desc)
  // 52..61 REFERENCE21..30, 62 STAT_AMOUNT, 63..65 currency conversion type / date / rate
  GROUP_ID: 66,
};

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  return rows;
}

const num = v => (v === undefined || v === '' ? 0 : Number(v));
const round2 = n => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
let nextRequestId = 500000;
let nextHeaderId = 900000;
let nextBatchId = 700000;
const batchIds = new Map(); // batch name -> JeBatchId
const jobs = new Map();     // requestId -> job
const journals = [];        // imported journal headers

/** Validates the uploaded rows the way Journal Import would; returns per-journal results. */
function runJournalImport(rows, params) {
  const groups = new Map(); // journal name (REFERENCE4) + group -> lines
  const lineErrors = [];

  rows.forEach((r, idx) => {
    const key = `${r[COL.GROUP_ID] || params.groupId}|${r[COL.REFERENCE1 + 3] || 'Journal'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ r, line: idx + 1 });
  });

  const results = [];
  for (const [key, lines] of groups) {
    const errors = [];
    const first = lines[0].r;
    const ledger = LEDGERS.find(l => String(l.LedgerId) === String(first[COL.LEDGER_ID]));
    if (!ledger) errors.push(`EF01: Invalid ledger ${first[COL.LEDGER_ID]}`);
    if (!JOURNAL_SOURCES.includes(first[COL.SOURCE])) errors.push(`EU01: Invalid journal source "${first[COL.SOURCE]}"`);
    if (!JOURNAL_CATEGORIES.includes(first[COL.CATEGORY])) errors.push(`EU02: Invalid journal category "${first[COL.CATEGORY]}"`);
    if (ledger && first[COL.CURRENCY] !== ledger.CurrencyCode) errors.push(`EC01: Currency ${first[COL.CURRENCY]} does not match ledger currency ${ledger.CurrencyCode}`);
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(first[COL.ACCOUNTING_DATE] || '')) errors.push(`EP01: Accounting date "${first[COL.ACCOUNTING_DATE]}" must be YYYY/MM/DD`);
    else if (first[COL.ACCOUNTING_DATE] < '2020/01/01') errors.push(`EP01: Period for ${first[COL.ACCOUNTING_DATE]} is not open`);

    let dr = 0, cr = 0;
    for (const { r, line } of lines) {
      if (r[COL.STATUS] !== 'NEW') errors.push(`Line ${line}: STATUS must be NEW`);
      if (r[COL.ACTUAL_FLAG] !== 'A') errors.push(`Line ${line}: ACTUAL_FLAG must be A`);
      const code = r.slice(COL.SEGMENT1, COL.SEGMENT1 + SEGMENT_COUNT).join('-');
      const combo = comboByCode.get(code);
      if (!combo) errors.push(`Line ${line}: EE01 Invalid account combination ${code}`);
      else if (combo.EnabledFlag !== 'Y') errors.push(`Line ${line}: EE02 Account combination ${code} is disabled`);
      if (ledger && combo && COMPANY_LEDGER[combo.Segment1] !== ledger.LedgerId) {
        errors.push(`Line ${line}: Company ${combo.Segment1} does not belong to ledger ${ledger.Name}`);
      }
      const d = num(r[COL.ENTERED_DR]), c = num(r[COL.ENTERED_CR]);
      if (d && c) errors.push(`Line ${line}: line has both debit and credit`);
      dr += d; cr += c;
    }
    dr = round2(dr); cr = round2(cr);
    if (dr !== cr) errors.push(`EU04: Journal not balanced (debit ${dr}, credit ${cr})`);

    const [groupId, journalName] = key.split('|');
    const result = { groupId, journalName, batchName: first[COL.REFERENCE1], lineCount: lines.length, totalDebit: dr, errors };
    if (!errors.length) {
      const batchName = first[COL.REFERENCE1];
      if (!batchIds.has(batchName)) batchIds.set(batchName, ++nextBatchId);
      const header = {
        JeHeaderId: ++nextHeaderId,
        JeBatchId: batchIds.get(batchName),
        RequestId: params.requestId,
        JournalName: journalName,
        BatchName: first[COL.REFERENCE1],
        Description: first[COL.REFERENCE1 + 4],
        LedgerId: Number(first[COL.LEDGER_ID]),
        LedgerName: ledger.Name,
        JournalSource: first[COL.SOURCE],
        JournalCategory: first[COL.CATEGORY],
        AccountingDate: first[COL.ACCOUNTING_DATE].replace(/\//g, '-'),
        CurrencyCode: first[COL.CURRENCY],
        GroupId: groupId,
        Status: 'Unposted',
        TotalDebit: dr,
        TotalCredit: cr,
        Lines: lines.map(({ r }, i) => ({
          LineNumber: i + 1,
          Account: r.slice(COL.SEGMENT1, COL.SEGMENT1 + SEGMENT_COUNT).join('-'),
          EnteredDr: num(r[COL.ENTERED_DR]) || null,
          EnteredCr: num(r[COL.ENTERED_CR]) || null,
          Description: r[COL.REFERENCE1 + 9] || null,
        })),
        CreatedAt: new Date().toISOString(),
      };
      journals.push(header);
      result.jeHeaderId = header.JeHeaderId;
    }
    lineErrors.push(...errors.map(e => `[${journalName}] ${e}`));
    results.push(result);
  }
  return { results, lineErrors };
}

function buildLog(job) {
  const out = [
    `Oracle Fusion General Ledger: Import Journals (MOCK)`,
    `Request ID: ${job.requestId}`,
    `Source: ${job.params.source}   Ledger: ${job.params.ledgerId}   Group ID: ${job.params.groupId}`,
    `File: ${job.fileName}`,
    '',
  ];
  for (const r of job.results) {
    out.push(`Journal "${r.journalName}" (${r.lineCount} lines, debit ${r.totalDebit}): ${r.errors.length ? 'REJECTED' : `IMPORTED as JeHeaderId ${r.jeHeaderId}`}`);
    for (const e of r.errors) out.push(`    ${e}`);
  }
  const ok = job.results.filter(r => !r.errors.length).length;
  out.push('', `Journals imported: ${ok}`, `Journals rejected: ${job.results.length - ok}`);
  return out.join('\n');
}

/** Status moves WAIT -> RUNNING -> final, one step per poll (or after ~6s). */
function currentStatus(job) {
  const age = Date.now() - job.createdAt;
  job.polls++;
  if (job.polls <= 1 && age < 3000) return 'WAIT';
  if (job.polls <= 2 && age < 6000) return 'RUNNING';
  return job.finalStatus;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
// Behind nginx/TLS: take the protocol and host from X-Forwarded-* so links in responses are https.
app.set('trust proxy', true);
app.use(express.json({ limit: '50mb', type: ['application/json', 'application/*+json'] }));
app.use((req, _res, next) => { console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl.slice(0, 160)}`); next(); });

// Health + debug endpoints (not part of Fusion; no auth)
app.get('/', (_req, res) => res.json({ service: 'Mock Oracle Fusion', base: BASE, user: USERNAME }));
app.get('/mock/jobs', (_req, res) => res.json([...jobs.values()].map(({ rows, ...j }) => ({ ...j, status: j.finalStatus }))));
app.get('/mock/journals', (_req, res) => res.json(journals));
app.get('/mock/accounts', (_req, res) => res.json(ACCOUNT_COMBINATIONS.map(c => ({ code: c.ConcatenatedSegments, name: c.Description, enabled: c.EnabledFlag === 'Y' }))));
app.post('/mock/reset', (_req, res) => { jobs.clear(); journals.length = 0; res.json({ ok: true }); });

// Basic auth on everything under the Fusion base path
app.use(BASE, (req, res, next) => {
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    if (user === USERNAME && pass === PASSWORD) return next();
    if (user === IKEA_USER && pass === IKEA_PASSWORD) { req.ikea = true; return next(); }
  }
  res.set('WWW-Authenticate', 'Basic realm="Oracle Fusion"').status(401).json({ title: 'Unauthorized', status: '401' });
});

const ikea = ikeaRouter(BASE, (...a) => collection(...a), (...a) => applyQ(...a));
app.use(BASE, (req, res, next) => (req.ikea ? ikea(req, res, next) : next()));

const collection = (items, req) => {
  const limit = Number(req.query.limit) || 25;
  const offset = Number(req.query.offset) || 0;
  const page = items.slice(offset, offset + limit);
  return { items: page, count: page.length, hasMore: offset + limit < items.length, limit, offset };
};

// Simple `q` support: "Field=value;Field2=value2" (exact) or Field LIKE '%x%'
function applyQ(items, q) {
  if (!q) return items;
  return q.split(';').reduce((list, cond) => {
    const like = cond.match(/^(\w+)\s+LIKE\s+'(.*)'$/i);
    if (like) {
      const escape = p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('^' + like[2].split('%').map(escape).join('.*') + '$', 'i');
      return list.filter(i => re.test(String(i[like[1]] ?? '')));
    }
    const [field, value] = cond.split('=');
    return list.filter(i => String(i[field?.trim()]) === value?.trim().replace(/^'|'$/g, ''));
  }, items);
}

app.get(`${BASE}/ledgersLOV`, (req, res) => res.json(collection(applyQ(LEDGERS, req.query.q), req)));
// Real accountCombinationsLOV returns only these fields: no segment values, codes or descriptions.
// The full chart above is used only to validate imported journals, as Fusion does.
const LOV_FIELDS = ['_CODE_COMBINATION_ID', '_CHART_OF_ACCOUNTS_ID', 'EnabledFlag', 'StartDateActive', 'EndDateActive'];
app.get(`${BASE}/accountCombinationsLOV`, (req, res) => res.json(collection(applyQ(ACCOUNT_COMBINATIONS, req.query.q)
  .map(c => Object.fromEntries(LOV_FIELDS.map(f => [f, f === 'StartDateActive' ? '2020-01-01' : f === 'EndDateActive' ? null : c[f]]))), req)));
// Value sets (Common Features API). The natural account segment's value set gives account codes
// with names; its values child is reached through the link in the value set (the id is a hash key).
const VALUE_SETS = [{ ValueSetId: 300100, ValueSetCode: 'ACCOUNTS', Description: 'Natural account', hash: '00020000000EACED0005770800000000000493E4' }];
const ACCOUNT_VALUES = NATURAL_ACCOUNTS.map(([account, description, type], i) => ({
  ValueId: 400000 + i, Value: account, Description: description, AccountType: type,
  EnabledFlag: account === '91900' ? 'N' : 'Y', SummaryFlag: 'N', DetailPostingAllowed: 'Y', StartDateActive: null, EndDateActive: null,
}));
const valueSetItem = (req, vs) => {
  const self = `${req.protocol}://${req.get('host')}${BASE}/valueSets/${vs.hash}`;
  return { ValueSetId: vs.ValueSetId, ValueSetCode: vs.ValueSetCode, Description: vs.Description,
    links: [{ rel: 'self', href: self, name: 'valueSets', kind: 'item' }, { rel: 'child', href: `${self}/child/values`, name: 'values', kind: 'collection' }] };
};
app.get(`${BASE}/valueSets`, (req, res) => {
  const [finder, ...pairs] = String(req.query.finder || '').split(';');
  const args = Object.fromEntries(pairs.map(p => p.split('=')));
  const sets = finder === 'ValueSetCodeFinder' ? VALUE_SETS.filter(v => v.ValueSetCode === decodeURIComponent(args.ValueSetCode || '')) : VALUE_SETS;
  res.json(collection(sets.map(v => valueSetItem(req, v)), req));
});
app.get(`${BASE}/valueSets/:hash/child/values`, (req, res) => {
  if (!VALUE_SETS.some(v => v.hash === req.params.hash)) return res.status(404).json({ title: 'Not Found' });
  res.json(collection(applyQ(ACCOUNT_VALUES, req.query.q), req));
});

app.get(`${BASE}/journalSourcesLOV`, (req, res) => res.json(collection(applyQ(JOURNAL_SOURCES.map((n, i) => ({ JeSourceName: n.toUpperCase().replace(/ /g, '_'), UserJeSourceName: n, Description: `${n} journals`, JeSourceId: i + 1 })), req.query.q), req)));
app.get(`${BASE}/journalCategoriesLOV`, (req, res) => res.json(collection(applyQ(JOURNAL_CATEGORIES.map((n, i) => ({ JeCategoryName: n.toUpperCase().replace(/ /g, '_'), UserJeCategoryName: n, Description: `${n} journals`, JeCategoryId: i + 1 })), req.query.q), req)));
// Real journalBatches: one row per batch, journals under the journalHeaders child (no group id filter).
const headerItem = j => ({ JournalName: j.JournalName, JournalDescription: j.Description, LedgerName: j.LedgerName, UserJeCategoryName: j.JournalCategory,
  CurrencyCode: j.CurrencyCode, PeriodName: j.AccountingDate.slice(0, 7), RunningTotalDr: j.TotalDebit, RunningTotalCr: j.TotalCredit });
function batches(expand) {
  const byId = new Map();
  for (const j of journals) {
    if (!byId.has(j.JeBatchId)) byId.set(j.JeBatchId, { JeBatchId: j.JeBatchId, BatchName: j.BatchName, UserJeSourceName: j.JournalSource, Status: 'U', StatusMeaning: 'Unposted', RequestId: j.RequestId, headers: [] });
    byId.get(j.JeBatchId).headers.push(headerItem(j));
  }
  return [...byId.values()].map(({ headers, ...b }) => (expand ? { ...b, journalHeaders: { items: headers, count: headers.length, hasMore: false } } : b));
}
app.get(`${BASE}/journalBatches`, (req, res) => res.json(collection(applyQ(batches(String(req.query.expand || '').includes('journalHeaders')), req.query.q), req)));
app.get(`${BASE}/journalBatches/:id/child/journalHeaders`, (req, res) =>
  res.json(collection(journals.filter(j => String(j.JeBatchId) === req.params.id).map(headerItem), req)));

app.post(`${BASE}/erpintegrations`, (req, res) => {
  const body = req.body || {};
  if (body.OperationName !== 'importBulkData') {
    return res.status(400).json({ title: 'Bad Request', detail: `Unsupported OperationName "${body.OperationName}". Mock supports importBulkData only.` });
  }
  if (!body.DocumentContent) return res.status(400).json({ title: 'Bad Request', detail: 'DocumentContent is required (base64 zip).' });
  if (!String(body.JobName || '').includes('JournalImportLauncher')) {
    return res.status(400).json({ title: 'Bad Request', detail: 'JobName must be the Import Journals job: /oracle/apps/ess/financials/generalLedger/programs/common,JournalImportLauncher' });
  }

  let csvText;
  try {
    const zip = new AdmZip(Buffer.from(body.DocumentContent, 'base64'));
    const entry = zip.getEntries().find(e => /^GlInterface\.csv$/i.test(e.entryName));
    if (!entry) return res.status(400).json({ title: 'Bad Request', detail: 'Zip must contain GlInterface.csv' });
    csvText = entry.getData().toString('utf8');
  } catch {
    return res.status(400).json({ title: 'Bad Request', detail: 'DocumentContent is not a valid base64 zip.' });
  }

  // ParameterList: DataAccessSetId,Source,LedgerId,GroupId,PostErrorsToSuspense,CreateSummary,ImportDFF
  const [dataAccessSetId, source, ledgerId, groupId] = String(body.ParameterList || '').split(',');
  const params = { dataAccessSetId, source, ledgerId, groupId, requestId: nextRequestId + 1 };
  const rows = parseCsv(csvText);
  const requestId = ++nextRequestId;

  const job = { requestId, fileName: body.FileName, params, createdAt: Date.now(), polls: 0, rowCount: rows.length };
  if (!rows.length) {
    job.results = []; job.finalStatus = 'ERROR'; job.log = 'No rows found in GlInterface.csv';
  } else {
    const { results } = runJournalImport(rows, params);
    const rejected = results.filter(r => r.errors.length).length;
    job.results = results;
    job.finalStatus = rejected === 0 ? 'SUCCEEDED' : rejected === results.length ? 'ERROR' : 'WARNING';
    job.log = buildLog(job);
  }
  jobs.set(String(requestId), job);

  res.status(201).json({
    OperationName: body.OperationName,
    DocumentId: null,
    DocumentContent: null,
    FileName: body.FileName,
    ContentType: body.ContentType,
    DocumentAccount: body.DocumentAccount || 'fin$/generalLedger$/import$',
    JobName: body.JobName,
    ParameterList: body.ParameterList,
    ReqstId: String(requestId),
    StatusCode: null,
  });
});

// Finders: ESSJobStatusRF;requestId=X  and  ESSJobExecutionDetailsRF;requestId=X;fileType=log
app.get(`${BASE}/erpintegrations`, (req, res) => {
  const finder = String(req.query.finder || '');
  const [name, ...pairs] = finder.split(';');
  const args = Object.fromEntries(pairs.map(p => p.split('=')));
  const job = jobs.get(String(args.requestId));
  if (!job) return res.status(404).json({ title: 'Not Found', detail: `No ESS request ${args.requestId}` });

  if (name === 'ESSJobStatusRF') {
    return res.json({ items: [{ ReqstId: String(job.requestId), RequestStatus: currentStatus(job) }], count: 1, hasMore: false });
  }
  if (name === 'ESSJobExecutionDetailsRF') {
    const zip = new AdmZip();
    zip.addFile(`${job.requestId}.log`, Buffer.from(job.log, 'utf8'));
    zip.addFile(`${job.requestId}_results.json`, Buffer.from(JSON.stringify(job.results, null, 2), 'utf8'));
    return res.json({ items: [{ ReqstId: String(job.requestId), DocumentContent: zip.toBuffer().toString('base64'), ContentType: 'zip', FileName: `${job.requestId}.zip` }], count: 1, hasMore: false });
  }
  res.status(400).json({ title: 'Bad Request', detail: `Unsupported finder "${name}"` });
});

app.listen(PORT, () => {
  console.log(`Mock Oracle Fusion running on http://localhost:${PORT}`);
  console.log(`Basic auth: ${USERNAME} / ${PASSWORD}`);
});
