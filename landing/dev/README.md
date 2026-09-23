# landing/dev — render tests that never deploy

`brush.html` is the sign-in brush (public/trails.js) on its own. `shot.mjs` opens a page in the
installed Chrome through Playwright, drags a real finger or mouse across it, and screenshots
mid-swipe and after release, printing the page's console.

```
cd landing && npx serve -l 8765 .          # serves /dev and /public
cd dev && npm i playwright && node shot.mjs http://127.0.0.1:8765/dev/brush.html out.png touch
```

This is how the 300×150 canvas bug was found on 2026-09-13: OGL writes its own inline size on the
canvas, so the module now sizes from the parent box. Look at the screenshot before shipping a
visual change.

`accounts-shot.mjs` renders the signed-in Accounts sheet (Claude / ChatGPT rows) with GitHub
stubbed in the page, so nothing is signed in for real: `node accounts-shot.mjs out.png` writes
`out-home.png` and `out.png`.
