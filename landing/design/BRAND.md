# Cosmic Labs brand, as used by freeagent

Source of truth: github.com/polats/cosmiclabs.org (`index.html`, `css/cosmiclabs.webflow.css`,
`images/`). Everything below was read from that repo on 2026-09-13; when the site changes, this
file follows it, not the other way round.

## Colour

| Token | Value | Where the site uses it |
| --- | --- | --- |
| Ground | `#d9d6d6` (`--cosmicgreu`) | `body.body-2` background, and the "dark" dither particles |
| Lime | `#baff00` | the shapes in `Bg_website.png`, the bright dither particles, `.link` background tint |
| Cosmic green | `#40ff00` (`--cosmicgreen`) | declared in `:root`; used by Webflow utility rules only. Secondary. Prefer lime for anything visible. |
| Ink | `#000` (`--black`) | all text and links |
| Paper | `#fff` (`--white`) | rare; not on the home page |

Rules: the ground is **gray, never black**. Green is a fill for shapes and particles, never a text
colour and never a glow. Type is black. There is no gradient, shadow, blur or rounded neon anywhere.

## Type

| Role | Face | Size / weight | Case | Notes |
| --- | --- | --- | --- | --- |
| Body (`.cosmicbody`) | Monument Grotesk Bold | 20px / 700, line-height 1.2 (1.5 when right-aligned); `.bigger` 30px | UPPERCASE | `fonts/MonumentGrotesk-Bold.ttf` |
| Link (`.link`) | PP Neue Bit Bold (pixel) | 30px / 700, line-height 0.8 | UPPERCASE | underlined, inline-block, black. `fonts/PPNeueBit-Bold.ttf` |
| Wordmark | pixel type (`asset3.png`, COSMIC✦LABS) | image | UPPERCASE | freeagent sets its own wordmark in PP Neue Bit Bold instead |

Both faces are Pangram Pangram / Dinamo commercial fonts licensed to Cosmic Labs and served from
its site; freeagent serves the same files from its own origin.

## Layout

Corner-anchored blocks on a full-viewport ground, 5% insets, uppercase text, right-aligned on the
right side. Home page: lockup top-right at `10vw` wide; "VENTURE LED BY …" bottom-left; "NOW
BUILDING" list bottom-right; the dither canvas fills the viewport behind. No cards, no boxes, no
buttons: the interactive elements are underlined pixel links.

## Motifs

- **Stars.** `images/allstars.png` (1920×1080, silver 3D stars) is the source for the effect; the
  ✦ in the lockup is the same eight-point star. `starsLockup.png` is three star variants.
- **Background.** `images/bg_website.png` — lime blocks stepping up the right edge, a lime starburst
  bottom-left, a lime leaf top-right, scattered lime pixels. Cover, centred, under everything.
- **Dither.** Everything soft is dithered into pixels (4×4 Bayer matrix, 2px steps).

## The star effect (reused verbatim)

`DitheredPixelEffect` from the site's inline script, now `public/stars.js`. It draws the stars
image to an offscreen canvas at fit size, walks it in 2px steps, keeps a pixel when its luminance
beats the Bayer threshold, and makes it a particle: lime `#baff00` when bright, ground gray `#d9d6d6`
otherwise. Particles float idly (4–8px sine), scatter within 50px of the pointer with the pointer's
velocity mixed in, bounce off the edges, and drift home at `returnSpeed 0.05`. freeagent added only
touch input, a `stop()`, and a manual `start()`; see the `FREEAGENT` markers.

## What freeagent takes and what it does not

- Sign-in screen: full brand — gray ground with `bg_website.png`, the dither stars, "FREEAGENT" in
  PP Neue Bit top-right, "CONTINUE WITH GITHUB" as a `.link` bottom-left, errors in Monument Grotesk.
- Favicons: the Cosmic Labs star icons.
- **No Cosmic Labs lockup and no link to cosmiclabs.org on freeagent pages** (Paul, 2026-09-13).
- App after sign-in: keeps the Bento layout; light scheme takes the brand ground, ink and lime;
  dark scheme keeps the cool dark tiles with lime for Running.
