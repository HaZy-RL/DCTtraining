# 07 – Open Questions

Defaults are marked with ✅. These are assumed unless decided otherwise.

1. **Website hosting setup.** What hosts the site (static host, VPS/nginx,
   WordPress, Netlify/Vercel/Cloudflare Pages…)? Will the app live at a subpath
   (e.g. `/dct-training/`) or a subdomain?
   It will be a subdomain I believe. I have a site (cloudcody.cc) that's hosted from /cody/antigrav/chorebot/backend going through a cloudflared tunnel. this will go under cloudcody.cc/DCTtraining

2. **2D vs 3D.** Full 3D chassis/rack (more immersive, more art work, heavier) or 2.5D/isometric SVG (faster to build, lighter)?
   Aim for full 3D 

3. **Vendor realism.** Fully generic hardware and BMC, or styled after real
   platforms (Dell iDRAC / HPE iLO / Supermicro / OCP-style hyperscale sleds)?
   ✅ Default: generic, inspired by OCP/hyperscale designs, no trademarks. We'll add vendor-specific versions later

4. **Accounts & progress.** Is browser-local progress enough, or do you want
   logins, cloud saves, leaderboards, or a trainer view (needs a backend)?
   ✅ Default: local only for v1, with the engine designed so a backend can be added. 

5. **Audience level.** Pure beginners, or also people prepping for specific DCT interviews?
   ✅ Default: both, using difficulty tiers 1–5.

6. **Hardware focus.** Classic compute and storage first, or prioritize GPU/AI racks (liquid cooling, InfiniBand, high-density power)?
   ✅ Default: compute/storage first, with an AI-cluster pack in Phase 7.

7. **Your experience as source material.** Any real-world procedures, ticket
   templates, label formats, or common "gotchas" you want captured? Real-world
   accuracy is the biggest differentiator. - I want it as real-world as possible. Gotchas included.

8. **Monetization / licensing.** Personal portfolio piece, free public tool, or a future product? This affects asset licensing and how polished the art needs to be.
In that order, it will be for me alone at first, it MIGHT turn into a full public tool someday, but I can removing licensing issues later as needed.

