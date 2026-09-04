# Launch posts — Expo Universal Links & App Links Doctor

Tool: https://arling.sk/expo-universal-links-doctor/
Do not post any of this until the tool is actually live at that URL.
All copy below is ready to paste. Read each platform's current rules
immediately before posting (noted per-section) — rules and mod
sentiment change over time and this file won't stay current with them.

Research method: GitHub REST search API (`api.github.com/search/issues`)
against `repo:expo/expo` and `repo:expo/router` for `universal links`,
`applinks`, `assetlinks`, `"app links" not verified`; GitHub Discussions
search on both repos; Stack Overflow search via web search. **Stack
Overflow's own search UI and API both refused automated fetches in this
session** (blocked for scraping/bots) — see the note at the end of
section 0. Nothing below is invented; every thread has a real URL you
can open.

---

## 0. Research log — every thread found

Recommendation rule used: closed more than 12 months ago → skip.
Open but dead (no human reply in a long time, no longer watched) →
skip anyway, noted why.

| # | Thread | State | Last human comment | Recommendation |
|---|--------|-------|---------------------|-----------------|
| 1 | [expo/expo#46428](https://github.com/expo/expo/issues/46428) — `openAuthSessionAsync` doesn't open the browser on Android when App Links are configured for the same domain | **Open** | none yet (0 comments as of research) | **Post** — exact match, first reply |
| 2 | [expo/expo#44856](https://github.com/expo/expo/issues/44856) — [SDK 55] Deeplinks do not work on iOS | Open (stale-bot warned 2026-08-09, may auto-close soon) | 2026-05-11 (oanacioarawaterford) | **Post** — check it's still open first |
| 3 | [expo/expo#38172](https://github.com/expo/expo/issues/38172) — Associated Domains get ignored when using React Navigation | Closed 2025-11-09 (stale-bot) | 2025-08-04 (cjoshmartin) | **Post, borderline** — closed 10 months ago by the closed-date rule, but the last real human comment was ~13 months ago. Your call; content below is written as a "for future searchers" reply either way. |
| 4 | [expo/expo#46427](https://github.com/expo/expo/issues/46427) / [#46368](https://github.com/expo/expo/issues/46368) — same `openAuthSessionAsync`/App Links bug, earlier reports | Closed (dup of #46428) | 2026-05-30 / 2026-05-28 | Skip — duplicates, reply on #46428 instead |
| 5 | [expo/expo#49378](https://github.com/expo/expo/issues/49378) — `[expo-router][Android] getInitialURL` can update `NavigationContainer` state before mount | Open | 2026-09-01 (Ubax) | Skip — not a config mismatch our tool checks (it's a React Navigation race-condition bug), and a maintainer (brentvatne) plus an internal bot are already actively fixing it. Nothing useful to add. |
| 6 | [expo/expo#37401](https://github.com/expo/expo/issues/37401) — SDK 53: deep links don't work when the app starts closed | Closed 2026-05-28 | (34 comments, maintainer-assigned) | Skip — already extensively discussed and closed with a maintainer assigned; low value to add a reply now |
| 7 | [expo/expo#19708](https://github.com/expo/expo/issues/19708) — Universal Links not working on redirect in `openAuthSessionAsync` | Closed 2026-04-29 | (18 comments) | Skip — older manifestation of the same class of bug now tracked live in #46428; reply there instead |
| 8 | [expo/expo#37028](https://github.com/expo/expo/issues/37028) — Expo Router iOS deep linking broken in closed/killed state | Closed 2025-05-22 | 2025-05-22 (fixed same day, PR #36864) | Skip — resolved, >12 months old |
| 9 | [expo/expo#21705](https://github.com/expo/expo/issues/21705) — Deep Links do not work on Android | Closed, labeled "invalid issue: question" | 2023 | Skip — stale, closed as not-a-bug |
| 10 | [expo/expo#18769](https://github.com/expo/expo/issues/18769) — Deep Links not working for Android, IntentFilters | Closed 2025-07-14 | 2025-07-14 | Skip — >12 months old |
| 11 | [expo/expo#15486](https://github.com/expo/expo/issues/15486) — EAS Build: Android applinks don't work with `autoFilter:true` | Closed 2022 | 2022 | Skip — years old |
| 12 | [expo/router#818](https://github.com/expo/router/issues/818) — `unstable_settings` breaks deep linking in foreground/background | Open (technically) | 2024-11-24 | Skip — no activity in ~22 months despite being open; reads as abandoned/unwatched |
| 13 | [expo/router#686](https://github.com/expo/router/discussions/686) — docs discrepancy between Expo's and Apple's universal-link path/component format | Open, 0 replies | 2023-06-25 (opened, never answered) | Skip — 3-year-old unanswered discussion, and it's a docs-wording question, not a "my link is broken" support case |
| 14 | [expo/expo#25153](https://github.com/expo/expo/discussions/25153) — how to avoid pushing a specific universal link with expo-router | Open discussion | 2023 | Skip — old, narrow framework-usage question, not a config-verification problem |
| 15 | Stack Overflow — `expo universal links not working`, `expo assetlinks.json not verified`, etc. | — | — | **Could not verify.** stackoverflow.com and `api.stackexchange.com` both refused every automated fetch in this session (search pages and API alike). The one SO thread already cited in this tool's own `llms-full.txt` — [#71399617, "How to get sha256_cert_fingerprints for assetlinks.json for expo"](https://stackoverflow.com/questions/71399617/how-to-get-sha256-cert-fingerprints-for-assetlinks-json-for-expo) — is real (it was verified when that file was written) but I could not re-check its current answer/comment activity just now. **Before posting there, open it manually and check it's still unanswered / still getting activity.** If it looks abandoned or answered, skip it. |

Unrelated noise filtered out of the table (build errors, Figma
templates, unrelated `expo-router` PRs, etc. that the searches also
surfaced): expo/expo#48841, #39601, #39294, #31721, #23952, #42226,
#40031, #22297, #11920, #6609, #7190, #30248, #29210, #21248 — none of
these are about Universal Links / App Links configuration.

---

## 1. GitHub thread replies

Post these as regular replies on the existing threads. Each is
tailored to what that specific thread actually reported — don't reuse
one paragraph across all three.

### 1a. `expo/expo` issue #46428

> Confirming this matches the same root cause as #46427/#46368
> (closed as duplicates, but the underlying bug is the same and still
> open here): Android's App Links verification grabs the URL you pass
> to `openAuthSessionAsync` because it shares a domain you've already
> verified for App Links, instead of letting the auth session's own
> browser tab handle it. There's a fix in progress at #47524 if you
> want to track/test it.
>
> Until that lands, the workaround that unblocks most people is moving
> the OAuth callback to a subdomain that's *not* covered by your
> Android `intentFilters`/`assetlinks.json` — e.g. `auth.yourapp.com`
> instead of `yourapp.com` itself. App Links only intercepts domains
> it's verified for, so an unverified subdomain correctly falls
> through to the browser.
>
> I built a free checker for this class of App Links / Universal Links
> misconfiguration — this exact interaction (App Links vs.
> `openAuthSessionAsync` on a shared domain) is one of the checks — in
> case it's useful either way: https://arling.sk/expo-universal-links-doctor/

### 1b. `expo/expo` issue #44856

> Since you've confirmed the *exact same* `app.json`/AASA setup works
> on SDK 54 and only breaks on SDK 55, that points away from the AASA
> file itself — @zoontek already ruled that out with the
> cache-busting `?mode=developer` check — and toward what SDK 55's
> config plugin actually writes into the built app.
>
> Worth checking directly: after `npx expo prebuild --clean`, open
> `ios/<YourApp>/<YourApp>.entitlements` and confirm
> `com.apple.developer.associated-domains` actually contains
> `applinks:yourdomain.com`. A config-plugin regression between SDK 54
> and 55 that dropped or malformed that entry would produce exactly
> this symptom — AASA fine, Apple's side fine, link still falls
> through to Safari — without anything server-side being wrong. If
> it's missing or malformed there, that's a prebuild bug specific to
> SDK 55, worth flagging to the config-plugins team with that file
> attached.
>
> I put together a free checker that cross-references your `app.json`
> config against your AASA content and flags exactly this kind of
> "config says one thing, generated output says another" mismatch —
> might save you a step once you can pull the entitlements file:
> https://arling.sk/expo-universal-links-doctor/

### 1c. `expo/expo` issue #38172

> Leaving this for anyone who lands here from search — the "Synced
> capabilities: Disabled: Associated Domains" message during EAS Build
> is the actual root cause here, not a React Navigation issue. EAS
> syncs your local entitlements against what's actually enabled for
> that Bundle ID in the Apple Developer portal; if Associated Domains
> isn't turned on there yet (or the provisioning profile predates
> enabling it), EAS silently strips the capability at build time even
> though `app.json` and your local entitlements look correct — which
> lines up with what happened here: manually adding the entitlement
> worked around it locally, but a fresh EAS build would keep
> re-disabling it until the portal side matches.
>
> Fix: Apple Developer portal → Certificates, Identifiers & Profiles →
> your App ID → enable the "Associated Domains" capability, then run
> `eas build` again (automatic credentials will regenerate the
> provisioning profile for you). The React Navigation `linking` config
> in the original post was already fine — the domain just never had
> the capability to receive the link in the first place.
>
> I built a free checker that flags this class of app.json vs. AASA
> vs. actual-entitlement mismatch, in case it helps anyone else who
> finds this thread: https://arling.sk/expo-universal-links-doctor/

---

## 2. Show HN

**Read HN's guidelines immediately before posting**
(https://news.ycombinator.com/newsguidelines.html and the Show HN
notes at https://news.ycombinator.com/showhn.html) — post from the
account that will actually answer comments, and be ready to respond
for a few hours afterward.

**Title:**
```
Show HN: Expo Universal Links & App Links Doctor – find why your https:// link opens Safari
```

**Text:**
```
I kept seeing the same handful of Expo/React Native bugs where a
https:// link to your own domain opens a browser tab instead of the
app — or works on iOS and not Android, or the reverse, or worked once
and quietly stopped after a rebuild. Almost all of them come down to
one of: iOS associatedDomains missing the "applinks:" prefix,
apple-app-site-association not reachable without a redirect (Apple's
fetcher won't follow one) or with a wrong appID, Android's
intentFilters missing autoVerify/BROWSABLE, or assetlinks.json listing
the wrong certificate fingerprint — debug, EAS dev-client, and Google
Play App Signing builds are three different certificates, and
matching only the one you have on hand is the single most common
cause of "works on my phone, not from the Play Store."

This is a free, static, client-side page: paste your app.json fields,
your AASA/assetlinks.json content (or fetch them live from your own
domain, in your own browser), your Team ID/bundle ID/package name and
signing fingerprints, and which platforms you've actually wired up —
it cross-checks all of it against what iOS and Android verification
actually require and points at the specific mismatch.

It's a config linter, not a live tester — it can't call Apple's or
Google's verification services, and it won't catch a runtime bug in
your own linking-handler code. No account, no backend, nothing you
paste leaves your browser except anonymous "a check ran" analytics
events. Feedback and missing failure modes very welcome.
```

---

## 3. Reddit (r/expo, r/reactnative) and Expo Discord #showcase

**Before posting to any of these, read the current rules first:**
- Expo Discord: check the #showcase channel's pinned rules/topic —
  some showcase channels require a specific template or a linked
  repo.
- r/expo and r/reactnative: check each subreddit's rules (sidebar /
  About / "Rules" tab) for self-promotion policy — many require a
  flair, restrict promo to a specific day, or cap how often the same
  link can be posted. If a subreddit disallows self-promo outright,
  skip it rather than risk a ban.

**Short post (adjust flair/tags to fit each platform):**
```
Built a small free tool: Expo Universal Links & App Links Doctor —
paste your app.json config, your apple-app-site-association /
assetlinks.json content, your Team ID/bundle ID/package name and
signing fingerprints, and which platforms you've configured, and it
flags the exact mismatch causing your https:// link to open a browser
instead of your app (or work on one platform only). Static,
client-side, no signup, no backend — runs entirely in your browser.

https://arling.sk/expo-universal-links-doctor/

It's a config linter, not a live verifier — it won't catch a runtime
bug in your own deep-link handler, just the config mismatches (missing
applinks: prefix, AASA redirected or wrong appID, missing autoVerify/
BROWSABLE, assetlinks fingerprint mismatch, one-platform-only setups,
stale prebuild output) that cause most "my universal link just doesn't
work" reports I kept running into. Feedback on cases it misses is very
welcome.
```

---

## 4. dev.to article

**Working title:** 5 reasons your Expo Universal Link opens Safari instead of your app

**Outline:**
1. **Intro** — why this bug shows up so often and reads as mysterious
   (draft below).
2. **1. The `applinks:` prefix (iOS)** — `associatedDomains` needs
   exactly `applinks:yourdomain.com`; a bare domain or one that
   includes `https://` is silently ignored by iOS with no error.
3. **2. The AASA file Apple's fetcher can't actually reach** —
   reachability at exactly `/.well-known/apple-app-site-association`,
   no redirect (Apple's crawler does not follow one, even though a
   normal browser visit does), and an `appID` that matches
   `<Apple Team ID>.<bundle identifier>` byte-for-byte.
4. **3. Android's intent filter, missing one flag** —
   `"autoVerify": true` and the `BROWSABLE` category both have to be
   present, and `data.host` has to be the real domain, not a
   copy-pasted placeholder.
5. **4. The `assetlinks.json` fingerprint that doesn't match your real
   build** — debug keystore, EAS dev-client, and Google Play App
   Signing are three different certificates; matching only the one
   you have on hand is why it works on your phone and not from the
   Play Store.
6. **5. You edited `app.json` and didn't rebuild** — Expo's config
   plugins write the native manifests/entitlements at
   `prebuild`/build time, not at runtime; an edited `app.json` on an
   already-built binary changes nothing.
7. **Bonus: the one-platform trap** — configuring iOS (or Android)
   thoroughly and assuming "links don't work" means both are broken,
   when the other was simply never wired up.
8. **Closing** — a short checklist, and a link to the checker for
   anyone who'd rather automate the cross-check than do it by hand.

**Draft intro (roughly 150 words):**
```
If you've wired up iOS Universal Links or Android App Links in an
Expo app, there's a good chance you've hit the moment where tapping
your own https:// link just opens a browser tab instead of your app —
or it works on one platform and not the other, or it worked in
TestFlight and stopped once real Play Store users installed it. It
reads like a deep, platform-specific mystery, but in practice it's
almost always one of a small number of configuration mismatches split
across app.json, a JSON file hosted on your own domain, and whatever
your last build actually shipped.

After running into (and fixing) the same five root causes enough times
across my own projects and other people's GitHub issues, I started
keeping a mental checklist. This post is that checklist, roughly in
order of how often each one turns out to be the actual problem —
starting with the one-character difference that trips up almost
everyone at least once: forgetting the "applinks:" prefix.
```
