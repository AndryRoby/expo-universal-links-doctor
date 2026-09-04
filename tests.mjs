// tests.mjs — plain Node test runner for doctor-universal-links.js (no external dependencies).
// Run with: node tests.mjs

import { diagnose, expectedValues } from './doctor-universal-links.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  }
}

function eq(name, actual, expected) {
  const condition = actual === expected;
  ok(name, condition, condition ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function has(name, arr, code) {
  const condition = Array.isArray(arr) && arr.some((p) => p.code === code);
  ok(name, condition, condition ? '' : `expected a problem with code "${code}", got codes [${(arr || []).map((p) => p.code).join(', ')}]`);
}

function lacks(name, arr, code) {
  const condition = Array.isArray(arr) && !arr.some((p) => p.code === code);
  ok(name, condition, condition ? '' : `did not expect a problem with code "${code}"`);
}

function severityOf(arr, code) {
  const p = (arr || []).find((x) => x.code === code);
  return p ? p.severity : undefined;
}

// A minimal, fully-correct config used as a baseline "pass" case, then
// mutated per-scenario to isolate exactly one rule at a time.
function basePassConfig() {
  return {
    ios: {
      bundleId: 'com.example.myapp',
      teamId: 'ABCDE12345',
      domain: '',
      associatedDomains: ['applinks:example.com'],
      aasaJson: JSON.stringify({
        applinks: {
          apps: [],
          details: [{ appID: 'ABCDE12345.com.example.myapp', paths: ['/product/*', '/*'] }],
        },
      }),
      aasaServedWithRedirect: false,
      aasaContentType: 'application/json',
    },
    android: {
      packageName: 'com.example.myapp',
      sha256Fingerprints: ['14:6D:E9:33:0E:2E:88:BE:4C:71:60:6D:2F:2A:20:D5:76:73:1C:A1:00:88:6A:B1:0A:22:1C:80:4F:A7:5A:F2'],
      assetlinksJson: JSON.stringify([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: 'com.example.myapp',
            sha256_cert_fingerprints: ['14:6D:E9:33:0E:2E:88:BE:4C:71:60:6D:2F:2A:20:D5:76:73:1C:A1:00:88:6A:B1:0A:22:1C:80:4F:A7:5A:F2'],
          },
        },
      ]),
      intentFilters: [{ autoVerify: true, scheme: 'https', host: 'example.com', pathPrefix: '/product' }],
    },
    runtime: 'dev-build',
    linking: {
      prefixes: ['https://example.com'],
      usesExpoRouter: true,
      testedPath: '/product/42',
    },
  };
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

// ─────────────────────────────────────────────────────────────────────────
// 0. Baseline sanity + tolerant input handling
// ─────────────────────────────────────────────────────────────────────────

{
  const r = diagnose(basePassConfig());
  eq('baseline: fully correct config passes', r.status, 'pass');
  eq('baseline: no problems reported', r.problems.length, 0);
  ok('baseline: summary says no mismatches', /No mismatches found/.test(r.summary), r.summary);
  ok('baseline: checklist is non-empty', r.checklist.length > 0);
  ok('baseline: disclaimer is a non-empty string', typeof r.disclaimer === 'string' && r.disclaimer.length > 0);
}

{
  const r = diagnose({});
  eq('empty config: status is warn (runtime not set)', r.status, 'warn');
  eq('empty config: exactly one problem', r.problems.length, 1);
  has('empty config: reports runtime_not_set', r.problems, 'runtime_not_set');
  eq('empty config: runtime_not_set severity is low', severityOf(r.problems, 'runtime_not_set'), 'low');
}

ok('diagnose(null) does not throw', (() => { try { diagnose(null); return true; } catch (e) { return false; } })());
ok('diagnose(undefined) does not throw', (() => { try { diagnose(undefined); return true; } catch (e) { return false; } })());
ok('diagnose(config) with non-object ios/android does not throw', (() => {
  try {
    diagnose({ ios: null, android: 'nope', linking: 42, runtime: 7 });
    return true;
  } catch (e) {
    return false;
  }
})());

// ─────────────────────────────────────────────────────────────────────────
// 1. Runtime
// ─────────────────────────────────────────────────────────────────────────

{
  const cfg = clone(basePassConfig());
  cfg.runtime = 'expo-go';
  const r = diagnose(cfg);
  has('runtime expo-go: reports runtime_expo_go', r.problems, 'runtime_expo_go');
  eq('runtime expo-go: severity is high', severityOf(r.problems, 'runtime_expo_go'), 'high');
  eq('runtime expo-go: status is fail', r.status, 'fail');
}

{
  const cfg = clone(basePassConfig());
  cfg.runtime = 'standalone';
  const r = diagnose(cfg);
  lacks('runtime standalone: no runtime_expo_go', r.problems, 'runtime_expo_go');
  lacks('runtime standalone: no runtime_not_set', r.problems, 'runtime_not_set');
}

// ─────────────────────────────────────────────────────────────────────────
// 2. iOS: bundle ID / team ID
// ─────────────────────────────────────────────────────────────────────────

{
  const cfg = clone(basePassConfig());
  cfg.ios.bundleId = '';
  const r = diagnose(cfg);
  has('ios missing bundleId: high', r.problems, 'ios_missing_bundle_id');
  eq('ios missing bundleId: severity high', severityOf(r.problems, 'ios_missing_bundle_id'), 'high');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.bundleId = 'myapp';
  const r = diagnose(cfg);
  has('ios bad bundleId format: medium', r.problems, 'ios_bundle_id_format');
  eq('ios bad bundleId format: severity medium', severityOf(r.problems, 'ios_bundle_id_format'), 'medium');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.teamId = '';
  const r = diagnose(cfg);
  has('ios missing teamId: high', r.problems, 'ios_missing_team_id');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.teamId = 'abcde12345'; // lowercase, wrong per Apple's format
  const r = diagnose(cfg);
  has('ios bad teamId format: medium', r.problems, 'ios_team_id_format');
  eq('ios bad teamId format: severity medium', severityOf(r.problems, 'ios_team_id_format'), 'medium');
}

// ─────────────────────────────────────────────────────────────────────────
// 3. iOS: associatedDomains format
// ─────────────────────────────────────────────────────────────────────────

{
  const cfg = clone(basePassConfig());
  cfg.ios.associatedDomains = [];
  const r = diagnose(cfg);
  has('associatedDomains empty: high', r.problems, 'ios_associated_domains_empty');
  ok('associatedDomains empty: a fix is suggested', r.fixes.some((f) => f.title.toLowerCase().includes('associateddomains')), JSON.stringify(r.fixes.map((f) => f.title)));
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.associatedDomains = ['https://example.com'];
  const r = diagnose(cfg);
  has('associatedDomains with protocol: high', r.problems, 'ios_associated_domain_has_protocol');
  has('associatedDomains with protocol: also flags missing applinks prefix', r.problems, 'ios_no_applinks_prefix');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.associatedDomains = ['applinks:example.com/foo'];
  const r = diagnose(cfg);
  has('associatedDomains with path: high', r.problems, 'ios_associated_domain_has_path');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.associatedDomains = ['example.com'];
  const r = diagnose(cfg);
  has('associatedDomains bad format (no applinks:): high', r.problems, 'ios_associated_domain_bad_format');
  has('associatedDomains bad format: also flags missing applinks prefix', r.problems, 'ios_no_applinks_prefix');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.associatedDomains = ['applinks:example.com'];
  cfg.ios.domain = 'other.com';
  const r = diagnose(cfg);
  has('ios.domain mismatch vs associatedDomains: medium', r.problems, 'ios_domain_mismatch');
  eq('ios.domain mismatch: severity medium', severityOf(r.problems, 'ios_domain_mismatch'), 'medium');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.associatedDomains = ['applinks:example.com'];
  cfg.ios.domain = 'example.com';
  const r = diagnose(cfg);
  lacks('ios.domain matching associatedDomains: no mismatch', r.problems, 'ios_domain_mismatch');
}

// ─────────────────────────────────────────────────────────────────────────
// 4. iOS: apple-app-site-association JSON
// ─────────────────────────────────────────────────────────────────────────

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaJson = '';
  const r = diagnose(cfg);
  has('aasa missing: medium', r.problems, 'aasa_missing');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaJson = '﻿' + cfg.ios.aasaJson;
  const r = diagnose(cfg);
  has('aasa with BOM: medium', r.problems, 'aasa_bom_present');
  lacks('aasa with BOM: still parses as valid JSON otherwise', r.problems, 'aasa_invalid_json');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaJson = '{ this is not json }';
  const r = diagnose(cfg);
  has('aasa invalid JSON: high', r.problems, 'aasa_invalid_json');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaJson = JSON.stringify({ notApplinks: {} });
  const r = diagnose(cfg);
  has('aasa missing applinks key: high', r.problems, 'aasa_missing_applinks_key');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaJson = JSON.stringify({ applinks: { apps: [], details: [] } });
  const r = diagnose(cfg);
  has('aasa missing details (empty array): high', r.problems, 'aasa_missing_details');
  ok('aasa missing details: a fix is suggested', r.fixes.some((f) => f.title.toLowerCase().includes('apple-app-site-association')));
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaJson = JSON.stringify({
    applinks: {
      details: [
        { appID: 'ABCDE12345.com.example.myapp', paths: ['/product/*'] },
        { appIDs: ['ABCDE12345.com.example.myapp'], components: [{ '/': '/product/*' }] },
      ],
    },
  });
  const r = diagnose(cfg);
  has('aasa mixed legacy/modern formats: medium', r.problems, 'aasa_mixed_formats');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaJson = JSON.stringify({
    applinks: { details: [{ appID: 'ABCDE12345:com.example.myapp', paths: ['/product/*'] }] },
  });
  const r = diagnose(cfg);
  has('aasa appID bad format (colon): medium', r.problems, 'aasa_appid_format');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaJson = JSON.stringify({ applinks: { details: [{ paths: ['/product/*'] }] } });
  const r = diagnose(cfg);
  has('aasa missing appID entirely: high', r.problems, 'aasa_missing_appid');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaJson = JSON.stringify({
    applinks: { details: [{ appID: 'ZZZZZ99999.com.other.app', paths: ['/product/*'] }] },
  });
  const r = diagnose(cfg);
  has('aasa appID mismatch: high', r.problems, 'aasa_appid_mismatch');
  ok('aasa appID mismatch: a fix is suggested', r.fixes.some((f) => f.title.toLowerCase().includes('apple-app-site-association')));
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaJson = JSON.stringify({
    applinks: { details: [{ appID: 'ABCDE12345.com.example.myapp', paths: ['NOT /product/*', '/*'] }] },
  });
  const r = diagnose(cfg);
  has('aasa path excluded via NOT: medium', r.problems, 'aasa_path_excluded');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaJson = JSON.stringify({
    applinks: { details: [{ appID: 'ABCDE12345.com.example.myapp', paths: ['/other/*'] }] },
  });
  const r = diagnose(cfg);
  has('aasa path not covered (legacy paths): high', r.problems, 'aasa_path_not_covered');
  ok('aasa path not covered: a fix is suggested', r.fixes.some((f) => f.title.toLowerCase().includes('apple-app-site-association')));
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaJson = JSON.stringify({
    applinks: { details: [{ appIDs: ['ABCDE12345.com.example.myapp'], components: [{ '/': '/product/*' }] }] },
  });
  const r = diagnose(cfg);
  lacks('aasa path covered via modern components: no path_not_covered', r.problems, 'aasa_path_not_covered');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaJson = JSON.stringify({
    applinks: { details: [{ appIDs: ['ABCDE12345.com.example.myapp'], components: [{ '/': '/product/*', exclude: true }] }] },
  });
  const r = diagnose(cfg);
  has('aasa path excluded via modern components exclude:true', r.problems, 'aasa_path_excluded');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaServedWithRedirect = true;
  const r = diagnose(cfg);
  has('AASA served with redirect: high', r.problems, 'aasa_served_with_redirect');
  eq('AASA served with redirect: severity high', severityOf(r.problems, 'aasa_served_with_redirect'), 'high');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaContentType = 'text/plain';
  const r = diagnose(cfg);
  has('AASA wrong content type: medium', r.problems, 'aasa_content_type_wrong');
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaContentType = 'application/json; charset=utf-8';
  const r = diagnose(cfg);
  lacks('AASA content type with charset suffix is accepted', r.problems, 'aasa_content_type_wrong');
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Android: package name / fingerprints
// ─────────────────────────────────────────────────────────────────────────

{
  const cfg = clone(basePassConfig());
  cfg.android.packageName = '';
  const r = diagnose(cfg);
  has('android missing packageName: high', r.problems, 'android_missing_package_name');
}

{
  const cfg = clone(basePassConfig());
  cfg.android.packageName = 'myapp';
  const r = diagnose(cfg);
  has('android bad packageName format: medium', r.problems, 'android_package_name_format');
}

{
  const cfg = clone(basePassConfig());
  cfg.android.sha256Fingerprints = [];
  const r = diagnose(cfg);
  has('android missing fingerprints: medium', r.problems, 'android_missing_fingerprints');
}

{
  const cfg = clone(basePassConfig());
  cfg.android.sha256Fingerprints = ['not-a-fingerprint'];
  const r = diagnose(cfg);
  has('android bad fingerprint format: medium', r.problems, 'android_fingerprint_format');
}

{
  const cfg = clone(basePassConfig());
  cfg.android.sha256Fingerprints = ['14:6d:e9:33:0e:2e:88:be:4c:71:60:6d:2f:2a:20:d5:76:73:1c:a1:00:88:6a:b1:0a:22:1c:80:4f:a7:5a:f2'];
  cfg.android.assetlinksJson = JSON.stringify([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.example.myapp',
        sha256_cert_fingerprints: ['14:6D:E9:33:0E:2E:88:BE:4C:71:60:6D:2F:2A:20:D5:76:73:1C:A1:00:88:6A:B1:0A:22:1C:80:4F:A7:5A:F2'],
      },
    },
  ]);
  const r = diagnose(cfg);
  has('android lowercase fingerprint (still matches, case-insensitively): low', r.problems, 'android_fingerprint_lowercase');
  eq('android lowercase fingerprint: severity low', severityOf(r.problems, 'android_fingerprint_lowercase'), 'low');
  lacks('android lowercase fingerprint still matches assetlinks case-insensitively', r.problems, 'assetlinks_fingerprint_missing');
}

{
  const r = diagnose(basePassConfig());
  lacks('uppercase fingerprint: no lowercase warning', r.problems, 'android_fingerprint_lowercase');
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Android: assetlinks.json
// ─────────────────────────────────────────────────────────────────────────

{
  const cfg = clone(basePassConfig());
  cfg.android.assetlinksJson = '';
  const r = diagnose(cfg);
  has('assetlinks missing: medium', r.problems, 'assetlinks_missing');
}

{
  const cfg = clone(basePassConfig());
  cfg.android.assetlinksJson = '﻿' + cfg.android.assetlinksJson;
  const r = diagnose(cfg);
  has('assetlinks with BOM: medium', r.problems, 'assetlinks_bom_present');
}

{
  const cfg = clone(basePassConfig());
  cfg.android.assetlinksJson = '{ not json';
  const r = diagnose(cfg);
  has('assetlinks invalid JSON: high', r.problems, 'assetlinks_invalid_json');
}

{
  const cfg = clone(basePassConfig());
  cfg.android.assetlinksJson = JSON.stringify({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: 'com.example.myapp', sha256_cert_fingerprints: [] },
  });
  const r = diagnose(cfg);
  has('assetlinks not an array (bare object): high', r.problems, 'assetlinks_not_array');
  ok('assetlinks not array: a fix is suggested', r.fixes.some((f) => f.title.toLowerCase().includes('assetlinks')));
}

{
  const cfg = clone(basePassConfig());
  cfg.android.assetlinksJson = JSON.stringify([]);
  const r = diagnose(cfg);
  has('assetlinks empty array: high', r.problems, 'assetlinks_empty_array');
}

{
  const cfg = clone(basePassConfig());
  cfg.android.assetlinksJson = JSON.stringify([
    { relation: [], target: { namespace: 'android_app', package_name: 'com.example.myapp', sha256_cert_fingerprints: [cfg.android.sha256Fingerprints[0]] } },
  ]);
  const r = diagnose(cfg);
  has('assetlinks relation missing: high', r.problems, 'assetlinks_relation_missing');
}

{
  const cfg = clone(basePassConfig());
  cfg.android.assetlinksJson = JSON.stringify([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'web', package_name: 'com.example.myapp', sha256_cert_fingerprints: [cfg.android.sha256Fingerprints[0]] },
    },
  ]);
  const r = diagnose(cfg);
  has('assetlinks wrong namespace: high', r.problems, 'assetlinks_namespace_wrong');
}

{
  const cfg = clone(basePassConfig());
  cfg.android.assetlinksJson = JSON.stringify([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.other.app', sha256_cert_fingerprints: [cfg.android.sha256Fingerprints[0]] },
    },
  ]);
  const r = diagnose(cfg);
  has('assetlinks package mismatch: high', r.problems, 'assetlinks_package_mismatch');
  ok('assetlinks package mismatch: a fix is suggested', r.fixes.some((f) => f.title.toLowerCase().includes('assetlinks')));
}

{
  const cfg = clone(basePassConfig());
  cfg.android.assetlinksJson = JSON.stringify([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.example.myapp', sha256_cert_fingerprints: ['00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF'] },
    },
  ]);
  const r = diagnose(cfg);
  has('assetlinks fingerprint missing (does not include ours): high', r.problems, 'assetlinks_fingerprint_missing');
  ok('assetlinks fingerprint missing: a fix is suggested', r.fixes.some((f) => f.title.toLowerCase().includes('assetlinks')));
}

// ─────────────────────────────────────────────────────────────────────────
// 7. Android: intentFilters
// ─────────────────────────────────────────────────────────────────────────

{
  const cfg = clone(basePassConfig());
  cfg.android.intentFilters = [];
  const r = diagnose(cfg);
  has('intentFilters empty: high', r.problems, 'android_intent_filters_empty');
  ok('intentFilters empty: a fix is suggested', r.fixes.some((f) => f.title.toLowerCase().includes('intentfilters')));
}

{
  const cfg = clone(basePassConfig());
  cfg.android.intentFilters[0].autoVerify = false;
  const r = diagnose(cfg);
  has('intentFilters autoVerify false: high', r.problems, 'android_intent_autoverify_missing');
}

{
  const cfg = clone(basePassConfig());
  delete cfg.android.intentFilters[0].autoVerify;
  const r = diagnose(cfg);
  has('intentFilters autoVerify absent: high', r.problems, 'android_intent_autoverify_missing');
}

{
  const cfg = clone(basePassConfig());
  cfg.android.intentFilters[0].scheme = 'http';
  const r = diagnose(cfg);
  has('intentFilters scheme not https: high', r.problems, 'android_intent_scheme_not_https');
}

{
  const cfg = clone(basePassConfig());
  cfg.android.intentFilters[0].host = '';
  const r = diagnose(cfg);
  has('intentFilters host missing: high', r.problems, 'android_intent_host_missing');
}

{
  const cfg = clone(basePassConfig());
  cfg.android.intentFilters[0].pathPrefix = '/other';
  const r = diagnose(cfg);
  has('intentFilters pathPrefix not covering testedPath: high', r.problems, 'android_intent_path_not_covered');
  ok('intentFilters pathPrefix mismatch: a fix is suggested', r.fixes.some((f) => f.title.toLowerCase().includes('intentfilters')));
}

{
  const cfg = clone(basePassConfig());
  cfg.android.intentFilters[0].pathPrefix = '/product';
  const r = diagnose(cfg);
  lacks('intentFilters pathPrefix that IS a prefix of testedPath: ok', r.problems, 'android_intent_path_not_covered');
}

{
  const cfg = clone(basePassConfig());
  cfg.android.intentFilters.push({ autoVerify: true, scheme: 'https', host: 'other.example.com', pathPrefix: '/product' });
  const r = diagnose(cfg);
  has('intentFilters with two different hosts: medium reminder', r.problems, 'android_multiple_hosts_reminder');
  eq('multiple hosts reminder: severity medium', severityOf(r.problems, 'android_multiple_hosts_reminder'), 'medium');
}

// ─────────────────────────────────────────────────────────────────────────
// 8. linking.prefixes
// ─────────────────────────────────────────────────────────────────────────

{
  const cfg = clone(basePassConfig());
  cfg.linking.prefixes = [];
  const r = diagnose(cfg);
  has('linking.prefixes empty: low', r.problems, 'linking_prefixes_empty');
  eq('linking.prefixes empty: severity low', severityOf(r.problems, 'linking_prefixes_empty'), 'low');
}

{
  const cfg = clone(basePassConfig());
  cfg.linking.prefixes = ['myapp://'];
  const r = diagnose(cfg);
  has('linking.prefixes missing https host: medium', r.problems, 'linking_prefix_missing_https_host');
}

{
  const cfg = clone(basePassConfig());
  cfg.linking.prefixes = ['https://example.com', 'myapp://'];
  const r = diagnose(cfg);
  lacks('linking.prefixes containing https host: ok', r.problems, 'linking_prefix_missing_https_host');
}

// ─────────────────────────────────────────────────────────────────────────
// 9. expo-router checklist + cross-platform host consistency
// ─────────────────────────────────────────────────────────────────────────

{
  const cfg = clone(basePassConfig());
  cfg.linking.usesExpoRouter = true;
  cfg.linking.testedPath = '/product/42';
  const r = diagnose(cfg);
  ok('expo-router + testedPath: checklist mentions the route', r.checklist.some((c) => c.includes('/product/42')), JSON.stringify(r.checklist));
}

{
  const cfg = clone(basePassConfig());
  cfg.ios.associatedDomains = ['applinks:example.com'];
  cfg.android.intentFilters[0].host = 'different.com';
  cfg.android.assetlinksJson = JSON.stringify([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.example.myapp', sha256_cert_fingerprints: [cfg.android.sha256Fingerprints[0]] },
    },
  ]);
  const r = diagnose(cfg);
  has('cross-platform host mismatch (iOS vs Android domain): low', r.problems, 'cross_platform_domain_mismatch');
  eq('cross-platform host mismatch: severity low', severityOf(r.problems, 'cross_platform_domain_mismatch'), 'low');
}

// ─────────────────────────────────────────────────────────────────────────
// 10. Status thresholds and summary text
// ─────────────────────────────────────────────────────────────────────────

{
  const cfg = clone(basePassConfig());
  cfg.ios.aasaContentType = 'text/plain'; // one medium-only problem
  const r = diagnose(cfg);
  eq('one medium-only problem: status is warn', r.status, 'warn');
  ok('warn summary mentions "worth fixing"', /worth fixing/.test(r.summary), r.summary);
}

{
  const cfg = clone(basePassConfig());
  cfg.linking.prefixes = []; // one low-only problem
  const r = diagnose(cfg);
  eq('one low-only problem: status is warn', r.status, 'warn');
}

{
  const cfg = clone(basePassConfig());
  cfg.runtime = 'expo-go';
  cfg.ios.bundleId = '';
  const r = diagnose(cfg);
  eq('multiple high problems: status is still just fail', r.status, 'fail');
  ok('fail summary mentions "blocking mismatch"', /blocking mismatch/.test(r.summary), r.summary);
  eq('problems are sorted with high severity first', r.problems[0].severity, 'high');
}

// ─────────────────────────────────────────────────────────────────────────
// 11. expectedValues() standalone helper
// ─────────────────────────────────────────────────────────────────────────

{
  const ev = expectedValues({
    ios: { bundleId: 'com.example.myapp', teamId: 'ABCDE12345', associatedDomains: ['applinks:example.com'] },
    android: { packageName: 'com.example.myapp', sha256Fingerprints: ['AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'] },
    linking: { testedPath: '/product/42' },
  });
  eq('expectedValues: appId is TEAMID.bundleID', ev.appId, 'ABCDE12345.com.example.myapp');
  eq('expectedValues: associatedDomainsEntry', ev.associatedDomainsEntry, 'applinks:example.com');
  ok('expectedValues: aasaSnippet is valid JSON containing the appID', (() => {
    try {
      const parsed = JSON.parse(ev.aasaSnippet);
      return parsed.applinks.details[0].appID === 'ABCDE12345.com.example.myapp';
    } catch (e) {
      return false;
    }
  })());
  ok('expectedValues: assetlinksSnippet is a valid JSON array with the package name', (() => {
    try {
      const parsed = JSON.parse(ev.assetlinksSnippet);
      return Array.isArray(parsed) && parsed[0].target.package_name === 'com.example.myapp';
    } catch (e) {
      return false;
    }
  })());
  ok('expectedValues: androidIntentFilterSnippet is valid JSON with autoVerify true', (() => {
    try {
      const parsed = JSON.parse(ev.androidIntentFilterSnippet);
      return parsed.expo.android.intentFilters[0].autoVerify === true;
    } catch (e) {
      return false;
    }
  })());
}

{
  const ev = expectedValues({});
  eq('expectedValues on empty config: appId is null', ev.appId, null);
  eq('expectedValues on empty config: associatedDomainsEntry is null', ev.associatedDomainsEntry, null);
}

// ─────────────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('All tests passed.');
}
