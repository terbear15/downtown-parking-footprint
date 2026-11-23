# Final model

`model.json` + `weights.bin` (TensorFlow.js). See `metrics.json` for the evaluation and the full review history.

```js
const model = await tf.loadLayersModel('https://terbear15.github.io/downtown-parking-footprint/model/final/model.json');
// input: [n, 224, 224, 3] RGB scaled to [-1, 1]; output: [n, 224, 224, 1] parking probability
```

Post-processing and the outline fitting used in the project are in `docs/review/pipeline.js` (set `window.AI = { FINAL: true }` before loading it).
