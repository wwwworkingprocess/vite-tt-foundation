# Canonical population fields v1 — provenance and integrity

## Common source

The three canonical fields derive from the European Commission Joint Research
Centre and Eurostat JRC-ESTAT Census Population Grid 2021, total resident
population, native 100 m resolution, ETRS89 / LAEA Europe (EPSG:3035).

- DOI: `10.2905/98336641-fd1c-4992-8c7b-c470dd5eb81e`
- Source filename: `JRC-ESTAT_Census_Population_2021_100m_rev0726.tif`
- Source SHA-256: `0e4e072b2f2f5040a55f485ee2be756a021b5c305a22c576db28ae8fd20a524e`
- Accepted source licence: CC BY 4.0

The source GeoTIFF is not committed. Canonical JSON is the game-oriented
derived authority. The field is an estimated spatial disaggregation and must
not be presented as address-level measured census truth.

## City integrity

| City       | Identity                   |    Grid | Canonical grid SHA-256                                             | Historical Round-4 crop SHA-256                                    | Reviewed expanded-window hash                                      | Current reconciled operational crop SHA-256                        |
| ---------- | -------------------------- | ------: | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Torrevieja | `Q36730` / `es-torrevieja` |   91×96 | `c507d7f3a11bde457118ccba329285d49550a0c8959c6865c15b3ec7e12ddd3c` | `79fdafb190fc29b130f99fd2b9570a8e093f01dbcffb79b70eced190aa8a8a18` | `00fc9e4b85706db9f27d4418af5040931580d3a46f8352ecddf0f4ea9b05eeb0` | `a331f90a017496529f4453fac886be3b5eec9a62069c4bc9c4f637e10786eab4` |
| Elche      | `Q10509` / `es-elche`      | 187×259 | `b125ee476aff0d27fdfc8a422466b47a87f6e9626a5ff1ffc04a1a0fe8ded3fb` | `356df3269a7e557334f1e8814c0ef72d625052cd1360f0acf45f0ca011e842c5` | `56a12286494969b3b36d44175be33364133ad8bafde2eb0063ea3389548cab5b` | `dc81cc47fc4a4835f5393bead8c632d5681d7ddcf5f2d9c13e8fdff8e688191a` |
| Alicante   | `Q11959` / `es-alicante`   | 113×209 | `cbe2068d3bf4a97bcf062b995ad5cd4d2c23bbf1957abf96d07db72419cfa3fb` | `2587608609dfb80e1afcab6f28508c7d574e60ddda16ec7e9f5f0e2b0730ef5b` | `bad6be640d18442d347be1ddcc80a94d7b200a1e488ed7e55b7a20240e54e04a` | `34f681562a8c721871ef3fe571d35dc24a7473dfc984b23054ad6977ec40e8ee` |

The historical hashes preserve the accepted Round-4 evidence. The expanded
window hashes preserve the architect-reviewed crop bytes before current-status
metadata reconciliation. The current hashes identify the same crop windows
with truthful operational status metadata. Former Elche/Alicante
insufficiencies were resolved by expanding operational crops; scenario
viewports remained unchanged. All supported scenarios now have zero remaining
operational catchment insufficiency.

## Freeze rule

Canonical matrices are byte-frozen. Operational crop metadata may be
deterministically regenerated when route-used catchment requirements expand.
Any reviewed regeneration updates crop, catalogue, public checksum, and root
preparation checksum records without modifying population weights.

Benidorm remains intentionally absent and can later adopt the same generic
contract without a production special case.
