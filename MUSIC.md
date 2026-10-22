# MÚSICA editorial page

Public route: `/#musica`. Linked from the header, side menu and footer, with the Spanish interface and monochrome editorial styling established by SKATE. The page is available without login or product-catalog requests.

## Content and sources

EDG supplied `EDG PROFILE  Banda(1).pdf` and four album-cover images. The profile is the source for the band's 2010 origin in Barcelona's Raval, founder Rafael / Charlie B, releases in 2012, 2016, 2018, 2020 and 2025, collaborators and past live events. At EDG's request, the displayed discography and timeline omit the 2025 album and show the four releases from 2012 through 2020. This is a history of the band; its founding date is not presented as the founding date of the skateboard brand. Historical festival appearances are not advertised as upcoming shows.

Two user-selected videos were verified using the official YouTube oEmbed endpoint on 2026-10-22:

- https://www.youtube.com/watch?v=rCEez-8asOg — “PRATAS DA CASA - CURADO, EDG & INDIGESTO (Prod. Dj Cia) [CLIPE OFICIAL]”, Gorilla Concept Music.
- https://www.youtube.com/watch?v=LdxB1RLR0lo — “Video Clip APERTA O PLAY OFICIAL. Deds D Charlie B”, EDG SKATEBOARDS.

`public/music.js` contains the editorial copy, `musicHistory`, `musicAlbums` and `musicFeatured`. Video titles are shortened for display; credits remain alongside them. Keep real video IDs and verified destinations when updating entries.

## Artwork

All public media is in `public/music/`. The four displayed covers use the same 600 × 600 format, with no surrounding mockup, picture frame, CSS border, rounding or shadow. The initial four original artworks were extracted from the image embedded in page 1 of the profile, and the 2020 cover was added separately. The unused 2025 asset remains available for rollback; it is a central square crop of the supplied landscape artwork, retaining its title, illustration and EDG logo while removing the outer frame. The originals were not repainted or regenerated.

The black-and-white hero and outdoor performance photo were extracted from the supplied PDF. The hero's native resolution is 768 × 432; a 640 × 360 derivative is also provided. The supporting photograph is 640 × 368. Higher-resolution originals can replace these assets without changing the layout. The two original video posters are local 1280 × 720 WebPs downloaded from YouTube's thumbnail endpoint, avoiding a thumbnail-host dependency on this page.

## Interaction and validation

MÚSICA reuses SKATE's poster, film-card and player helpers with a separate allowlist and action. No player or audio starts before the visitor selects a video. Opening the second film removes the first iframe; leaving the page removes playback. Section links scroll and focus the section heading while preserving the active player and route. Each video also has its own external YouTube link for unavailable or restricted embeds.

The existing YouTube CSP and `strict-origin-when-cross-origin` referrer policy apply. The Node server explicitly serves the new scripts, stylesheet and artwork; Cloudflare serves the same files through its assets binding.

Checks: `npm run check`, `npm test`, `npm run test:cloudflare`, and the MÚSICA, SKATE, header and store-navigation Chromium browser tests. Browser tests isolate external video services and do not establish that real YouTube playback is available in every region or that uploader embed permissions will remain unchanged.
