// doctor-universal-links.js — Expo Universal Links & App Links Doctor core logic.
//
// Pure, deterministic, 100% client-side: given an Expo/React Native app's
// iOS Universal Links config (associatedDomains, the apple-app-site-association
// file) and Android App Links config (intentFilters, assetlinks.json,
// signing-key SHA256 fingerprints), works out what each platform actually
// requires, cross-checks every layer against it, and reports concrete
// mismatches with copy-paste fixes.
//
// Nothing in this file makes a network request. It only reads the object you
// pass to diagnose().
//
// This is the fourth sibling in the "Doctor" family (same diagnose() shape,
// same "nothing leaves your browser" contract as doctor-web.js / doctor.js /
// doctor-flutter.js) — a different domain (native iOS/Android link
// verification instead of Supabase Auth redirects), so nothing is imported
// or copied from those files.
//
// Rules implemented here are sourced from (fetched and verified 2026-09-04):
//
//  - https://docs.expo.dev/linking/ios-universal-links/
//      app.json → expo.ios.associatedDomains entries use the form
//      "applinks:example.com" — no "https://" prefix, no path ("This is a
//      common mistake that will result in the universal links not
//      working."); the AASA file must be hosted at
//      /.well-known/apple-app-site-association and served over https.
//  - https://docs.expo.dev/linking/android-app-links/
//      app.json → expo.android.intentFilters entries need
//      { action: "VIEW", autoVerify: true, data: [{ scheme, host, pathPrefix }],
//      category: ["BROWSABLE","DEFAULT"] } — "Specifying autoVerify is
//      required for Android App Links to work correctly"; assetlinks.json is
//      hosted at /.well-known/assetlinks.json; the SHA256 fingerprint for an
//      EAS build comes from `eas credentials -p android` → "SHA256
//      Fingerprint" for that build profile (a *different* keystore than a
//      local debug build, which is the single most common cause of a
//      verified-in-theory config that still fails on-device).
//  - https://docs.expo.dev/linking/overview/
//      "Support for incoming links in Expo Go is limited. We recommend using
//      Development builds to test your app's linking strategies." — Universal
//      Links / App Links verification is a native OS feature tied to the
//      installed app's bundle ID / signing key, so it does not work in the
//      Expo Go sandbox app at all; it needs a development build, or a
//      standalone/production build.
//  - https://developer.apple.com/documentation/xcode/supporting-associated-domains
//      apple-app-site-association JSON: applinks.details is an array of
//      dictionaries, each either the legacy { appID, paths } shape or the
//      modern { appIDs, components } shape (avoid mixing the two shapes in
//      the same file). appID/appIDs format is
//      "<Apple Team ID>.<Bundle Identifier>" (e.g. "ABCDE12345.com.example.app").
//      The file must be hosted at
//      https://<domain>/.well-known/apple-app-site-association, "using
//      https:// with a valid certificate and with no redirects."
//  - https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links
//      No redirects: a 301/302 on the AASA URL is explicitly unsupported —
//      "host your AASA at each domain and subdomain included in your
//      applinks" instead of redirecting one domain to another. The `*`
//      wildcard in "paths" / the components "/" pattern does not match "/"
//      or "." — i.e. it matches within one path segment, not across it.
//      Apple's CDN fetches and caches the AASA file per-device at install
//      time, so an edit doesn't take effect for an already-installed app
//      until the OS re-checks it (a fresh install/reinstall is the reliable
//      way to force a re-fetch while testing). Validate with
//      `swcutil dl -d <domain>` and `swcutil verify -d <domain> -j <file> -u <url>`.
//  - https://developer.android.com/training/app-links/verify-android-applinks
//      assetlinks.json is a JSON *array* of objects, each with
//      relation: ["delegate_permission/common.handle_all_urls"],
//      target: { namespace: "android_app", package_name, sha256_cert_fingerprints }.
//      The intent-filter needs android:autoVerify="true", action VIEW,
//      categories BROWSABLE + DEFAULT, and data scheme "https". Check
//      verification on-device with `adb shell pm get-app-links <package>`.
//
// Works as an ES module (import { diagnose, expectedValues } from
// './doctor-universal-links.js') and, when loaded with <script type="module">,
// also publishes window.UniversalLinksDoctor = { diagnose, expectedValues }
// for console/debug use.

// ───────────────────────── small helpers ─────────────────────────

function safeStr(v) {
  return typeof v === 'string' ? v : '';
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function safeObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function stripBOM(s) {
  return safeStr(s).replace(/^﻿/, '');
}

function hasBOM(s) {
  return safeStr(s).charCodeAt(0) === 0xfeff;
}

function trimSlashes(s) {
  return safeStr(s).trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

function normalizePath(p) {
  const t = safeStr(p).trim();
  if (!t) return '';
  const withSlash = t.startsWith('/') ? t : `/${t}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash;
}

function normalizeDomain(d) {
  return safeStr(d)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

// Safe JSON.parse that never throws and reports whether a BOM was present.
function parseJsonSafe(text) {
  const raw = safeStr(text);
  if (!raw.trim()) return { ok: false, empty: true, value: null, error: null, bom: false };
  const bom = hasBOM(raw);
  try {
    const value = JSON.parse(stripBOM(raw));
    return { ok: true, empty: false, value, error: null, bom };
  } catch (e) {
    return { ok: false, empty: false, value: null, error: e.message, bom };
  }
}

// ───────────────────────── Apple AASA wildcard matcher ─────────────────────────
// Per https://developer.apple.com/documentation/xcode/supporting-associated-domains
// and https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links :
// "*" matches a run of characters but never crosses a "/" or "." separator.
// Legacy "paths" entries may be prefixed "NOT " to exclude a pattern; modern
// "components" entries carry an "exclude": true flag instead. Both are
// evaluated in array order — the first pattern that matches wins.

function escapeRegexChar(c) {
  return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function aasaGlobToRegExp(pattern) {
  const src = safeStr(pattern);
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    out += c === '*' ? '[^/.]*' : escapeRegexChar(c);
  }
  return new RegExp('^' + out + '$');
}

function aasaGlobMatch(pattern, value) {
  if (!pattern || !value) return false;
  try {
    return aasaGlobToRegExp(pattern).test(value);
  } catch (e) {
    return false;
  }
}

/**
 * Checks whether `testedPath` is covered by one AASA `details` entry's
 * "paths" (legacy) or "components" (modern) array.
 * @returns {{covered: boolean|null, excluded: boolean, implicit: boolean}}
 *   covered=null means "no path info to test against" (caller should treat
 *   this as informational, not a failure).
 */
function checkPathCoverage(detail, testedPath) {
  if (!testedPath) return { covered: null, excluded: false, implicit: false };

  if (Array.isArray(detail.components)) {
    for (const comp of detail.components) {
      if (!comp || typeof comp !== 'object') continue;
      const pat = typeof comp['/'] === 'string' ? comp['/'] : '*';
      if (aasaGlobMatch(pat, testedPath)) {
        return { covered: !comp.exclude, excluded: !!comp.exclude, implicit: false };
      }
    }
    return { covered: false, excluded: false, implicit: false };
  }

  if (Array.isArray(detail.paths)) {
    for (const raw of detail.paths) {
      if (typeof raw !== 'string') continue;
      const isNot = /^NOT\s+/.test(raw);
      const pat = raw.replace(/^NOT\s+/, '');
      if (aasaGlobMatch(pat, testedPath)) {
        return { covered: !isNot, excluded: isNot, implicit: false };
      }
    }
    return { covered: false, excluded: false, implicit: false };
  }

  // Neither key present on this detail entry at all — nothing restricts it,
  // so treat the app ID as unrestricted rather than falsely flagging it.
  return { covered: true, excluded: false, implicit: true };
}

// ───────────────────────── expected-value builders ─────────────────────────

function buildAppId(teamId, bundleId) {
  const t = safeStr(teamId).trim();
  const b = safeStr(bundleId).trim();
  return t && b ? `${t}.${b}` : null;
}

function firstAppLinksDomain(associatedDomains, explicitDomain) {
  const explicit = normalizeDomain(explicitDomain);
  if (explicit) return explicit;
  const list = safeArr(associatedDomains);
  for (const entry of list) {
    const m = /^applinks:(.+)$/i.exec(safeStr(entry).trim());
    if (m) return normalizeDomain(m[1]);
  }
  return '';
}

function buildAasaSnippet(appId, testedPath) {
  const details = [
    {
      appID: appId || 'TEAMID.com.example.myapp',
      paths: [normalizePath(testedPath) || '/*', '/*'].filter((v, i, a) => a.indexOf(v) === i),
    },
  ];
  return JSON.stringify({ applinks: { apps: [], details } }, null, 2);
}

function buildAssetlinksSnippet(packageName, fingerprints) {
  const fps = safeArr(fingerprints).filter((f) => typeof f === 'string' && f.trim());
  const entry = {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: packageName || 'com.example.myapp',
      sha256_cert_fingerprints: fps.length ? fps : ['(run: eas credentials -p android -> SHA256 Fingerprint)'],
    },
  };
  return JSON.stringify([entry], null, 2);
}

function buildAppJsonIosSnippet(domain) {
  return JSON.stringify(
    { expo: { ios: { associatedDomains: [`applinks:${domain || 'example.com'}`] } } },
    null,
    2
  );
}

function buildAppJsonAndroidSnippet(domain, testedPath) {
  return JSON.stringify(
    {
      expo: {
        android: {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              data: [{ scheme: 'https', host: domain || 'example.com', pathPrefix: normalizePath(testedPath) || '/' }],
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ],
        },
      },
    },
    null,
    2
  );
}

function computeExpected(cfg) {
  const ios = safeObj(cfg.ios);
  const android = safeObj(cfg.android);
  const linking = safeObj(cfg.linking);

  const appId = buildAppId(ios.teamId, ios.bundleId);
  const domain = firstAppLinksDomain(ios.associatedDomains, ios.domain) || normalizeDomain(android.intentFilters && safeArr(android.intentFilters)[0] && safeArr(android.intentFilters)[0].host);
  const testedPath = normalizePath(linking.testedPath);

  return {
    appId,
    associatedDomainsEntry: domain ? `applinks:${domain}` : null,
    aasaSnippet: buildAasaSnippet(appId, testedPath),
    assetlinksSnippet: buildAssetlinksSnippet(android.packageName, android.sha256Fingerprints),
    androidIntentFilterSnippet: buildAppJsonAndroidSnippet(domain, testedPath),
  };
}

// ───────────────────────── diagnose() ─────────────────────────

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function sortProblems(problems) {
  return problems
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => (SEVERITY_ORDER[a.p.severity] - SEVERITY_ORDER[b.p.severity]) || (a.idx - b.idx))
    .map((x) => x.p);
}

function pushProblem(problems, severity, code, message, path, value, fix) {
  const problem = { severity, code, message, path };
  if (value !== undefined && value !== null && value !== '') problem.value = value;
  if (fix) problem.fix = fix;
  problems.push(problem);
}

/**
 * @param {object} config
 * @param {{bundleId?:string, teamId?:string, associatedDomains?:string[], aasaJson?:string, aasaServedWithRedirect?:boolean|null, aasaContentType?:string, domain?:string}} [config.ios]
 * @param {{packageName?:string, sha256Fingerprints?:string[], assetlinksJson?:string, intentFilters?:Array<{autoVerify?:boolean|null, scheme?:string, host?:string, pathPrefix?:string}>}} [config.android]
 * @param {'expo-go'|'dev-build'|'standalone'|''} [config.runtime]
 * @param {{prefixes?:string[], usesExpoRouter?:boolean|null, testedPath?:string}} [config.linking]
 * @returns {{status:'pass'|'warn'|'fail', summary:string, expected:object, problems:Array, fixes:Array, checklist:string[], disclaimer:string}}
 */
export function diagnose(config) {
  const cfg = safeObj(config);
  const ios = safeObj(cfg.ios);
  const android = safeObj(cfg.android);
  const runtime = safeStr(cfg.runtime).trim();
  const linking = safeObj(cfg.linking);

  const problems = [];
  const fixes = [];
  const checklist = [];

  const teamId = safeStr(ios.teamId).trim();
  const bundleId = safeStr(ios.bundleId).trim();
  const packageName = safeStr(android.packageName).trim();
  const associatedDomains = safeArr(ios.associatedDomains).filter((x) => typeof x === 'string' && x.trim());
  const intentFilters = safeArr(android.intentFilters).filter((x) => x && typeof x === 'object');
  const testedPath = normalizePath(linking.testedPath);
  const prefixes = safeArr(linking.prefixes).filter((x) => typeof x === 'string' && x.trim());

  const usesIos = !!(teamId || bundleId || associatedDomains.length || safeStr(ios.aasaJson).trim() || ios.domain);
  const usesAndroid = !!(packageName || intentFilters.length || safeStr(android.assetlinksJson).trim() || safeArr(android.sha256Fingerprints).length);

  const expected = computeExpected(cfg);
  const expectedAppId = expected.appId;
  const domain = firstAppLinksDomain(associatedDomains, ios.domain) || normalizeDomain(intentFilters[0] && intentFilters[0].host);

  // ── 0. runtime ──────────────────────────────────────────────────────
  if (runtime === 'expo-go') {
    pushProblem(
      problems,
      'high',
      'runtime_expo_go',
      'Universal Links (iOS) and Android App Links are verified against the installed app\'s bundle ID / signing key — a native-OS feature Expo Go can\'t provide since it is itself the installed app. Per Expo\'s own linking docs, "support for incoming links in Expo Go is limited." Tapping the link will just open it in the browser no matter how correct your config is.',
      'runtime',
      'expo-go',
      'Test with a development build (npx expo run:ios / npx expo run:android, or an EAS dev-client build) or a standalone/production build.'
    );
  } else if (!runtime) {
    pushProblem(
      problems,
      'low',
      'runtime_not_set',
      'runtime is not set. Universal Links / App Links only work in a development, standalone, or production build — not Expo Go — so it\'s worth confirming explicitly which one you tested on before trusting a "still doesn\'t work" result.',
      'runtime'
    );
  }

  // ── 1. iOS: bundle ID / team ID ──────────────────────────────────────
  if (usesIos) {
    if (!bundleId) {
      pushProblem(problems, 'high', 'ios_missing_bundle_id', 'ios.bundleId is empty — the Apple App ID (TEAMID.bundleID) used inside the apple-app-site-association file can\'t be computed or verified without it.', 'ios.bundleId');
    } else if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(bundleId)) {
      pushProblem(problems, 'medium', 'ios_bundle_id_format', `"${bundleId}" doesn't look like a reverse-DNS bundle identifier (e.g. "com.example.myapp").`, 'ios.bundleId', bundleId);
    }
    if (!teamId) {
      pushProblem(problems, 'high', 'ios_missing_team_id', 'ios.teamId is empty. Apple App IDs in the apple-app-site-association file are "<Apple Team ID>.<Bundle Identifier>" — without the 10-character Team ID, the appID entry can\'t be validated.', 'ios.teamId');
    } else if (!/^[A-Z0-9]{10}$/.test(teamId)) {
      pushProblem(problems, 'medium', 'ios_team_id_format', `"${teamId}" doesn't look like an Apple Team ID — it's normally exactly 10 uppercase letters/digits (found under Apple Developer → Membership).`, 'ios.teamId', teamId);
    }
  }

  // ── 2. iOS: associatedDomains format ─────────────────────────────────
  if (usesIos) {
    if (!associatedDomains.length) {
      pushProblem(
        problems,
        'high',
        'ios_associated_domains_empty',
        'ios.associatedDomains is empty. Without an "applinks:<domain>" entry in app.json, iOS never attempts Universal Links for this app at all — the OS has nothing telling it which domain to associate.',
        'ios.associatedDomains'
      );
      fixes.push({ title: 'Add associatedDomains to app.json', value: buildAppJsonIosSnippet(domain), where: 'app.json → expo.ios.associatedDomains' });
    } else {
      let anyApplinks = false;
      associatedDomains.forEach((entry, i) => {
        const trimmed = entry.trim();
        if (/^applinks:/i.test(trimmed)) anyApplinks = true;
        if (/^https?:\/\//i.test(trimmed)) {
          pushProblem(
            problems,
            'high',
            'ios_associated_domain_has_protocol',
            `ios.associatedDomains[${i}] is "${trimmed}" — it must not include the protocol. Per Expo's docs this is "a common mistake that will result in the universal links not working." Use "applinks:${normalizeDomain(trimmed)}" instead.`,
            `ios.associatedDomains[${i}]`,
            trimmed,
            `applinks:${normalizeDomain(trimmed)}`
          );
        } else if (/^applinks:/i.test(trimmed) && /\//.test(trimmed.replace(/^applinks:/i, ''))) {
          pushProblem(
            problems,
            'high',
            'ios_associated_domain_has_path',
            `ios.associatedDomains[${i}] is "${trimmed}" — it must be just "applinks:<domain>", with no path after the domain.`,
            `ios.associatedDomains[${i}]`,
            trimmed,
            `applinks:${trimmed.replace(/^applinks:/i, '').split('/')[0]}`
          );
        } else if (!/^applinks:[a-z0-9.-]+$/i.test(trimmed) && !/^(webcredentials|activitycontinuation|appclips):/i.test(trimmed)) {
          pushProblem(
            problems,
            'high',
            'ios_associated_domain_bad_format',
            `ios.associatedDomains[${i}] is "${trimmed}", which isn't a valid "applinks:<domain>" entry.`,
            `ios.associatedDomains[${i}]`,
            trimmed
          );
        }
      });
      if (!anyApplinks) {
        pushProblem(
          problems,
          'high',
          'ios_no_applinks_prefix',
          'None of ios.associatedDomains starts with "applinks:" — only that service type enables Universal Links (webcredentials/activitycontinuation/appclips cover different features).',
          'ios.associatedDomains'
        );
      }
      if (ios.domain && domain && !associatedDomains.some((e) => normalizeDomain(e.replace(/^applinks:/i, '')) === normalizeDomain(ios.domain))) {
        pushProblem(
          problems,
          'medium',
          'ios_domain_mismatch',
          `ios.domain ("${ios.domain}") — where you said the apple-app-site-association file is hosted — doesn't match any "applinks:" host in ios.associatedDomains. iOS only fetches the AASA from a domain it's told about via associatedDomains.`,
          'ios.domain',
          ios.domain
        );
      }
    }
  }

  // ── 3. iOS: AASA JSON ─────────────────────────────────────────────────
  const aasaRaw = safeStr(ios.aasaJson);
  if (usesIos && associatedDomains.length && !aasaRaw.trim()) {
    pushProblem(
      problems,
      'medium',
      'aasa_missing',
      'No apple-app-site-association content was pasted in, so it can\'t be checked. Paste the exact response body from https://<your-domain>/.well-known/apple-app-site-association.',
      'ios.aasaJson'
    );
    checklist.push('Paste the live apple-app-site-association response into the checker to verify the appID and paths, not just app.json.');
  } else if (aasaRaw.trim()) {
    const parsed = parseJsonSafe(aasaRaw);
    if (parsed.bom) {
      pushProblem(
        problems,
        'medium',
        'aasa_bom_present',
        'The apple-app-site-association content starts with a UTF-8 byte-order-mark (BOM). Some strict JSON/CDN parsers reject a file that starts with a BOM instead of "{" — re-save the file as UTF-8 without a BOM.',
        'ios.aasaJson'
      );
    }
    if (!parsed.ok) {
      pushProblem(
        problems,
        'high',
        'aasa_invalid_json',
        `apple-app-site-association isn't valid JSON${parsed.error ? ` (${parsed.error})` : ''}. Apple's CDN and iOS itself require it to parse as plain JSON with no trailing commas or comments.`,
        'ios.aasaJson',
        undefined,
        'Validate the file (e.g. with `swcutil dl -d <domain>` on a Mac, or any JSON linter) and fix the syntax error.'
      );
    } else {
      const parsedValue = safeObj(parsed.value);
      const applinks = parsedValue.applinks;
      if (!applinks || typeof applinks !== 'object') {
        pushProblem(problems, 'high', 'aasa_missing_applinks_key', 'The parsed apple-app-site-association JSON has no top-level "applinks" key, so iOS has nothing to match Universal Links against.', 'ios.aasaJson');
      } else {
        const details = Array.isArray(applinks.details) ? applinks.details : null;
        if (!details || !details.length) {
          pushProblem(problems, 'high', 'aasa_missing_details', 'applinks.details is missing or empty — there is no appID entry at all for iOS to match against.', 'ios.aasaJson');
          fixes.push({ title: 'Fix apple-app-site-association', value: expected.aasaSnippet, where: `https://${domain || '<your-domain>'}/.well-known/apple-app-site-association` });
        } else {
          const hasLegacy = details.some((d) => d && typeof d === 'object' && ('appID' in d || 'paths' in d));
          const hasModern = details.some((d) => d && typeof d === 'object' && ('appIDs' in d || 'components' in d));
          if (hasLegacy && hasModern) {
            pushProblem(
              problems,
              'medium',
              'aasa_mixed_formats',
              'applinks.details mixes the legacy shape ({ appID, paths }) with the modern shape ({ appIDs, components }) across different entries. Apple\'s docs warn: "avoid mixing formats. Doing so may result in unexpected behavior."',
              'ios.aasaJson'
            );
          }

          let matchedDetail = null;
          let sawAnyAppId = false;
          for (const d of details) {
            if (!d || typeof d !== 'object') continue;
            const ids = [];
            if (typeof d.appID === 'string') ids.push(d.appID);
            if (Array.isArray(d.appIDs)) ids.push(...d.appIDs.filter((x) => typeof x === 'string'));
            if (ids.length) sawAnyAppId = true;
            for (const id of ids) {
              if (!/^[A-Za-z0-9]+\.[A-Za-z0-9.-]+$/.test(id)) {
                pushProblem(problems, 'medium', 'aasa_appid_format', `"${id}" in applinks.details doesn't look like "<TeamID>.<BundleID>".`, 'ios.aasaJson', id);
              }
              if (expectedAppId && id === expectedAppId) matchedDetail = d;
            }
          }
          if (!sawAnyAppId) {
            pushProblem(problems, 'high', 'aasa_missing_appid', 'No details entry has an "appID" or "appIDs" field.', 'ios.aasaJson');
          } else if (expectedAppId && !matchedDetail) {
            pushProblem(
              problems,
              'high',
              'aasa_appid_mismatch',
              `None of the appID/appIDs entries in apple-app-site-association equal "${expectedAppId}" (from ios.teamId + ios.bundleId). iOS requires an exact match — the app simply won't be offered the link.`,
              'ios.aasaJson',
              expectedAppId,
              `Add "${expectedAppId}" as an appID (or into appIDs) in the hosted apple-app-site-association file.`
            );
            fixes.push({ title: 'Fix apple-app-site-association', value: expected.aasaSnippet, where: `https://${domain || '<your-domain>'}/.well-known/apple-app-site-association` });
          } else if (matchedDetail && testedPath) {
            const cov = checkPathCoverage(matchedDetail, testedPath);
            if (cov.excluded) {
              pushProblem(
                problems,
                'medium',
                'aasa_path_excluded',
                `"${testedPath}" is explicitly excluded (a "NOT" path, or a components entry with "exclude": true) in the matching details entry.`,
                'ios.aasaJson',
                testedPath
              );
            } else if (cov.covered === false) {
              pushProblem(
                problems,
                'high',
                'aasa_path_not_covered',
                `"${testedPath}" isn't covered by any "paths" / "components" pattern in the matching details entry. Remember "*" doesn't cross a "/" or "." — "/product/*" matches "/product/42" but not "/product/42/reviews".`,
                'ios.aasaJson',
                testedPath,
                `Add a pattern that covers "${testedPath}" (e.g. "${testedPath.split('/').slice(0, 2).join('/')}/*").`
              );
              fixes.push({ title: 'Fix apple-app-site-association', value: expected.aasaSnippet, where: `https://${domain || '<your-domain>'}/.well-known/apple-app-site-association` });
            }
          }
        }
      }
    }
  }

  if (ios.aasaServedWithRedirect === true) {
    pushProblem(
      problems,
      'high',
      'aasa_served_with_redirect',
      'The apple-app-site-association URL responds with a redirect (301/302). Apple\'s own debugging guide is explicit that this is unsupported: "HTTP redirect, which is not supported when hosting the AASA file" — host the real file at each domain/subdomain instead of redirecting one to another.',
      'ios.aasaServedWithRedirect',
      undefined,
      `Serve the file directly (HTTP 200) at https://${domain || '<your-domain>'}/.well-known/apple-app-site-association — no redirect, even a same-site one.`
    );
  }

  const contentType = safeStr(ios.aasaContentType).trim();
  if (contentType && !/^application\/json(\s*;.*)?$/i.test(contentType)) {
    pushProblem(
      problems,
      'medium',
      'aasa_content_type_wrong',
      `apple-app-site-association is served with Content-Type "${contentType}" instead of "application/json". Most servers work either way, but some CDNs and Apple's own crawler are pickier — serve it as JSON to be safe.`,
      'ios.aasaContentType',
      contentType,
      'Set Content-Type: application/json on the .well-known/apple-app-site-association response.'
    );
  }

  if (usesIos) {
    checklist.push(`Verify hosting: curl -I https://${domain || '<your-domain>'}/.well-known/apple-app-site-association — expect HTTP 200, no redirect, Content-Type: application/json.`);
    checklist.push("Apple's CDN fetches and caches the AASA per device at install time — after changing it, reinstall the app (or wait) rather than assuming an edit takes effect instantly.");
  }

  // ── 4. Android: package name ─────────────────────────────────────────
  if (usesAndroid) {
    if (!packageName) {
      pushProblem(problems, 'high', 'android_missing_package_name', 'android.packageName is empty — assetlinks.json and the intent-filter can\'t be verified against it.', 'android.packageName');
    } else if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) {
      pushProblem(problems, 'medium', 'android_package_name_format', `"${packageName}" doesn't look like a valid Android application ID (e.g. "com.example.myapp").`, 'android.packageName', packageName);
    }
  }

  // ── 5. Android: SHA256 fingerprints ──────────────────────────────────
  const fingerprints = safeArr(android.sha256Fingerprints).filter((x) => typeof x === 'string' && x.trim());
  if (usesAndroid && !fingerprints.length) {
    pushProblem(
      problems,
      'medium',
      'android_missing_fingerprints',
      'android.sha256Fingerprints is empty. Get it with `eas credentials -p android` (select your build profile → "SHA256 Fingerprint") — a local debug keystore\'s fingerprint is different from an EAS build\'s and won\'t verify.',
      'android.sha256Fingerprints'
    );
  }
  const FP_RE = /^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/;
  fingerprints.forEach((fp, i) => {
    if (!FP_RE.test(fp)) {
      pushProblem(problems, 'medium', 'android_fingerprint_format', `android.sha256Fingerprints[${i}] ("${fp}") isn't a 32-byte colon-separated hex SHA-256 fingerprint (e.g. "14:6D:E9:...").`, `android.sha256Fingerprints[${i}]`, fp);
    } else if (/[a-f]/.test(fp)) {
      pushProblem(problems, 'low', 'android_fingerprint_lowercase', `android.sha256Fingerprints[${i}] is lowercase; Google's own tooling always prints it uppercase. Matching is typically case-insensitive, but uppercase avoids any doubt.`, `android.sha256Fingerprints[${i}]`, fp);
    }
  });

  // ── 6. Android: assetlinks.json ──────────────────────────────────────
  const assetlinksRaw = safeStr(android.assetlinksJson);
  if (usesAndroid && !assetlinksRaw.trim()) {
    pushProblem(
      problems,
      'medium',
      'assetlinks_missing',
      'No assetlinks.json content was pasted in, so it can\'t be checked. Paste the exact response body from https://<your-domain>/.well-known/assetlinks.json.',
      'android.assetlinksJson'
    );
  } else if (assetlinksRaw.trim()) {
    const parsed = parseJsonSafe(assetlinksRaw);
    if (parsed.bom) {
      pushProblem(problems, 'medium', 'assetlinks_bom_present', 'assetlinks.json starts with a UTF-8 byte-order-mark (BOM) — re-save it as UTF-8 without a BOM.', 'android.assetlinksJson');
    }
    if (!parsed.ok) {
      pushProblem(problems, 'high', 'assetlinks_invalid_json', `assetlinks.json isn't valid JSON${parsed.error ? ` (${parsed.error})` : ''}.`, 'android.assetlinksJson');
    } else if (!Array.isArray(parsed.value)) {
      pushProblem(
        problems,
        'high',
        'assetlinks_not_array',
        'assetlinks.json must be a JSON *array* of statement objects, even for a single app — a bare object at the top level (`{...}` instead of `[{...}]`) fails Android\'s Digital Asset Links verification.',
        'android.assetlinksJson',
        undefined,
        'Wrap the object in [ ] so it is a one-element array.'
      );
      fixes.push({ title: 'Fix assetlinks.json', value: expected.assetlinksSnippet, where: `https://${domain || '<your-domain>'}/.well-known/assetlinks.json` });
    } else if (!parsed.value.length) {
      pushProblem(problems, 'high', 'assetlinks_empty_array', 'assetlinks.json is an empty array — there is no statement granting your app permission to handle links for this domain.', 'android.assetlinksJson');
      fixes.push({ title: 'Fix assetlinks.json', value: expected.assetlinksSnippet, where: `https://${domain || '<your-domain>'}/.well-known/assetlinks.json` });
    } else {
      let matchingEntry = null;
      let anyRelationOk = false;
      let anyNamespaceOk = false;
      parsed.value.forEach((entry, i) => {
        if (!entry || typeof entry !== 'object') return;
        const relation = Array.isArray(entry.relation) ? entry.relation : [];
        const hasRelation = relation.includes('delegate_permission/common.handle_all_urls');
        if (hasRelation) anyRelationOk = true;
        if (!hasRelation) {
          pushProblem(
            problems,
            'high',
            'assetlinks_relation_missing',
            `assetlinks.json[${i}].relation doesn't include "delegate_permission/common.handle_all_urls" — Android's verifier requires this exact string to grant the app link permission.`,
            `android.assetlinksJson[${i}].relation`
          );
        }
        const target = safeObj(entry.target);
        if (target.namespace === 'android_app') anyNamespaceOk = true;
        else {
          pushProblem(problems, 'high', 'assetlinks_namespace_wrong', `assetlinks.json[${i}].target.namespace is "${target.namespace || '(missing)'}" — it must be exactly "android_app".`, `android.assetlinksJson[${i}].target.namespace`, target.namespace);
        }
        if (packageName && target.package_name === packageName && hasRelation && target.namespace === 'android_app') {
          matchingEntry = target;
        }
      });
      if (packageName && !matchingEntry) {
        const anyPackage = parsed.value.some((e) => safeObj(e && e.target).package_name === packageName);
        pushProblem(
          problems,
          'high',
          'assetlinks_package_mismatch',
          anyPackage
            ? `assetlinks.json has an entry for "${packageName}" but it's missing the relation or namespace fields above — fix those first.`
            : `No entry in assetlinks.json has target.package_name === "${packageName}". Android will not verify the app for this domain.`,
          'android.assetlinksJson',
          packageName
        );
        fixes.push({ title: 'Fix assetlinks.json', value: expected.assetlinksSnippet, where: `https://${domain || '<your-domain>'}/.well-known/assetlinks.json` });
      } else if (matchingEntry && fingerprints.length) {
        const listed = safeArr(matchingEntry.sha256_cert_fingerprints).map((f) => safeStr(f).toUpperCase());
        const missing = fingerprints.filter((f) => !listed.includes(f.toUpperCase()));
        if (missing.length) {
          pushProblem(
            problems,
            'high',
            'assetlinks_fingerprint_missing',
            `Fingerprint${missing.length > 1 ? 's' : ''} ${missing.map((f) => `"${f}"`).join(', ')} from android.sha256Fingerprints ${missing.length > 1 ? 'are' : 'is'} not listed in assetlinks.json's sha256_cert_fingerprints. This is the single most common App Links failure: an EAS build is signed with a different keystore than the fingerprint that's actually hosted.`,
            'android.assetlinksJson',
            missing.join(', '),
            'Add the missing fingerprint(s) to sha256_cert_fingerprints, or re-check which build profile / keystore you copied the fingerprint from.'
          );
          fixes.push({ title: 'Fix assetlinks.json', value: expected.assetlinksSnippet, where: `https://${domain || '<your-domain>'}/.well-known/assetlinks.json` });
        }
      }
      void anyRelationOk;
      void anyNamespaceOk;
    }
  }
  if (usesAndroid) {
    checklist.push(`Check on-device verification: adb shell pm get-app-links ${packageName || '<package>'} — look for "verified" under Domain verification state.`);
  }

  // ── 7. Android: intentFilters ────────────────────────────────────────
  if (usesAndroid && !intentFilters.length) {
    pushProblem(
      problems,
      'high',
      'android_intent_filters_empty',
      'android.intentFilters is empty. Without an intent-filter with autoVerify + a https scheme/host, Android never attempts App Links verification at all.',
      'android.intentFilters'
    );
    fixes.push({ title: 'Add intentFilters to app.json', value: expected.androidIntentFilterSnippet, where: 'app.json → expo.android.intentFilters' });
  } else if (usesAndroid) {
    const hosts = new Set();
    intentFilters.forEach((f, i) => {
      const scheme = safeStr(f.scheme).trim();
      const host = normalizeDomain(f.host);
      const pathPrefix = normalizePath(f.pathPrefix);
      if (host) hosts.add(host);
      if (f.autoVerify !== true) {
        pushProblem(
          problems,
          'high',
          'android_intent_autoverify_missing',
          `android.intentFilters[${i}].autoVerify is ${JSON.stringify(f.autoVerify)}, not true. Per Expo's docs, "Specifying autoVerify is required for Android App Links to work correctly" — without it, Android opens the link as an ordinary (non-verified) filter and the browser disambiguation dialog wins.`,
          `android.intentFilters[${i}].autoVerify`,
          f.autoVerify,
          'Set autoVerify: true.'
        );
      }
      if (scheme !== 'https') {
        pushProblem(
          problems,
          'high',
          'android_intent_scheme_not_https',
          `android.intentFilters[${i}].scheme is "${scheme || '(empty)'}" — Android App Links (as opposed to a custom-scheme deep link) require "https".`,
          `android.intentFilters[${i}].scheme`,
          scheme
        );
      }
      if (!host) {
        pushProblem(problems, 'high', 'android_intent_host_missing', `android.intentFilters[${i}].host is empty — Android has no domain to verify against Digital Asset Links.`, `android.intentFilters[${i}].host`);
      }
      if (testedPath && pathPrefix && !testedPath.startsWith(pathPrefix)) {
        pushProblem(
          problems,
          'high',
          'android_intent_path_not_covered',
          `android.intentFilters[${i}].pathPrefix is "${pathPrefix}", which is not a prefix of "${testedPath}". Android's pathPrefix is a literal string prefix match, not a wildcard pattern.`,
          `android.intentFilters[${i}].pathPrefix`,
          pathPrefix,
          `Use a pathPrefix that "${testedPath}" starts with (e.g. "${testedPath.split('/').slice(0, 2).join('/')}").`
        );
        fixes.push({ title: 'Fix app.json intentFilters', value: expected.androidIntentFilterSnippet, where: 'app.json → expo.android.intentFilters' });
      }
    });
    if (hosts.size > 1) {
      pushProblem(
        problems,
        'medium',
        'android_multiple_hosts_reminder',
        `android.intentFilters declares ${hosts.size} different hosts (${Array.from(hosts).join(', ')}). Each one needs its own assetlinks.json hosted at that exact domain's /.well-known/ — this checker only validated the single assetlinks.json you pasted.`,
        'android.intentFilters'
      );
    }
  }

  // ── 8. linking.prefixes ──────────────────────────────────────────────
  if (usesIos || usesAndroid) {
    if (!prefixes.length) {
      pushProblem(
        problems,
        'low',
        'linking_prefixes_empty',
        'linking.prefixes is empty. React Navigation / expo-router use this list to build in-app URLs from a Linking.createURL-style config — without the https host here too, links you construct inside the app itself may not match what the OS hands back.',
        'linking.prefixes'
      );
    } else if (domain && !prefixes.some((p) => p.trim().toLowerCase().startsWith(`https://${domain}`))) {
      pushProblem(
        problems,
        'medium',
        'linking_prefix_missing_https_host',
        `None of linking.prefixes starts with "https://${domain}". Without it, your app's own navigation linking config won't treat that Universal Link the same way as your custom scheme.`,
        'linking.prefixes',
        undefined,
        `Add "https://${domain}" to linking.prefixes.`
      );
    }
  }

  // ── 9. expo-router route existence (informational only) ─────────────
  if (linking.usesExpoRouter === true && testedPath) {
    checklist.push(`Confirm "${testedPath}" matches an actual file-based route under your Expo Router app/ directory — this checker can't see your file system.`);
  }

  // ── 10. cross-platform host consistency (informational) ─────────────
  if (usesIos && usesAndroid && domain) {
    const androidHosts = new Set(intentFilters.map((f) => normalizeDomain(f.host)).filter(Boolean));
    if (androidHosts.size && !androidHosts.has(domain)) {
      pushProblem(
        problems,
        'low',
        'cross_platform_domain_mismatch',
        `iOS is set up for "${domain}" but Android's intentFilters use ${Array.from(androidHosts).map((h) => `"${h}"`).join(', ')}. That may be intentional, but usually both platforms should share one canonical link domain so a single URL works everywhere.`,
        'android.intentFilters'
      );
    }
  }

  checklist.push("Validate the AASA independently of app behavior: on a Mac, `swcutil dl -d <domain>` downloads what Apple's CDN sees; `swcutil verify -d <domain> -j <file> -u <url>` checks a specific URL against it.");
  checklist.push('Re-run this check after every change — app.json, the hosted .well-known files, and your EAS signing credentials drift independently of each other.');

  const sorted = sortProblems(problems);
  const highCount = sorted.filter((p) => p.severity === 'high').length;
  const medCount = sorted.filter((p) => p.severity === 'medium').length;
  const lowCount = sorted.filter((p) => p.severity === 'low').length;

  let status = 'pass';
  if (highCount > 0) status = 'fail';
  else if (medCount > 0 || lowCount > 0) status = 'warn';

  let summary;
  if (status === 'pass') {
    summary = 'No mismatches found. The Apple App ID and paths, the Android package/fingerprint/host, and the app.json config all agree with what you pasted.';
  } else if (status === 'fail') {
    const top = sorted.find((p) => p.severity === 'high');
    summary = `${highCount} blocking mismatch${highCount > 1 ? 'es' : ''} found. Most urgent: ${top.message}`;
  } else {
    const top = sorted[0];
    summary = `Nothing blocking, but ${medCount + lowCount} thing${medCount + lowCount > 1 ? 's' : ''} worth fixing. Top of the list: ${top.message}`;
  }

  return {
    status,
    summary,
    expected,
    problems: sorted,
    fixes,
    checklist,
    disclaimer:
      "Read-only, client-side analysis of the values and files you pasted in. Nothing is verified against your live domain, app.json, or EAS credentials — always confirm with curl -I, adb shell pm get-app-links, and a real device before shipping.",
  };
}

/**
 * Standalone helper: just the expected values for a config, without running
 * the full diagnostic.
 */
export function expectedValues(config) {
  return computeExpected(safeObj(config));
}

// Also expose as a plain browser global when loaded via <script type="module">.
if (typeof window !== 'undefined') {
  window.UniversalLinksDoctor = { diagnose, expectedValues };
}
