# Mock Oracle Fusion

Fake Oracle Fusion ERP (GL journal import) for developing the Contract Hive Fusion integration without an Oracle account.

```
npm install
npm start          # http://localhost:5050   (npm run dev = auto-restart)
```

Basic auth: `fusion.integration` / `Welcome1` (override with `MOCK_USER`, `MOCK_PASSWORD`, `PORT`).

## Fusion endpoints (base `/fscmRestApi/resources/11.13.18.05`)
| Call | Purpose |
|---|---|
| `GET /ledgersLOV` | 3 ledgers: KSA (SAR, 300000001), UAE (AED, 300000002), Group (USD, 300000003) |
| `GET /accountCombinationsLOV` | Like real Fusion: only `_CODE_COMBINATION_ID`, `_CHART_OF_ACCOUNTS_ID`, `EnabledFlag`, dates — no codes or names. The chart behind it (Xero-style accounts + IFRS 16 lease accounts, companies 101 KSA/SAR, 102 UAE/AED, 103 Group/USD as `Company-000-Account-000`; `91900` disabled) is used to validate imports |
| `POST /erpintegrations` | `OperationName: importBulkData`, base64 zip containing `GlInterface.csv` → returns `ReqstId` |
| `GET /erpintegrations?finder=ESSJobStatusRF;requestId=X` | `WAIT` → `RUNNING` → `SUCCEEDED` / `WARNING` (some rejected) / `ERROR` |
| `GET /erpintegrations?finder=ESSJobExecutionDetailsRF;requestId=X;fileType=log` | base64 zip with `<id>.log` and `<id>_results.json` |
| `GET /valueSets?finder=ValueSetCodeFinder;ValueSetCode=ACCOUNTS` → follow its `values` link | Natural account values: `Value`, `Description`, `AccountType`, `EnabledFlag`, `SummaryFlag` |
| `GET /journalSourcesLOV`, `GET /journalCategoriesLOV` | Journal sources / categories (`UserJeSourceName`, `UserJeCategoryName`) |
| `GET /journalBatches?q=GroupId=77` | Imported journals |

`ParameterList`: `DataAccessSetId,Source,LedgerId,GroupId,N,N,N`. Valid source: `Contract Hive`; category: `Lease Accounting`.

## GlInterface.csv (no header, positions 0-based)
Field order of Oracle's GlInterface.ctl (0-based): 0 STATUS=`NEW`, 1 LEDGER_ID, 2 ACCOUNTING_DATE `YYYY/MM/DD`, 3 source, 4 category, 5 currency, 6 date created, 7 ACTUAL_FLAG=`A`,
8–37 SEGMENT1–30, 38 ENTERED_DR, 39 ENTERED_CR, 40–41 accounted DR/CR, 42–51 REFERENCE1–10
(1 batch name, 4 journal name, 5 journal description, 10 line description), 52–61 REFERENCE21–30, 62 STAT_AMOUNT, 63–65 conversion type/date/rate, **66 GROUP_ID**.

Journals are grouped by GROUP_ID + REFERENCE4; batches by REFERENCE1. `journalBatches` returns one row per batch (`JeBatchId`, `BatchName`, …) with journals under `journalHeaders` (`?expand=journalHeaders` or `/journalBatches/{id}/child/journalHeaders`), like real Fusion. Rejections: unknown ledger/source/category, currency ≠ ledger, invalid or disabled account, company not in ledger, unbalanced, date before 2020.

## Debug (no auth)
`GET /mock/jobs`, `GET /mock/journals`, `GET /mock/accounts` (valid account codes to type in the mapping), `POST /mock/reset`. State is in memory and clears on restart.

## HiveIQ dataset (IKEA KSA)
Logging in as `hiveiq.integration` / `Welcome1` (override `MOCK_IKEA_USER`, `MOCK_IKEA_PASSWORD`) serves a separate dataset from `data/ikea-ksa.json`; the `fusion.integration` login (Contract Hive) is unchanged.

| Call | Purpose |
|---|---|
| `GET /ledgersLOV` | One ledger: IKEA KSA Primary Ledger (SAR) |
| `GET /valueSets?finder=ValueSetCodeFinder;ValueSetCode=X` → `values` link | `IKSA_COMPANY`, `IKSA_ACCOUNT` (1030 accounts, `AccountType` A/L/O/R/E), `IKSA_DEPARTMENT`, `IKSA_PROJECT`, `IKSA_SERVICE_LINE` |
| `GET /ledgerBalances?finder=AccountBalanceByCombinationFinder;ledgerName=…;accountingPeriod=Oct-26` | Closing balance per combination `Company-Account-Department-Project-ServiceLine` (`EndingBalance` net Dr+/Cr−, P&L year-to-date). Periods: Aug-26, Sep-26, Oct-26 |

The `ledgerBalances` field names are from memory of Oracle's resource, not verified against a live pod — adjust `ikea.js` and HiveIQ's `services/oracle.service.js` together if a real pod differs.
