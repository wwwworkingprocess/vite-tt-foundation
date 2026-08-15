# Canonical population fields v1 — provenance and integrity

## Common source

The seven canonical fields derive from the European Commission Joint Research
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

| City       | Identity                   |     Grid | Canonical grid SHA-256                                             | Historical Round-4 crop SHA-256                                    | Reviewed expanded-window hash                                      | Current reconciled operational crop SHA-256                        |
| ---------- | -------------------------- | -------: | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Torrevieja | `Q36730` / `es-torrevieja` |    91×96 | `c507d7f3a11bde457118ccba329285d49550a0c8959c6865c15b3ec7e12ddd3c` | `79fdafb190fc29b130f99fd2b9570a8e093f01dbcffb79b70eced190aa8a8a18` | `00fc9e4b85706db9f27d4418af5040931580d3a46f8352ecddf0f4ea9b05eeb0` | `a331f90a017496529f4453fac886be3b5eec9a62069c4bc9c4f637e10786eab4` |
| Elche      | `Q10509` / `es-elche`      |  187×259 | `b125ee476aff0d27fdfc8a422466b47a87f6e9626a5ff1ffc04a1a0fe8ded3fb` | `356df3269a7e557334f1e8814c0ef72d625052cd1360f0acf45f0ca011e842c5` | `56a12286494969b3b36d44175be33364133ad8bafde2eb0063ea3389548cab5b` | `dc81cc47fc4a4835f5393bead8c632d5681d7ddcf5f2d9c13e8fdff8e688191a` |
| Alicante   | `Q11959` / `es-alicante`   |  113×209 | `cbe2068d3bf4a97bcf062b995ad5cd4d2c23bbf1957abf96d07db72419cfa3fb` | `2587608609dfb80e1afcab6f28508c7d574e60ddda16ec7e9f5f0e2b0730ef5b` | `bad6be640d18442d347be1ddcc80a94d7b200a1e488ed7e55b7a20240e54e04a` | `34f681562a8c721871ef3fe571d35dc24a7473dfc984b23054ad6977ec40e8ee` |
| Benidorm   | `Q487981` / `es-benidorm`  |  176×198 | `712deed4b637ce07f2fec16728e8406dd93e53828348627246a4896653fe048f` | `73b88866ec7153f5155e323f6cc997028a7d7fce3e27c2315f6b2a4a7a060d37` | `1d9f19c37a6629c709351d1d443a90accab909d06af963888c8f2968863c8697` | `2380bc5e9b0e63c0da4c116efc675f991864fcffb6bfbd0a4e01aa65a4220132` |
| Cartagena  | `Q162615` / `es-cartagena` | 323×1052 | `a471e2011c8d9379d9f8df8965c5c256a9d57707a196e0e7cb160152685a315d` | `8d6ef7a9ad9eb28f2e2b18716fccd22d974e985df2543154e53d74504f9fbd8b` | `8d8fa0777ad864198c0e7f5e9f38e89fd005f4d9fa3258e3c2328c5325d26655` | `c067f695c77d365665509fadb04c6f1277b71432d12b9254c4fe9bba77383e43` |
| Murcia     | `Q12225` / `es-murcia`     |    61×80 | `362f8a046979585724a3cfd79093911b03248be9ba5860d935fa1c87216747bf` | `ad59d42c4c6aab89490a1f7601bf39c1e8311b2db4ddfe62e481d60655697f40` | `257a3f034fb5a2f2bfeb6056c25608ca2e12c65de67b1f6eb3d46713373ed649` | `8b68f10806657781f124d33606e4cb82f3055429ca1ee98cf2baaf1afac09e23` |
| Málaga     | `Q8851` / `es-malaga`      |  160×291 | `23e6ff1c758823c36e23865f39ac7f18f5a3dd2e990eb5fe8af1639c180b487b` | `ba1354aaa18327091b26b98069e44dac009bb74c4711f47b6c1cf3383d89fa04` | `62f69c3d619618138317f14d565b56bb706bead6c29689aad07f7533555fc052` | `522ddf3fb637eebe1a888160fb158c5ee3bc5773c0b40ee9924a519de826b83e` |

The historical hashes preserve the accepted Round-4 evidence. The expanded
window hashes preserve the architect-reviewed crop bytes before current-status
metadata reconciliation. The current hashes identify the same crop windows
with truthful operational status metadata. Former Elche/Alicante insufficiencies were resolved by expanding operational
crops. Benidorm preparation crops were already route-used StopPlace-anchor safe;
11 of its 12 operational crops were widened only where the shared five-cell
catchment policy required additional canonical cells. The same operational
catchment reconciliation widens 3 of 11 Cartagena crops, 6 of 7 Murcia crops,
and 8 of 21 Málaga crops; all other new-city crop windows remain unchanged.
Scenario viewports remain unchanged. All supported scenarios now have zero
remaining operational catchment insufficiency.

## Freeze rule

Canonical matrices are byte-frozen. Operational crop metadata may be
deterministically regenerated when route-used catchment requirements expand.
Any reviewed regeneration updates crop, catalogue, public checksum, and root
preparation checksum records without modifying population weights.

All seven cities use the same generic settlement-driven population contract,
with no city-specific production special case.
