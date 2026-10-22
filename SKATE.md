# SKATE editorial page

Public route: `/#skate`. Accessible from the storefront header, side menu and footer. The page is available without login and does not request the product catalog.

## Content

Curated film metadata lives in `public/skate.js`. `skateFeatured` holds the two hand-picked films; `skateArchive` holds six official-channel entries, with three visible initially. Adding a film requires its real YouTube video ID, verified title, source and optional year/category. No API credentials are needed. The page does not automatically synchronize future channel uploads.

Primary sources checked 2026-10-22:

- Luis Viloria - Welcome to EDG, DogwayMagazine: https://www.youtube.com/watch?v=5cABW1VGMCE (published 2024-11-21; original description names filmmaker Luis Beltran).
- EDG - Jorge dos Santos, Black Media Skate: https://www.youtube.com/watch?v=KDz0vLjBz_4 (published 2024-12-21; original description identifies the Barcelona origin, Curitiba roots and Florianópolis presence).
- Official channel: https://www.youtube.com/@EDGSKATEBOARDS
- Official channel feed: https://www.youtube.com/feeds/videos.xml?channel_id=UCbOGETlAsBkn37kzVoiCM9Q
- EDG Tour Santa Catarina 2025: https://www.youtube.com/watch?v=d3qRBNEysBw (published 2025-04-25; description identifies Balneário Camboriú, Florianópolis and Criciúma).

Founding year, founders, complete chronology and full current team roster have not been supplied. The page uses the verified short history and the two featured rider presentations, without inventing missing milestones or roster members. Historical photos can replace the existing EDG imagery once supplied.

Player documentation: https://developers.google.com/youtube/player_parameters and https://support.google.com/youtube/answer/171780

## Playback and navigation

Poster thumbnails load from `i.ytimg.com`. YouTube iframes are only created on user interaction, using `youtube-nocookie.com`, inline playback and visible controls. Opening another film destroys the previous player, and route navigation removes the current player. Direct YouTube links remain available if embedding is disabled by its uploader or the service is unavailable. A native dialog provides keyboard focus containment, Escape dismissal and focus return for the side menu.

Both local Node responses and the Cloudflare Worker allow only the thumbnail host and the YouTube embed host in their respective CSP directives. `strict-origin-when-cross-origin` provides the origin Referer required by embedded YouTube players. No external player JavaScript runs in the top-level page.

Validation: `npm run check`, `node --check public/skate.js`, `npm test`, browser tests in `test/browser/skate.spec.mjs`, existing header/navigation tests, and `npm run test:cloudflare`. Browser tests stub external media; real YouTube playback still depends on the network, regional availability and uploader embedding settings.
