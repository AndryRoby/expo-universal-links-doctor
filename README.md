# Expo Universal Links & App Links Doctor

Checks an Expo/React Native app's iOS Universal Links and Android App Links configuration and points at the exact reason a `https://` link opens a browser tab instead of the app.

Live: https://arling.sk/expo-universal-links-doctor/

## What it checks

The engine (`doctor-universal-links.js`) cross-checks `app.json`, the hosted `apple-app-site-association` (AASA) file, `assetlinks.json`, and your Android `intentFilters` against what iOS and Android verification actually require, and reports one problem code per mismatch:

**iOS: `associatedDomains` (app.json)**
- `ios_associated_domains_empty`: no `applinks:` entry at all, so iOS never attempts Universal Links.
- `ios_associated_domain_has_protocol`: entry includes `https://`, which silently breaks it.
- `ios_associated_domain_has_path`: entry has a path after the domain; only `applinks:<domain>` is valid.
- `ios_no_applinks_prefix`: none of the entries use the `applinks:` service type.
- `ios_domain_mismatch`: the domain you said hosts the AASA file isn't in `associatedDomains`.
- `ios_missing_bundle_id`, `ios_bundle_id_format`, `ios_missing_team_id`, `ios_team_id_format`: the bundle ID / 10-character Apple Team ID needed to compute the expected `appID`.

**iOS: `apple-app-site-association`**
- `aasa_missing`, `aasa_invalid_json`, `aasa_bom_present`: file not pasted in, doesn't parse, or starts with a UTF-8 BOM some parsers reject.
- `aasa_missing_applinks_key`, `aasa_missing_details`, `aasa_missing_appid`: required `applinks.details[].appID`/`appIDs` structure absent.
- `aasa_mixed_formats`: legacy (`appID`/`paths`) and modern (`appIDs`/`components`) shapes mixed in the same file.
- `aasa_appid_format`, `aasa_appid_mismatch`: an `appID` isn't `<TeamID>.<BundleID>`, or none match your app.
- `aasa_path_excluded`, `aasa_path_not_covered`: the path you tested is excluded, or not matched by any `paths`/`components` pattern (remember `*` doesn't cross a `/`).
- `aasa_served_with_redirect`: the AASA URL responds with a 301/302; Apple's fetcher does not follow redirects.
- `aasa_content_type_wrong`: served with a `Content-Type` other than `application/json`.

**Android: `intentFilters` (app.json) and package identity**
- `android_intent_filters_empty`: no intent-filter, so Android never attempts App Links verification.
- `android_intent_autoverify_missing`: `autoVerify` isn't `true`.
- `android_intent_scheme_not_https`, `android_intent_host_missing`: filter isn't `https`, or has no host.
- `android_intent_path_not_covered`: `pathPrefix` is a literal-string prefix, not a wildcard, and doesn't cover the tested path.
- `android_multiple_hosts_reminder`: multiple hosts declared; each needs its own hosted `assetlinks.json`.
- `android_missing_package_name`, `android_package_name_format`: Android application ID missing or not reverse-DNS shaped.

**Android: `assetlinks.json` and signing fingerprints**
- `assetlinks_missing`, `assetlinks_invalid_json`, `assetlinks_bom_present`: file not pasted in, doesn't parse, or has a BOM.
- `assetlinks_not_array`, `assetlinks_empty_array`: must be a JSON *array* of statements, not a bare object, and not empty.
- `assetlinks_relation_missing`: missing the exact `delegate_permission/common.handle_all_urls` relation string.
- `assetlinks_namespace_wrong`, `assetlinks_package_mismatch`: `target.namespace` isn't `android_app`, or no entry's `package_name` matches yours.
- `assetlinks_fingerprint_missing`: your `sha256Fingerprints` aren't listed in `sha256_cert_fingerprints`. The most common cause: a debug build, an EAS dev-client build, and a Google Play App Signing release build are three different certificates, and only one of them is usually pasted in.
- `android_missing_fingerprints`, `android_fingerprint_format`, `android_fingerprint_lowercase`: fingerprint list empty, not 32-byte colon-separated hex, or lowercase (Google's tooling prints uppercase).

**Cross-platform and runtime**
- `runtime_expo_go`: Universal Links / App Links are a native-OS feature tied to the installed app's own bundle ID and signing key, so they can't work inside Expo Go at all.
- `runtime_not_set`: which build type was tested isn't specified.
- `linking_prefixes_empty`, `linking_prefix_missing_https_host`: React Navigation/expo-router `linking.prefixes` doesn't include the `https://` host, so in-app URL construction can drift from what the OS hands back.
- `cross_platform_domain_mismatch`: iOS and Android are configured for different domains.

Each problem carries a `severity` (`high`/`medium`/`low`), the config `path` it's about, and a `fix` where one applies; the report also returns ready-to-paste `expected` snippets for `app.json`, the AASA file, and `assetlinks.json`.

## What it does not do

- It does not call Apple's or Google's live verification services, fetch your domain, or run `adb`/`swcutil` for you; it only reads the values and file contents you paste in.
- It does not inspect your actual signed build, your EAS credentials, or your App Store/Play Console listing.
- It is a config linter, not a live tester: a clean report is not a guarantee that a real device will verify the link.
- It sends nothing you type or paste anywhere. No account, no login, no payment wall.

## How it works

Fill in your Apple Team ID / bundle identifier and `ios.associatedDomains`, the pasted response body of `apple-app-site-association`, your Android package name and signing fingerprint(s), the pasted response body of `assetlinks.json`, your `intentFilters`, and which runtime you tested on. The page calls one pure, dependency-free function, `diagnose(config)`, from `doctor-universal-links.js` (also published as `window.UniversalLinksDoctor.diagnose`), entirely in your browser; nothing is sent over the network. Real input and output, run with `node`:

```js
import { diagnose } from './doctor-universal-links.js';

diagnose({
  ios: {
    bundleId: 'com.example.myapp', teamId: 'ABCDE12345',
    associatedDomains: ['applinks:myapp.com'],
    aasaJson: '{"applinks":{"details":[{"appID":"ABCDE12345.com.example.myapp","paths":["*"]}]}}',
  },
  android: {
    packageName: 'com.example.myapp',
    sha256Fingerprints: ['77:7E:85:8C:93:9A:A1:A8:AF:B6:BD:C4:CB:D2:D9:E0:E7:EE:F5:FC:03:0A:11:18:1F:26:2D:34:3B:42:49:50'],
    assetlinksJson: '[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"com.example.myapp","sha256_cert_fingerprints":["3A:2B:9C:14:6D:E9:33:0E:2E:88:BE:4C:71:60:6D:2F:2A:20:D5:76:73:1C:A1:00:88:6A:B1:0A:22:1C:80:4F"]}}]',
    intentFilters: [{ autoVerify: true, scheme: 'https', host: 'myapp.com', pathPrefix: '/' }],
  },
  runtime: 'standalone',
});
```

```json
{
  "status": "fail",
  "summary": "1 blocking mismatch found. Most urgent: Fingerprint \"77:7E:85:...:49:50\" from android.sha256Fingerprints is not listed in assetlinks.json's sha256_cert_fingerprints. This is the single most common App Links failure: an EAS build is signed with a different keystore than the fingerprint that's actually hosted.",
  "problems": [
    {
      "severity": "high",
      "code": "assetlinks_fingerprint_missing",
      "message": "Fingerprint \"77:7E:85:...:49:50\" from android.sha256Fingerprints is not listed in assetlinks.json's sha256_cert_fingerprints.",
      "path": "android.assetlinksJson",
      "fix": "Add the missing fingerprint(s) to sha256_cert_fingerprints, or re-check which build profile / keystore you copied the fingerprint from."
    }
  ]
}
```

iOS is fully correct in this example: only the Android fingerprint is flagged, because the debug/EAS fingerprint in `sha256Fingerprints` isn't the one hosted in `assetlinks.json`.

## Run locally

No build step, no dependencies.

```bash
git clone https://github.com/AndryRoby/expo-universal-links-doctor.git
cd expo-universal-links-doctor
python -m http.server
# or just open index.html directly in a browser
```

## Tests

```bash
node tests.mjs
```

106 assertions, all passing as of this writing. Each scenario mutates one field of a known-good baseline config to isolate exactly one problem code at a time.

## Privacy

Everything runs client-side in your browser; no config you type or paste is ever sent anywhere. Anonymous product analytics (page views, "run check" clicked) go to a self-hosted Umami instance with no cookies and no personal data: event names and counts only, never the content of what you entered. The optional "tell me when a new tool lands" email signup is voluntary and used for nothing else; see https://arling.sk/privacy/ for the full policy.

## Sources

The rules implemented here come from, and are cross-checked against:

- [Expo: iOS Universal Links](https://docs.expo.dev/linking/ios-universal-links/)
- [Expo: Android App Links](https://docs.expo.dev/linking/android-app-links/)
- [Expo: Linking overview](https://docs.expo.dev/linking/overview/) (Expo Go limitations)
- [Apple: Supporting associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
- [Apple TN3155: Debugging Universal Links](https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links)
- [Android: Verify Android App Links](https://developer.android.com/training/app-links/verify-android-applinks)
- [Stack Overflow #71399617: sha256_cert_fingerprints for assetlinks.json in Expo](https://stackoverflow.com/questions/71399617/how-to-get-sha256-cert-fingerprints-for-assetlinks-json-for-expo)

## Report a problem

Found a failure mode this tool doesn't catch, or a check that flags something that's actually fine? Open an issue: https://github.com/AndryRoby/expo-universal-links-doctor/issues, or write to andrej@arling.sk. Include the relevant (redacted) config, what actually happened at runtime and on which build type, and what you expected the tool to say.

## License

All rights reserved, see [LICENSE-NOTICE.md](LICENSE-NOTICE.md). Reading the code and learning from it is fine; deploying your own copy of it as a product is not.

---

ARLing s. r. o., Bratislava, Slovakia. andrej@arling.sk

Hub and sibling tools: https://arling.sk/ · https://arling.sk/google-oauth-redirect-doctor/ · https://arling.sk/expo-supabase-auth-doctor/ · https://arling.sk/supabase-redirect-doctor/ · https://arling.sk/flutter-supabase-doctor/ · https://arling.sk/sepa-pain001-doctor/ · https://arling.sk/bookapp/
