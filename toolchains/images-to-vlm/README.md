# images-to-vlm

Planned input: one `multiview-images` manifest per OSM `full_id`, referencing `front.png`, `oblique.png`, and `top.png`.

Planned output:

```text
artifacts/predictions/<dataset>/<full_id>/result.json
```

`result.json` is a structured artifact whose current classification payload is a single non-empty `roofType` string. The view discovery and result-writing boundaries are present; vLLM request construction, prompting, and response parsing are intentionally not implemented yet.
