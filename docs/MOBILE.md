# Mobile and low-end devices

Measured, not asserted. Re-runnable with the script described at the bottom.

The sender application is the part that matters here: a Nigerian student in
Moscow sending money home is on a phone, often on mobile data, and often on a
device that costs less than the transfer. The back office is a desk tool and is
built for a desk.

## Results, 2026-08-14

Five device profiles × four signed-in screens, twenty combinations.

| Check                                           | Result             |
| ----------------------------------------------- | ------------------ |
| Horizontal overflow (the page scrolls sideways) | **0 of 20**        |
| Inputs below 16px (iOS zooms on focus)          | **0**              |
| Text below 12px                                 | **0**              |
| Tap targets below 44px (WCAG 2.5.5)             | **1**, since fixed |

Profiles: 360×740 (Galaxy A-series, Tecno, Infinix — the common devices in
Lagos and Accra), 375×667 (iPhone SE), 390×844 (iPhone 14), 412×915 (Pixel 7),
and 320×568 as the floor.

The single failure was the header logo: 133×31 px, so 13 px short on height. It
is a link home, so a mis-tap costs a tap rather than money — but 44 px is the
floor for a reason, and it was the only element in the sender app below it. Now
`min-height: 44px`, which adds hit area rather than visible padding.

### On a slow connection

Throttled to 400 kbps with 400 ms latency and a 4× CPU slowdown — a realistic
low-end phone on patchy mobile data rather than an office wi-fi number:

| Measure                | Result     |
| ---------------------- | ---------- |
| First contentful paint | **1.17 s** |
| DOM content loaded     | 1.17 s     |
| Network idle           | 4.9 s      |
| Total transferred      | **125 KB** |

125 KB for a signed-in application is the number that makes the rest work. It
is small because the design system is hand-written CSS with no component
library, the fonts are the system stack rather than a webfont download, and the
icons are inline SVG.

## What is deliberately built for this

- **Mobile-first, not mobile-adapted.** The sender app was laid out at 360 px
  and allowed to grow. Nothing is a desktop screen squeezed down.
- **A PWA, installable to the home screen**, with an offline shell — so a dead
  signal shows the application rather than the browser's dinosaur. Needs HTTPS:
  on plain HTTP the service worker does not register at all, which is why the
  demonstration server should move to a certificate before it is judged on this
  (`docs/DEPLOY_SERVER.md`).
- **System fonts.** No webfont, so no invisible text while a font downloads,
  and nothing to fetch on a slow connection.
- **Bottom navigation.** Reachable one-handed on a tall phone, where a top nav
  is not.
- **`tabular-nums` on every amount**, so digits do not shift as a quote
  refreshes.
- **A 90-second rate lock with a visible countdown**, which matters more on a
  slow connection than a fast one: the sender can see they have time.

## What is not done, and would be before a pilot

- **Real-device testing.** Everything above is an emulated viewport in
  Chromium. Emulation does not reproduce Safari's viewport quirks, Samsung
  Internet, or how a two-year-old budget Android actually feels. A handful of
  real handsets, once.
- **Landscape and large text.** Untested at 200% browser text size, which is an
  accessibility requirement and a real usage pattern for older senders.
- **Offline behaviour under test.** The service worker exists and the shell is
  cached, but "put the phone in airplane mode halfway through a transfer" is
  not yet an automated test.
- **Screen-reader passes.** Semantics and `aria-hidden` are in place and the
  automated checks are clean, but nobody has driven the app with VoiceOver or
  TalkBack.

## Before Android and iOS apps

The honest position: **native apps should wait**, and not because they are
hard.

An installed PWA already gives the home-screen icon, the standalone window and
the offline shell. What it does not give is push notifications on iOS below
16.4, biometric login, and an App Store presence — and of those, only the store
presence is likely to matter commercially before there is a live corridor.

The reason to wait is not effort, it is the review process. Both stores treat
money transmission as a regulated category: they ask for the operating
licence, the entity behind it, and evidence of the partner relationships. That
is blockers B1 through B3, the same ones holding up the live corridor. An app
submitted before those exist is rejected, and a rejection is on the record.

When the time comes, the sensible order is: confirm the PWA is what people
actually complain about, then wrap it (Capacitor) rather than rewrite it, and
only build native if something specific demands it. Every screen, every
translation and every piece of money arithmetic is already shared — the API is
the product, and the front end is one of several possible clients.

## Re-running this

`infra/scripts/` has no audit script yet; the one used here lived in a
scratchpad. Turning it into a committed script belongs with the real-device
testing above, so that both land as one piece of work rather than a number
nobody can reproduce.
