# Usage and cost invariants

Read before editing `src/lib/pricing.ts`, `session_model_usage`, or any token/cost aggregation or display; treat every rule below as an invariant.

- Persist per-model token usage in `session_model_usage`; never persist derived dollar costs.
- Derive costs at read time. Provider-reported row cost wins over the dated pricing table; new pricing entries require an effective date and source URL.
- A cost is available only when every contributing usage row is priced; otherwise report it as unavailable and exclude it from dollar aggregates.
- A session detail/list cost rolls up its complete subagent subtree. Overall totals count each stored session once so subagents are not double-counted.
- Per-session outlier rankings credit a subtree to its topmost in-window ancestor and must still sum to the same weekly total.
- Cache-savings estimates require table pricing even when the provider reports actual cost, because the counterfactual cache rates still need to be derived.
- Choose the representative model by token dominance, preserving the existing zero-usage fallback.
- `normalizeModel` may strip routing and dated snapshot prefixes/suffixes, but must preserve real source prefixes such as `z-ai/`; those are distinct deployable sources with distinct pricing.
