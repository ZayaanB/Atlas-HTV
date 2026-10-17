# Evidence assets — Person 4

This folder holds licensed, dated evidence imagery and its metadata. Person 2 renders it, the `atlas.evidence` database rows describe it, and Person 3 serves those rows through the investigation API. A Mapbox basemap screenshot is never placed here as dated evidence.

| Folder | Evidence IDs | Content |
| --- | --- | --- |
| [`helene-asheville-2024/`](helene-asheville-2024/README.md) | `ev-hls-l30-asheville-2024-08-30`, `ev-hls-l30-asheville-2024-10-09` | An aligned HLS L30 before/after pair over Asheville, NC (Landsat 8 on 2024-08-30, Landsat 9 on 2024-10-09). |

Each folder contains the image files, a `metadata.json` and a `README.md`. Together they record:

- **Identity:** the evidence ID, the source granule or record URL, and the exact retrieval URL with its UTC retrieval time.
- **When:** the acquisition period.
- **Where and how sharp:** longitude-first bounds, the CRS, and the native and display resolution.
- **How to read it:** a legend, attribution, the license, and limitations, including what the imagery cannot show.
- **Integrity:** a sha256 checksum for each file and the alignment check.

Each image is about 300 KB.
