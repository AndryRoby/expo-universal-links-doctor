# Expo Universal Links & App Links Doctor

Live: https://arling.sk/expo-universal-links-doctor/

A free, static, client-side tool that checks your Expo / React Native
**iOS Universal Links** and **Android App Links** configuration — the
`app.json`/`app.config` entries, the `apple-app-site-association` file,
`assetlinks.json`, and the native manifests they produce — and points
at the exact mismatch that's making `https://yourapp.com/...` open a
browser tab instead of your app, instead of you re-reading Apple's and
Android's verification docs side by side for the third time.

## What it's for

If tapping a `https://` link to your domain opens Safari/Chrome
instead of your app — or it works on iOS but not Android, or the
other way around, or it worked once and stopped after a rebuild —
this tool takes the configuration that's normally split across
`app.json`, a JSON file hosted on your own domain, and whatever the
native build actually generated, and cross-checks it for the
mismatches that cause almost all of these failures:

- **iOS `associatedDomains`** missing the `applinks:` prefix, or
  including the `https://` protocol by mistake — either one silently
  breaks Universal Links even though the domain "looks" right
  ([Expo: iOS Universal Links](https://docs.expo.dev/linking/ios-universal-links/)).
- **`apple-app-site-association`** not reachable at exactly
  `/.well-known/apple-app-site-association` over HTTPS, redirected
  (Apple's fetcher does not follow redirects), or with an `appID` that
  doesn't match `<Apple Team ID>.<bundle identifier>` byte-for-byte.
- **Android `intentFilters`** missing `"autoVerify": true`, using a
  scheme other than `https`, or a `host` that doesn't match your real
  domain.
- **`assetlinks.json`** not a JSON array, wrong `package_name`,
  missing the `delegate_permission/common.handle_all_urls` relation,
  or `sha256_cert_fingerprints` that don't match the certificate your
  build is actually signed with — the single most common cause,
  because the fingerprint for a local debug build, an EAS dev client,
  and a **Google Play App Signing**-managed release build are three
  different certificates, and only one of them will match what's on
  the domain at a time
  ([Android: Verify Android App Links](https://developer.android.com/training/app-links/verify-android-applinks)).
- Configuration that only runs against the platform(s) you actually
  fill in — so a Universal Links problem and an App Links problem
  don't get mixed together in one report, and an incomplete iOS-only
  or Android-only config isn't flagged for the platform you haven't
  filled in yet.
- Testing from **Expo Go**, where Universal Links / App Links can't
  work at all since it's a native-OS feature tied to the installed
  app's own bundle ID and signing key.

## How it works (client-side only)

Everything runs in your browser. There is no backend, no account, and
no payment wall. You fill in your app's Apple Team ID / bundle
identifier, `ios.associatedDomains` from `app.json`, the pasted
response body of your `apple-app-site-association` file, your Android
package name and signing certificate fingerprint(s), the pasted
response body of `assetlinks.json`, your `intentFilters` entry, and
which runtime you tested on — and `doctor-universal-links.js`, one
dependency-free JavaScript file, runs a single pure function,
`diagnose(config)`, entirely in your browser, returning a
plain-language report of what's wrong with copy-paste fixes for
`app.json`, the AASA file, and `assetlinks.json`.

Nothing about your configuration is sent anywhere. The only network
activity this site generates is:

- loading its own static assets (HTML/CSS/JS) from GitHub Pages,
- and anonymous product-analytics events (page view, "run check"
  clicked, etc.) sent to a self-hosted Umami instance — **event names
  and counts only, never the content of what you entered.**

You can verify this yourself: open your browser's network tab while
using the tool, or just read `index.html` and `doctor-universal-links.js` — it's
static files with no build step.

## Privacy

- No account, no login, no cookies for the tool itself.
- No server-side processing of your config — the "backend" is your own
  browser's JavaScript engine.
- Analytics (Umami) records that *a* check ran, not *what* you checked.
- If you're paranoid (fair, given how many secrets end up pasted into
  config debuggers), download the repo and open `index.html` locally
  with your network disconnected — it still works fully, since every
  field is something you paste in yourself; the tool never fetches
  anything from your domain.

## Running it locally

There's no build step. It's static files.

```bash
git clone https://github.com/AndryRoby/expo-universal-links-doctor.git
cd expo-universal-links-doctor
# any static file server works, e.g.:
npx serve .
# or just open index.html directly in a browser
```

## Reporting a missing case / false positive

Found an Expo Universal Links / App Links failure mode this tool
doesn't catch, or a check that flags something that's actually fine?
Please open an issue on the GitHub repo with:

1. The relevant (redacted) config — `associatedDomains`,
   `intentFilters`, the AASA/`assetlinks.json` content, Expo SDK
   version.
2. What actually happened at runtime (the link opened a browser,
   nothing happened, it worked on one platform only, etc.) and on
   which platform/build type (Expo Go, dev client, EAS build,
   TestFlight/Play Store).
3. What you expected the tool to say.

Redact anything sensitive (real domains, signing fingerprints, bundle
IDs you don't want public) before posting — issues are public.

## Disclaimer

This tool is provided **as is**, with no warranty of any kind. It
checks for known, common misconfiguration patterns — it cannot
guarantee your Universal Links or App Links will verify or open
correctly, and a clean report is not a guarantee of a working
integration. It performs a read-only, client-side analysis of the
values you type or paste in; nothing is verified against Apple's or
Google's live verification services, your App Store/Play Console
listing, or your actual signed build.
Apple, Google, and Expo are not affiliated with this tool, and their
platforms, consoles, and docs may change in ways that make individual
checks stale over time. Always verify against the current official
documentation for anything security- or release-relevant.

## About

Built by ARLing s. r. o. (Bratislava, Slovakia).
Contact: andrej@arling.sk

Sibling tools in the same "Doctor" family:
- Supabase Auth deep links, web (Next.js/Vite/SvelteKit): https://arling.sk/supabase-redirect-doctor/
- Supabase Auth deep links, Flutter (supabase_flutter): https://arling.sk/flutter-supabase-doctor/
- Supabase Auth deep links, Expo/React Native: https://arling.sk/expo-supabase-auth-doctor/
- More ARLing tools: https://arling.sk/
