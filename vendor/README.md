# Vendored third-party code

| File | Package | Version | License | Source | SHA-256 |
|---|---|---|---|---|---|
| `compromise-two.mjs` | [compromise](https://github.com/spencermountain/compromise) | 14.17.0 | MIT (`compromise-LICENSE`) | `builds/two/compromise-two.mjs` from the npm tarball (`sha512-zw9iEcts/8tMDASNopMQEs3Pclkx2Xk7XCltAb/oV1LEZcCQpDaalAtFmvuxYo+wnVDsW3H3oT16mw9qVHpkqA==`) | `c24b82cf3cf15dbd3256cd05165db619317861d5d1d9d2045e3c2867c3d539df` |

- The file is unmodified, self-contained (no imports), and contains no `eval`, `new Function`, or network calls.
- It is loaded only by the service worker through `word-type.js`, never injected into pages.
- The `two` build is the smallest build with the part-of-speech tagger (295 KB). The `three` build (358 KB) tagged the Task 5.3 fixtures identically.

Update procedure: `npm pack compromise@<version>`, copy `package/builds/two/compromise-two.mjs` and `package/LICENSE`, update this table, then run `make test`.
