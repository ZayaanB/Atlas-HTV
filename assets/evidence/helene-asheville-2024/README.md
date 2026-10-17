# Dated evidence: Asheville before and after Hurricane Helene

This is a before/after pair of NASA Harmonized Landsat Sentinel-2 (HLS) **L30** surface-reflectance images covering the French Broad River, its confluence with the Swannanoa River, and central Asheville, North Carolina. Machine-readable metadata is in [`metadata.json`](metadata.json), and the database records are `ev-hls-l30-asheville-2024-08-30` and `ev-hls-l30-asheville-2024-10-09` in `atlas.evidence`.

| | Before | After |
| --- | --- | --- |
| File | `hls-l30-2024-08-30-before.png` | `hls-l30-2024-10-09-after.png` |
| Acquired (UTC) | 2024-08-30 16:05:34–16:05:58 | 2024-10-09 16:05:41–16:06:04 |
| Platform | Landsat 8 OLI | Landsat 9 OLI |
| Granule | HLS.L30.T17SLV.2024243T160534.v2.0 | HLS.L30.T17SLV.2024283T160541.v2.0 |
| Days from crest (2024-09-27) | 28 days before | 12 days after |
| Granule cloud cover | 17% (crop is clear) | 0% |

The acquisition times come from the NASA CMR granule records (`SENSING_TIME` / `RangeDateTime`), not from download dates.

## Why this comparison is suitable

- **Same grid.** Both images are HLS L30 v2.0 on MGRS tile 17SLV at 30 m resolution: the same product, the same sensor family (Landsat OLI), and the same reflectance processing.
- **Same request.** Both were requested with the same WMS bounding box and pixel size: 604 × 592 px, about 15 m per display pixel, resampled from 30 m data.
- **Measured alignment.** Phase correlation of the two images' gradients gives a 0-pixel offset, with a peak of 0.71 against 0.07 for the next candidate.
- **Usable sky.** Both crops are cloud-free apart from a few specks.

The candidates that were rejected were cloudier or less comparable. On 2024-10-02 (Sentinel-2, used by NASA Earth Observatory) the tile was 40% cloudy with heavy cumulus over the crop. 2024-10-07 (Sentinel-2, S30) was usable, but it is a cross-sensor pair.

## Placement (for Person 2)

- `bounds`: `[-82.62, 35.54, -82.52, 35.62]`, as west, south, east, north.
- Mapbox `image` source `coordinates`: `[[-82.62, 35.62], [-82.52, 35.62], [-82.52, 35.54], [-82.62, 35.54]]` (top-left, top-right, bottom-right, bottom-left).
- The PNG is in EPSG:4326 (equal-angle rows). Rendering it by its four corners in Web Mercator misplaces it by at most 1.1 m on the ground at this latitude and extent, which is negligible against 30 m pixels.
- Serving: Caddy exposes `assets/evidence/` at `/evidence/`. These files are therefore at `/evidence/helene-asheville-2024/<file>`; see `infra/Caddyfile`. Person 1 may bundle them instead, as long as the paths stay stable.

## Legend

- **Green:** vegetation.
- **Grey or white:** roads, roofs and paved areas. Small white specks can also be cloud.
- **Dark green-brown ribbon:** the river channel.
- **Tan or light brown along the river corridors (after image only):** bare sediment or scoured ground that was not present on August 30. It is most visible along the French Broad north of the confluence, along the Swannanoa east of it, and on the floodplain fields to the south-west.
- **Transparent:** masked or no-data pixels (0.03% before, 0.10% after).

Rendering is the GIBS default for the `HLS_L30_Nadir_BRDF_Adjusted_Reflectance` layer and looks natural-colour. The GIBS layer metadata endpoint does not state the band combination, so the UI should not name spectral bands.

## Required attribution text

> NASA LP DAAC HLS L30 v2.0 (doi:10.5067/HLS/HLSL30.002); Landsat 8 and Landsat 9 courtesy of NASA/USGS; imagery via NASA GIBS.

The license is CC0 under the [NASA EOSDIS data use guidance](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance): there are no restrictions, but citation is requested.

## Limitations: what this imagery cannot show

- **Not the peak.** The after image was taken 12 days after the crest. It shows deposits and scoured ground left behind, not the maximum flood extent.
- **No building detail.** At about 30 m resolution it cannot show water depth, damage to individual buildings, or which building is which. There is no building or parcel recognition, and nothing about ownership.
- **No damage estimate.** Colour change alone does not quantify damage or economic loss, and it does not say who was affected.
- **Not the basemap.** This is a dated NASA observation and is independent of the Mapbox satellite basemap. A basemap screenshot must never be presented in its place.
