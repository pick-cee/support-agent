# RelayPay logo: where it came from

The logo lives only in the Logo section of the brand direction Google Doc
(`1el_ITia1CTuPED_T_8D4LghXiIy65ZuekGelZK1WPAs`). The repo copy of that doc,
`assets/brand-direction.md`, has no image.

Extracted on 2026-09-29 from the doc's public zip export:

```
https://docs.google.com/document/d/1el_ITia1CTuPED_T_8D4LghXiIy65ZuekGelZK1WPAs/export?format=zip
```

The zip holds one image, `images/image1.png`.

## Files

- `docs/brand/relaypay-logo-original.png` is the doc's image, byte for byte.
  - 1536 x 1024 RGBA
  - sha256 `9ce4d24e0050c58120a8a1be83fc22bdc956f4148c6500e051b821346a444d8c`
  - About 97% of its pixels are fully transparent. Viewers that ignore
    alpha show a dark vignette with a glow around the mark. That is hidden
    colour data under the transparency, not part of the logo.
- `public/brand/relaypay-logo.png` is what the page uses. It is the original
  cropped to the pixels with alpha above 8, plus an 8 px transparent margin.
  - Crop box `(289, 394, 1129, 591)`, giving 840 x 197
  - No pixel was recoloured, scaled or filtered. The brand doc allows "basic
    sizing and spacing" and nothing more.
- `src/app/icon.png` is the browser tab icon: the logo's mark alone, the left
  196 px of `public/brand/relaypay-logo.png`, centred in a 197 x 197
  transparent square. Cropped, not redrawn or recoloured (2026-09-30).

## Colours sampled from the logo

Taken from fully opaque pixels only, grouped into flat fills. Percentages are
shares of the opaque pixels.

| Role in the brand doc    | Hex       | Where it is in the logo | Share |
| ------------------------ | --------- | ----------------------- | ----- |
| Primary, deep blue       | `#0F347B` | "RelayPay" wordmark     | 52%   |
| Accent, teal blue        | `#00B3E9` | top stroke of the R     | 14%   |
| Not in the brand palette | `#55BE4A` | green chevrons          | 14%   |
| Not in the brand palette | `#125096` | mid-blue triangle       | 3%    |

The brand doc names only deep blue, teal blue and an off-white or light grey
background. The green and the mid blue belong to the mark and are not used
anywhere else in the interface.
