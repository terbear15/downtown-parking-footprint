# Parking-lot segmentation model

U-Net with a MobileNet v1 (0.25, ImageNet-pretrained) encoder, trained in the browser with TensorFlow.js.

- **Input:** 224 × 224 RGB NAIP aerial imagery (USDA, via Microsoft Planetary Computer), zoom-17 web tiles (~1.4 m pixels).
- **Labels:** OpenStreetMap surface parking polygons rasterised onto each tile (noisy: unmapped lots count as background).
- **Training:** 897 tiles from 16 cities; 7 epochs with the encoder frozen, then 10 epochs fine-tuning everything; loss = binary cross-entropy + Dice; flips/transposes and brightness jitter.
- **Spatial hold-out test:** 160 tiles from Denver, Kansas City, Philadelphia and Seattle, never seen in training.

| Metric (held-out cities) | Model | Asphalt-colour rule |
| --- | --- | --- |
| Pixel IoU | 0.32 | 0.08 |
| Pixel precision | 0.48 | 0.09 |
| Pixel recall | 0.49 | 0.44 |
| Mapped lots ≥ 0.25 acre found (≥ 50% of pixels) | 54% | — |
| Mapped lots ≥ 1 acre found | 70% | — |

Per-city IoU and the training history are in `metrics.json`.

**Use:** run on every downtown tile of the 13 cities flagged for possible OSM under-mapping. Connected areas with probability ≥ 0.5, at least 1,000 m², and less than 30% overlap with mapped lots are proposals (`detections_all.json`, 983). The 467 most confident (at most 45 per city) are in `docs/review/review.json` for human review at `/review/`. Only confirmed lots should ever be added to the measurements.

Load in TensorFlow.js: `tf.loadLayersModel('model.json')` (input scaled to [-1, 1]).

## Round 2 (after human review)

Round 1 review: 467 proposals → 180 yes, 241 no, 46 unsure (precision 43%; 62% at confidence ≥ 0.9). 71 tiles held more than one detection, often pieces of the same lot.

Changes:
- **Training on the answers.** 295 reviewed tiles were added to training: "yes" outlines became positive labels (weight 2), "no" areas became hard negatives (weight 4), "unsure" areas were ignored (weight 0). Reviewed tiles were shown twice per epoch. Weighted BCE + Dice loss, continued from the round-1 weights on the GPU (WebGL, NVIDIA RTX 4070), 12 epochs.
- **City-wide mosaics instead of single tiles.** Predictions for every tile of a downtown are stitched into one probability grid, so a lot that crosses a tile edge becomes one detection.
- **Cleaner shapes.** Morphological opening (2 px) removes specks and road strips; closing (3 px) joins pieces split by trees or cars. Each lot then becomes its minimum-area rotated rectangle when that rectangle is at least 72% filled, otherwise a simplified convex outline.
- **No repeats.** Areas already reviewed, mapped OSM lots and parking structures are excluded; minimum size 1,500 m², minimum mean confidence 0.6.

| Test | Round 1 | Round 2 |
| --- | --- | --- |
| Held-out cities, pixel IoU | 0.32 | 0.32 |
| Held-out cities, pixel precision | 0.48 | 0.63 |
| Held-back reviewed lots: "yes" lots still found | 100%* | 75% |
| Held-back reviewed lots: "no" lots still proposed | 100%* | 22% |
| Share of proposals a reviewer would accept (estimate) | 37% | 67% |

\* Round 1 proposed all of them by construction. The held-back set is 74 reviewed tiles (32 yes, 54 no) never used for training.

Confirmed lots from round 1 (164 after merging pieces, 292 acres) are shown on the site as a separate dashed layer and in the "including AI-found lots" share.
