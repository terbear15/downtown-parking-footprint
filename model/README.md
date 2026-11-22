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
