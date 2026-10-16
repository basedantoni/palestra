# Daily exchange rates for USD, EUR, JPY, CNY and KRW

Research for [KOI-324](https://linear.app/koi-consultancy/issue/KOI-324) (map [KOI-320](https://linear.app/koi-consultancy/issue/KOI-320), Market Watch).
Checked 2026-10-16 against the primary sources linked below.

**Question.** Market Prices are stored in the Marketplace's own currency and converted to USD on read using a daily rate. Which free, ToS-permitted source gives daily rates for USD, EUR, JPY, CNY and KRW, with history at least as deep as any Price History we might backfill?

## Answer

Use the **ECB euro foreign exchange reference rates**. They cover all five currencies, are free with no key, allow reuse as long as the ECB is cited, and go back to 1999-01-04 (CNY from 2005-04-01). One Piece Printings only date from 2022, so that history is far deeper than any backfill needs. Take the data straight from the ECB files (`eurofxref-hist.zip` once for the backfill, then `eurofxref-daily.xml` each day) or from Frankfurter's ECB-only route (`/v2/providers/ecb/rates`), which serves the same numbers as JSON. Compute USD cross rates through EUR. The ECB publishes nothing on weekends or TARGET holidays, so use the most recent published rate on or before the price date.

No API key is needed, so there is no new env var.

## Candidates

### 1. ECB euro foreign exchange reference rates (recommended)

| Aspect | Finding |
|---|---|
| Currencies | 29 currencies quoted against EUR, including USD, JPY, CNY and KRW [ecb-ref]. EUR is the base. |
| Historical depth | Verified from `eurofxref-hist.csv` (downloaded 2026-10-16): USD, JPY and KRW from **1999-01-04**, CNY from **2005-04-01**, through 2026-10-16 (7,116 rows). Frankfurter's provider listing also gives the ECB start date as 1999-01-04 [ff-providers]. |
| Publication time | "Usually updated at around 16:00 CET", after a concertation procedure among central banks at about 14:10 CET [ecb-ref]. |
| Weekends / holidays | Published on working days only, with none on TARGET closing days [ecb-ref]. T2 is closed at weekends and on 1 Jan, Good Friday, Easter Monday, 1 May, 25 Dec and 26 Dec [ecb-t2]. In the history file those dates simply have no row. |
| Rate limits | None published. The files are static (`eurofxref-daily.xml`, `eurofxref-hist.zip`/`.xml`, `eurofxref-hist-90d.xml`, an SDMX file) [ecb-ref]. |
| Licence / terms | "Users may make free use of the information obtained directly from it." Reproduced information "must appear accurately and the ECB must be cited as the source", and any modification (for example a computed cross rate) "must be stated explicitly" [ecb-disclaimer]. The rates are "published for information purposes only" and using them for transactions is "strongly discouraged" [ecb-ref]. Converting prices for display fits that. |
| Auth | None. |

Converting to USD: ECB quotes `1 EUR = r_X X`. So `1 X = r_USD / r_X USD`, and `1 EUR = r_USD USD`. Because that cross rate is derived, the UI attribution should say "derived from ECB reference rates".

### 2. Frankfurter (api.frankfurter.dev)

| Aspect | Finding |
|---|---|
| Currencies | Data from "104 central banks and official sources" covering 223 currencies [ff-home]. All five are covered (probe below). |
| Historical depth | "Go back to 1948" overall [ff-home]. The ECB provider starts 1999-01-04 [ff-providers]. A probe of `/v2/providers/ecb/rates?date=1999-01-04&base=USD` returned JPY 113.44 and KRW 1186.35 (no CNY, which matches the ECB file). |
| Publication time | "Rates update daily". No time is given [ff-docs]. |
| Weekends / holidays | Not documented [ff-docs]. Probes on 2026-10-16 showed three behaviours. **Single date, ECB or v1:** asking for Saturday 2026-10-10 returns the 2026-10-09 rate and labels it 2026-10-09. **Range, ECB provider:** weekend dates are omitted. **Range, default blended feed:** weekend dates are present (2026-10-10 and 10-11 have values), because other providers publish on those days. The blended values also differ slightly from ECB (USD→EUR 0.89149 blended vs 0.89238 ECB on 2026-10-09). |
| Rate limits | "Requests are rate-limited to prevent abuse, but there are no monthly or daily caps." No numbers are published [ff-docs]. Responses carry `cache-control: public, max-age=86400`. |
| Licence / terms | The code is MIT. For the data: "Frankfurter doesn't own the rates… If a provider publishes terms of use, they apply" [ff-license]. Using the ECB provider route therefore puts us under ECB terms. The blended feed mixes providers, some of which publish no terms [ff-providers]. |
| Auth | "You don't need an API key" [ff-home]. It can also be self-hosted with Docker [ff-home]. |
| Notes | v1 is deprecated but "remains available indefinitely". The docs advise filtering by provider "for compliance… to get official reference rates" [ff-docs]. |

Use it only through `/v2/providers/ecb/rates`. That route is the ECB data in JSON, and it saves parsing XML or CSV. Avoid the default blended feed: its sources and terms are mixed, and its numbers depend on which providers published that day.

### 3. Federal Reserve H.10 (via FRED)

| Aspect | Finding |
|---|---|
| Currencies | 23 currencies against USD, including the euro, Japan yen, China yuan and South Korea won [fed-h10]. |
| Historical depth | Frankfurter's FRED provider starts 1971-01-04 [ff-providers]. Each series starts on a different date; we did not check them one by one. |
| Publication time | Noon buying rates in New York, certified by the New York Fed for customs purposes [fed-h10-about]. The release is **weekly** and covers the previous week's daily rates [fed-h10-about]. For example, DEXKOUS showed data to 2026-10-09, updated 2026-10-13, next release 2026-10-19 [fred-dexkous]. |
| Weekends / holidays | No weekend rates. U.S. holidays follow the K.8 schedule [fed-h10-about]. |
| Rate limits | None stated on the API key page [fred-key]. |
| Licence / terms | FRED marks DEXKOUS "Public Domain: Citation Requested", but the same page also says "Data in this graph are copyrighted" [fred-dexkous]. The notices conflict, so check the terms before relying on it. |
| Auth | The FRED API needs an API key [fred-key]. The H.10 tables on federalreserve.gov do not. |

It has deep history and quotes against USD natively. But it arrives up to a week late, so today's prices would have no current rate. It is a reasonable fallback, not a primary source.

### 4. Open Exchange Rates (free plan)

| Aspect | Finding |
|---|---|
| Currencies | 200+ currencies [oxr-signup]. |
| Historical depth | Back to 1999-01-01 [oxr-hist]. The time-series endpoint is "Enterprise/Unlimited" only [oxr-faq], so a backfill means one request per day. |
| Publication time | Hourly updates on the free plan [oxr-signup]. |
| Weekends / holidays | Not documented. It is a commercial aggregate feed, not a fixing. |
| Rate limits | 1,000 requests per month. USD base only, since changing `base` or `symbols` is a paid feature [oxr-signup] [oxr-hist]. |
| Licence / terms | The free tier is for "personal, small-scale and open source use"; commercial apps should pay [oxr-faq]. No attribution is needed [oxr-faq]. The website terms say "domestic and private use" only [oxr-terms]. |
| Auth | `app_id` query parameter [oxr-hist]. |

It would work for a personal app, but 1,000 requests a month cannot backfill even three years of daily history (about 1,100 days). It adds a key and terms for no gain over ECB.

### 5. exchangerate.host (free plan)

| Aspect | Finding |
|---|---|
| Currencies | Not itemised on the landing page. |
| Historical depth | "19 years of historical data", with no statement of what the free tier gets [erh]. |
| Publication time | Historical end-of-day rates "become available at 00:05 am GMT for the previous day" [erh]. |
| Rate limits | **100 requests per month** on the free plan [erh]. |
| Licence / terms | General terms hosted at ideracorp.com [erh]. |
| Auth | Free key via signup [erh]. |

The 100 requests per month rule it out.

## Recommendation

1. **Source:** ECB reference rates. Take the files directly, or use Frankfurter's `/v2/providers/ecb/rates`, which serves the same numbers.
2. **Backfill:** one download of `eurofxref-hist.zip` gives every business day since 1999 in a single request, with no paging and no quota.
3. **Daily:** fetch `eurofxref-daily.xml` once a day after about 16:00 CET (14:00 UTC; a run around 15:00 UTC leaves margin). It is one small file. KOI-320 says ingestion cannot run on the 256 MB Fly VM, but this fetch is tiny. If it does run alongside the Market Price job, schedule it after the rates are published.
4. **Weekends / holidays:** store only the dates the ECB publishes. On read, use the latest rate on or before the Market Price date. This matches what the ECB and Frankfurter single-date queries do. Don't carry rates forward into stored rows.
5. **Attribution:** show "Exchange rates: European Central Bank (USD cross rates derived)", as the ECB terms require [ecb-disclaimer].
6. **Env:** none needed. If a keyed source were ever added (FRED or OXR), its key would go in `packages/env/src/server.ts` and `apps/server/.env.example`, per the repo convention.

**Caveats**

- KRW and CNY are ECB concertation rates fixed around 14:10 CET. They are not Seoul or Shanghai fixings, and they may differ slightly from the rates the Marketplaces themselves use. That is fine for display, but not for accounting.
- For dates before 2005-04-01 there is no ECB CNY rate. This doesn't matter for One Piece (released 2022).
- Frankfurter documents no rate-limit numbers and no SLA. If we use it rather than the ECB files, the ECB files are the fallback.

## Sources

- [ecb-ref] ECB, Euro foreign exchange reference rates: https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
- [ecb-disclaimer] ECB, Disclaimer & copyright: https://www.ecb.europa.eu/services/disclaimer/html/index.en.html
- [ecb-t2] ECB, T2 operating days: https://www.ecb.europa.eu/paym/target/t2/html/index.en.html
- ECB history file (verified locally): https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip
- [ff-home] Frankfurter: https://frankfurter.dev/
- [ff-docs] Frankfurter docs: https://frankfurter.dev/docs/
- [ff-license] Frankfurter licence: https://frankfurter.dev/license/
- [ff-providers] Frankfurter provider list: https://api.frankfurter.dev/v2/providers
- [fed-h10] Federal Reserve H.10 current release: https://www.federalreserve.gov/releases/h10/current/default.htm
- [fed-h10-about] About H.10: https://www.federalreserve.gov/releases/h10/about.htm
- [fred-dexkous] FRED DEXKOUS: https://fred.stlouisfed.org/series/DEXKOUS
- [fred-key] FRED API key: https://fred.stlouisfed.org/docs/api/api_key.html
- [oxr-signup] Open Exchange Rates plans: https://openexchangerates.org/signup
- [oxr-hist] OXR historical endpoint: https://docs.openexchangerates.org/reference/historical-json
- [oxr-faq] OXR FAQ: https://openexchangerates.org/faq
- [oxr-terms] OXR terms: https://openexchangerates.org/terms
- [erh] exchangerate.host: https://exchangerate.host/
