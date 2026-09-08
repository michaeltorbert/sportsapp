# September 8 controlled CPU investigation

The measured optimization is to reuse the Eastern date formatter during score normalization. It does not establish that production fits the Free-plan CPU allowance, and it does not fix cold homepage rendering.

Grok's native `grok-4.6` high-effort session (runtime `grok-4.6-build`) compared source at `3b7616760e7ff6b589c4769a1769d16c6fbdf250` and `31b4b9eb184b3f1404bad403b3e3560ca8ac18d8`. The score-normalization source was identical. Fixed public ESPN CDN fixtures contained 86 and 99 events, at 1,625,810 and 1,784,633 bytes. The primary endpoint returned 403 during fixture capture. These observations do not establish when upstream behavior first changed.

Local measurements used Node 25.9.0 `process.cpuUsage` (user plus system CPU), five warm samples after warmup, and inspector sampling to identify hot functions. The compiled Worker was imported into Node; these are not production workerd CPU measurements. Local Wrangler homepage measurements were wall time only. Profiler administration and idle samples are not application CPU.

| Controlled comparison | Before median | After median |
| --- | ---: | ---: |
| Format the same 185 event dates | 3.931 ms | 0.084 ms |
| Compiled Worker covered score request | 25.302 ms | 20.0 ms |
| Compiled Worker homepage | 5.094 ms | 5.14 ms |

Every date output in the formatter comparison matched. The production change lazily creates one formatter, preserving the same locale and timezone. Regression coverage checks Eastern midnight in winter and summer, both daylight-saving transitions, the year boundary, and reversed call order. Existing complete-range and alert tests remain required.

The first compiled-module homepage request used 37.831 ms CPU and its first covered score request used 102.472 ms. A single first-in-process observation is not a production cold-start profile. The homepage renders its shell without parsing ESPN scores; its failure is a separate unresolved path. The historical first homepage failure preceded the updater release. Covered-score processing did not show a clear increase between the two source revisions: isolated medians were 12.947 ms (old) and 11.341 ms (current). Adjacent-week coverage adds required work compared with the old fast failure and cannot be removed to reduce CPU.

The remaining work is to compare production CPU and failures for the exact deployed patch, profile cold homepage rendering, and determine whether a static shell or other targeted change is warranted. Successful requests above 10 ms do not prove headroom: Cloudflare documents rollover CPU allowance. No updater attribution, paid-plan change, or complete resolution is established by this experiment.

Raw fixtures and executable measurement scripts were retained outside the release artifact in the coordinated investigation evidence. They are diagnostic tools, not production code or a timing gate; their Node results must not be used as a substitute for live verification.
