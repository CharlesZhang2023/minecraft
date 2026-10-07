# Packs

Resource packs (textures) and shader packs (how the world is lit and finished) for the game. Like mods, they live
here, are built into a static pack repository (`packs/index.json` plus one file per pack version, named after its
hash), and are downloaded by players from **Options > Resource Packs...** / **Shaders...**, checked against their
SHA-256 and kept in the browser. Players can also add a pack from a file. Packs only change how one player's game
looks: nothing about them is sent to other players, and the server never runs anything for them.

| Pack | Kind | |
|---|---|---|
| `vibrant` | shader | Warm sunlight and soft shadows, swaying plants, glossy water with reflections, god rays, bloom. In the spirit of Sildur's Vibrant Shaders. |
| `iteration` | shader | A physically based sky, volumetric clouds and light shafts, contact-hardening shadows, ambient occlusion, wet ground and ripples in the rain, temporal anti-aliasing. In the spirit of iterationT. |
| `pastoral` | resource | Pastoral Beta 1.5.3 by 花籃. Someone else's work: its zip is not in git (see below). |

Both shader packs were written for this game's renderer; they don't contain code from the packs they're modelled
on (OptiFine/Iris shader packs are GLSL for a different pipeline, and their licences don't allow redistribution).

## Adding a pack to the repository

A folder with a `pack.json`:

```json
{ "id": "mypack", "kind": "resource", "version": "1.0.0", "name": "My Pack", "description": "...",
  "authors": ["me"], "credit": "where it's from", "zip": "mypack.zip", "iconFile": "icon.png" }
```

- **Resource packs**: `zip` names a Java Edition resource pack zip in the folder, or leave `zip` out and put the
  pack's own `pack.mcmeta` and `assets/` in the folder (they're zipped at build time). A small `pack.png` (or
  `iconFile`) next to `pack.json` becomes the icon in the list.
- **Packs made by other people**: zips in `packs/*/` are git-ignored. A folder whose zip is missing is left out of the
  build with a warning, so the repository builds anywhere; put the zip there on the machine that deploys. Check the
  author's terms before publishing someone's pack on a public site.
- **Shader packs**: `"kind": "shader"` and the folder's `.wgsl` files (see below).

`npm run dev` serves the repository live from the folders; `npm run build` writes it to `dist/packs/`.

## Resource packs

The Java Edition layout (`assets/minecraft/textures/...`, with or without a top folder in the zip). Used from it:

- **Block textures** (`textures/block/`, or the 1.12 `textures/blocks/` names), matched to the game's textures by
  name (`src/packs/names.ts` lists the ones with other names). Grass sides get their grey overlay (tinted by the
  biome, as in the game); grey water is given vanilla's blue.
- **Item textures** (`textures/item/`), **particles** (`textures/particle/`), the **sun** and the **moon's phases**
  (`textures/environment/`). Mods' textures can be replaced too: `assets/<mod id>/textures/block/<name>.png`.
- **Animations**: a strip of frames with its `.mcmeta` (`frametime`, `frames` with per-frame times).
- **Any resolution**: the texture atlas takes the size of the biggest texture used (up to 128x128), the rest scaled
  up to it. Everything that wants 16x16 (GUI icons, dropped items' 3D shapes) gets a scaled copy.
- Several packs stack: the first in the list wins for each texture.

Not used: block models and blockstates (the game's blocks have their own shapes), random texture variants,
OptiFine connected textures and CEM models, mob and entity textures, sounds, fonts and GUI textures.

## Shader packs

A shader pack is WGSL for the WebGPU renderer (with WebGL 2 the game says it needs WebGPU). The game draws the world
as usual, but through the pack's functions and into an HDR picture; then the pack's full-screen passes make the
final picture. A shadow map from the sun or moon is drawn first when the pack asks for one.

### pack.json

```json
{
  "id": "mypack", "kind": "shader", "version": "1.0.0", "name": "My Shaders",
  "settings": [
    { "id": "SHADOWS", "name": "Shadows", "type": "bool", "default": true },
    { "id": "SHADOW_RES", "name": "Shadow Quality", "type": "enum", "options": [1024, 2048, 4096], "labels": ["Low", "Medium", "High"], "default": 2048 },
    { "id": "BLOOM_STRENGTH", "name": "Bloom", "type": "number", "min": 0, "max": 2, "step": 0.1, "default": 0.6, "description": "shown as a tooltip" }
  ],
  "shadow": { "enabled": "SHADOWS", "resolution": "SHADOW_RES", "distance": 112 },
  "common": ["common.wgsl"],
  "gbuffers": "gbuffers.wgsl",
  "passes": [
    { "name": "bright", "file": "bright.wgsl", "inputs": ["scene"], "scale": 0.5, "enabled": "BLOOM" },
    { "name": "taa", "file": "taa.wgsl", "inputs": ["scene", "taaPrev"], "history": true }
  ],
  "final": "final.wgsl",
  "vanillaClouds": true,
  "vanillaSun": true,
  "jitter": false
}
```

- **settings** become WGSL constants in every program (`const SHADOWS: bool`, numbers and enums as `f32`), shown on
  the pack's settings screen; changing one compiles the pack again. Ids are upper-case WGSL identifiers. Anywhere a
  value is expected (`shadow`, `enabled`, `vanillaClouds`, `vanillaSun`, `jitter`), a setting's id can stand in.
- **shadow**: the shadow map (`resolution` in texels, `distance` in blocks around the camera).
- **common** files go into every program; **gbuffers** into the world's shaders only.
- **passes** run in order after the world is drawn. Each writes an HDR texture named after it, at `scale` of the
  screen, and reads its `inputs`: `scene` (the world), earlier passes, and `<name>Prev` (last frame's output of a pass
  with `history: true`). A pass turned off by `enabled` stands in for its first input.
- **final** draws onto the screen and reads whichever of `scene` / passes / histories its code names.
- **vanillaClouds** / **vanillaSun**: whether the game still draws its own clouds and square sun.
- **jitter**: shift the view a fraction of a pixel each frame (`F.jitter`), for temporal anti-aliasing in a pass.

Mistakes are reported as the pack's own file and line when it's turned on, and the game keeps its own look.

### The world's functions (gbuffers)

```wgsl
fn packShade(s: Surface) -> vec3f          // required: the lit colour of a surface (before fog)
fn packWave(p: vec3f, flags: u32, top: f32) -> vec3f  // move vertices (camera-relative) of chunks: swaying plants
fn packTranslucent(s: Surface) -> vec4f    // water, glass, ice: colour and alpha (default: packShade, s.alpha)
fn packSky(d: vec3f) -> vec3f              // the sky in direction d (default: the game's sky and stars)
fn packFog(c: vec3f, s: Surface) -> vec3f  // fog over a surface (default: the game's fog)
```

`Surface` has `albedo` (texture times tint), `alpha`, `pos` (camera-relative; view space for the hand), `normal`,
`light` (sky and block light, 0..15), `shade` (the game's ambient occlusion and face shading), `layer`, `flags`
(`MAT_LEAVES`, `MAT_PLANT`, `MAT_WATER`, `MAT_LAVA`, `MAT_EMISSIVE`, `MAT_GLASS`, `MAT_ICE`, `MAT_METAL`, `MAT_SNOW`,
`MAT_GEM`, `MAT_PARTICLE`), `kind` (`KIND_TERRAIN`, `KIND_DYN`, `KIND_ENTITY`, `KIND_HAND`, `KIND_LOD`), `screen`
(0..1 from the top left), `uv` and `depth`. For packWave, `top` is 1 at the top of a texture (the tips of plants).

The world's shaders draw into an HDR texture, so values above 1 are fine (bloom them). The sky must leave alpha 0
(it does with the default sky pass): passes tell sky from world by `sceneTex.a < 0.5`. Distant terrain is drawn with
its own depth, which is then cleared, so it reads as alpha 1 at depth 1 ("far away").

Water and glass are drawn after everything solid: they can read `opaqueColor` and `opaqueDepth` (the world behind
them) for refraction and screen-space reflections.

### What every program can use

- `F`, the frame (see `FRAME_STRUCT` in `src/render/gpupack.ts`): `viewProj`, `invViewProj`, `proj`, `invProj`,
  `view`, `prevViewProj` (last frame's, for `pos + camDelta`), `shadowMat`, `sunDir`, `moonDir`, `lightDir` (sun by
  day, moon by night), `lightStrength`, `daylight`, `time` (seconds), `ticks`, `rain`, `thunder`, `camPos` (world
  position, wrapping every 8192 blocks), `camDelta`, `eyeInWater` (1 water, 2 lava), `dimension` (0 overworld,
  1 Nether, 2 End), `skyColor`, `fogColor`, `voidColor`, `sunrise`, `stars`, `fogStart`, `fogEnd`, `screen`
  (width, height, 1/width, 1/height), `near`, `far`, `jitter`, `frame`, `shadowOn`, `shadowDist`, `shadowRes`,
  `sunBright`, `nightVision`, `gamma`, `celestial`, `moonPhase`, `ambient`, `ambientCol`, `skyLightCol`, `flicker`.
- Textures: `shadowMap` with `shadowCmp`, `noiseTex` (256x256 random, wrapping), `noise3D` (64^3 cloud noise:
  Perlin-Worley and three Worley octaves), `materials`; samplers `linearSamp`, `repeatSamp`; in passes also
  `nearestSamp`, `depthTex`, `depthOpaque`, and each input as `<name>Tex` or `input0`, `input1`...
- Functions: `shadowAt(pos, normal, radius)`, `shadowCoord`, `distortShadow`, `shadowBlocker`; `toScreen(pos)`,
  `fromScreen(uv, depth)`, `linearDepth`, `worldPos`, `faceNormal`; `noise2`, `noise2v`, `noise3`, `noiseFbm`,
  `noiseHash12`, `noiseHash13`, `noiseIGN` (per-pixel dither); `vanillaLight(sky, block)`, `vanillaFog`,
  `vanillaFogAmount`, `vanillaSky`, `vanillaStars`; `luma`, `material(layer)`; constants `PI`, `EMISSIVE_BOOST`.
  Passes also get `sceneDepth(uv)`, `opaqueDepthAt(uv)`, the full-screen vertex shader `vs` and `PassIn` (`pos`,
  `uv`); a pass's fragment entry is `@fragment fn fs(i: PassIn) -> @location(0) vec4f`.

Names the game uses in its own shaders (`S`, `D`, `tex`, `samp`, `skin`, `mask`, `endSky`, `In`, `V`, `vs`, `fs`,
`vsShadow`, `fsShadow`, `chunkPos`, `lightmap`, `applyFog`, `fogAmount`, `ltable`, `clipZ`, `starHash`) and the
library's names above can't be used for a pack's own functions.
