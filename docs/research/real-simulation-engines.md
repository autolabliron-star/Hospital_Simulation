# What makes a 3D world "feel real": engines, AI realism and world models

Research date: 2026-10-29. The owner asked:
- Which software does the game industry use for real games?
- What is the video where someone took images like our Blender stills and turned them into a simulation that feels real?

## 0. Summary

**The tools fall into three families.** That video was almost certainly one of the AI families, not a game engine:

| Family | What it does | Interactive? | Examples (2026) |
|---|---|---|---|
| **1. Game engines** | Classic real-time rendering: lights, materials, animation. What real games ship on. | Yes, at 60–90 fps | Unreal Engine 5, Unity 6, in-house engines (Frostbite, RE Engine, Decima) |
| **2. AI "make it real" filters** | Take rendered frames, or a Blender clip, and repaint them as photoreal footage | Video tools: no. NVIDIA DLSS 5: yes, on RTX 50 PCs | Luma Modify Video, Runway Aleph, NVIDIA DLSS 5, Decart Lucy, NVIDIA Cosmos Sim-Transfer |
| **3. World models and splats** | Turn one image, or many photos/renders, into a 3D world you can walk in | Yes, but generated: no rules, no simulation | Google Genie 3 / Project Genie, World Labs Marble, Gaussian splatting (Spark for three.js) |

**Why "Blender images → it feels real" works:**
- **AI video tools (family 2)** keep the motion and camera of a rough render, then repaint every frame with real-looking light, skin and texture. The result is a video, not something you can walk in.
- **Gaussian splatting (family 3)** learns the exact look of a scene from many pictures, including reflections and soft light, and replays it in real time.

**For The Ideal Hospital:**
- The most promising step is **Gaussian splats made from our own Blender renders**, shown in our three.js scene with Spark.
- For a showcase trailer, an **AI video restyle** of a recorded walkthrough.
- A move to Unreal would raise realism, but costs a renderer rewrite and the browser, and makes Quest 3 standalone harder.

Details below.

## 1. What real games are made with

- **Unreal Engine 5 dominates new AAA work.** On Steam, games built on custom engines fell from over 70% of releases in 2012 to 13% in 2024. Unreal is "the go-to game engine for many AAA studios" (Sensor Tower). Big franchises are moving: Halo left its own Slipspace engine for Unreal 5, and Gears of War: E-Day is on UE5.
- **What UE 5.7 brings for realism:**
  - **Lumen:** real-time global illumination (light bouncing off walls), moving to hardware ray tracing at 60 Hz.
  - **MegaLights:** many soft shadow-casting area lights.
  - **Nanite:** film-quality geometry.
  - **MetaHuman:** realistic people with facial animation.
- **Unity 6** is the usual pick for **standalone Quest 3**. VR studios report it is easier to hold 72–90 fps there. Unreal on Quest typically costs 20–40% more optimisation effort for the same scene, though that is studio experience, not a benchmark.
- **In-house engines** still ship many of the biggest games: Frostbite (EA), RE Engine (Capcom), Decima (Sony/Guerrilla), id Tech. They are not available to outside teams.

**Why games feel real is the same list as our realism plan**:
1. lighting that bounces (global illumination);
2. real materials (roughness, reflections, skin that light passes into);
3. motion-captured people and faces;
4. a calm eye-level camera.

The engine is a toolbox for these. It does not make a scene real by itself.

## 2. The AI "make it real" filters (likely the video)

**AI video-to-video restyling.** This is the Blender-render-to-real-footage workflow seen in many viral videos.
- **Luma Modify Video** (Ray3.2):
  - keeps the camera, motion, poses and scene layout of an input clip, and reimagines the lighting, materials and textures;
  - up to 1080p, clips up to about 20 s.
- **Runway Aleph 2.0:** edits or restyles an input clip (up to about 30 s, 1080p, 30 fps), including relighting and changing materials.
- Feed either tool a grey Blender render and it returns footage that looks filmed.
- It is **not interactive**: minutes of cloud processing per clip, and details can change between clips.

**Real-time neural rendering:**
- **NVIDIA DLSS 5:**
  - Announced at GTC in March 2026; now shipping in NBA 2K27, on GeForce RTX 50 GPUs and GeForce NOW.
  - A neural network reads each game frame plus its motion vectors and re-renders the lighting and materials photoreal. It targets skin, hair and fabric.
  - It is tied to the 3D scene, so it stays consistent from frame to frame. Developers get sliders (25–95% intervention) and masks.
  - Artists criticised it as an "AI beauty filter" that overrides art direction.
  - **It needs an RTX 50 PC or GeForce NOW, not a browser or a Quest.**
- **Decart Lucy Restyle** (shown at GTC 2026): real-time restyling of a game or camera feed into a "new world". It runs on datacenter GPUs.
- **NVIDIA Cosmos3-Nano-Sim-Transfer:**
  - Released October 2026: a 16B open model that turns simulator renders (depth, segmentation, edges, blurred RGB) into photoreal video, under the OpenMDW licence.
  - Built for robotics sim-to-real: the simulation stays exact while the picture becomes real.
  - It is the closest research match to "our simulation, made to look real". It needs big GPUs and is not for a headset.
- **Background:** Intel's 2021 "Enhancing Photorealism Enhancement" made GTA V look like dashcam footage by training on real city photos. It started this whole line of work. Its output was a video demo, not a playable game.

## 3. World models and Gaussian splatting

- **Google Genie 3 / Project Genie:**
  - Generates an interactive world from a text or image prompt: 720p at about 24 fps, with about a minute of memory.
  - Released to AI Ultra subscribers on 2026-01-29. Waymo uses a variant for driving edge cases.
  - **There is no scene file and no game logic.** The world is dreamed frame by frame, so it cannot run our hospital's rules (journeys, queues, the clinical day) or stay true to our floor plan.
- **World Labs Marble:**
  - Turns an image, text or video into a 3D world stored as **Gaussian splats**, with a coarse collision mesh.
  - Exports to Unreal, Unity, Blender and three.js, with a WebXR preset for Quest 3 and Vision Pro.
  - Hands-on tests: quality drops away from the centre of the world, and its meshes are poor. It invents what it cannot see, so it is not true to our real layout.
- **Gaussian splatting:**
  - Millions of small, soft, coloured blobs, trained from many pictures of one scene.
  - It reproduces exactly what the pictures showed: reflections, glossy floors, soft bounce light, at photo quality and in real time.
  - **Spark** (World Labs, open source) renders splats inside three.js. Spark 2.x streams huge scenes with level of detail and paging.
  - A 2026 platform survey puts the browser budget on Quest 3 at about **1 M splats or fewer**. No published Quest benchmark for large scenes exists, so test on the device.
  - Khronos announced `KHR_gaussian_splatting` for glTF in February 2026, so splats are becoming a standard asset format.

## 4. What this means for The Ideal Hospital

Our hospital is a **living simulation**: seeded, deterministic, with 100+ people following journeys, in a browser and on a Quest 3. Engines, filters and world models fit it very differently:

| Option | Realism gain | Keeps our sim and browser? | Quest 3 | Cost | Verdict |
|---|---|---|---|---|---|
| **A. Splats from our own Blender renders** for the static building, with meshes kept for people, robots and devices | High: Cycles quality, including reflections and glossy floors | Yes (Spark in R3F) | Probably, about 1 M splats a zone; must test | Medium: render views, train, stream per zone | **Pilot it (one zone)** |
| **B. AI video restyle** (Luma or Runway) of a recorded walkthrough | Very high, in a video | Not interactive | n/a | Low | **Use for the trailer or presentation** |
| C. Port to Unreal Engine 5 | High (Lumen, MegaLights, MetaHumans) | No: renderer rewrite, browser lost (Pixel Streaming needs cloud GPUs) | Hard on standalone | Very high | Not now |
| D. DLSS 5 or neural filters live | Very high | No (RTX 50 PC only) | No | High | Watch |
| E. World models (Genie 3, Marble) | High, in a demo | No: no rules, not true to the plan | Marble splats only | Low to try | Inspiration only |

**Option A in practice:**
1. In Blender, render 300–600 Cycles views of one baked zone, using the same scene we already bake.
2. Train a 3DGS model. The cameras are known exactly, so no photo matching is needed.
3. Compress it to `.spz` or the glTF extension.
4. Load it with Spark in R3F behind the warm-up gate.
5. Our invisible collision meshes and live meshes stay on top, with depth sorted against the splats.

This keeps the deterministic simulation and the browser. It brings real-camera lighting to walls, floors, glass and fixed furniture: the "Blender still" look while you walk.

**Option A risks:**
- Splats are static: doors and anything that moves must stay meshes.
- Mixing splats with meshes needs care with depth and lighting.
- Memory and sorting cost on Quest.
- Spark is an npm dependency (exact version, `--ignore-scripts`) and must ship offline, not from a CDN.

## 5. Suggested next steps (owner's choice)

1. **Splat pilot, lobby zone:**
   - render the views in Cycles, train, view in R3F with Spark;
   - compare with the current baked lobby, with screenshots, plus frame time and memory on the laptop;
   - then test on a Quest 3 in WebXR.
2. **Trailer test:** record a 20-second walkthrough on 5174 and restyle it in Luma Modify Video or Runway Aleph, to show what "real" looks like next to ours. This needs the owner's account on those services.
3. Keep the realism steps 4–8 of the current plan (sharper lightmaps, materials), whose fixes help every option.

Open question: **please share the video link.** It tells us which family it was (an AI restyle, Genie or Marble, or splats), and so which path matches what you saw.

## Sources

**Game engines**
- [Sensor Tower: The Big Game Engine Report 2025](https://app.sensortower.com/vgi/assets/reports/The_Big_Game_Engines_Report_of_2025.pdf)
- [Unreal Engine (Wikipedia)](https://en.wikipedia.org/wiki/Unreal_Engine)
- [Halo: Campaign Evolved (Wikipedia)](https://en.wikipedia.org/wiki/Halo:_Campaign_Evolved)
- [Gears of War: E-Day (Wikipedia)](https://en.wikipedia.org/wiki/Gears_of_War:_E-Day)
- [Unreal Engine 5.7 release (Epic)](https://www.unrealengine.com/news/unreal-engine-5-7-is-now-available)
- [Tom Looman: UE 5.7 performance highlights](https://tomlooman.com/unreal-engine-5-7-performance-highlights/)
- [CG Channel: UE 5.7 for CG artists](https://www.cgchannel.com/2025/11/unreal-engine-5-7-five-key-features-for-cg-artists/)
- [Unity vs Unreal for VR in 2026 (VirtualVerse)](https://virtualverse.studio/blogs/unity-vs-unreal-enterprise-vr-training)
- [Unity vs Unreal for VR in 2026 (DEV)](https://dev.to/abdulrahman_maslmany/unity-vs-unreal-engine-which-is-best-for-vr-games-in-2026-2f14)

**AI video restyling**
- [Luma: Introducing Modify Video](https://lumalabs.ai/news/introducing-modify-video)
- [Runway Aleph](https://runway.com/research/introducing-runway-aleph)
- [Runway vs Luma comparison (Atlabs)](https://www.atlabs.ai/blog/runway-aleph-vs-luma-modify-video)

**Real-time neural rendering**
- [NVIDIA: DLSS 5 announcement](https://nvidianews.nvidia.com/news/nvidia-dlss-5-delivers-ai-powered-breakthrough-in-visual-fidelity-for-games)
- [NVIDIA: DLSS 5 in NBA 2K27](https://www.nvidia.com/en-us/geforce/news/dlss-5-3d-guided-neural-rendering/)
- [RedShark: the DLSS 5 backlash](https://www.redsharknews.com/nvidia-dlss-5-neural-rendering-backlash)
- [NVIDIA GTC 2026: real-time generative re-styling for gaming](https://www.nvidia.com/en-us/on-demand/session/gtc26-s81596/)
- [The Decoder: Runway real-time video](https://the-decoder.com/runway-wants-to-turn-ai-video-generation-into-a-live-stream-you-control-in-real-time/)
- [NVIDIA Cosmos3-Nano-Sim-Transfer (Hugging Face)](https://huggingface.co/nvidia/Cosmos3-Nano-Sim-Transfer)
- [Cosmos-Transfer2.5 (GitHub)](https://github.com/nvidia-cosmos/cosmos-transfer2.5)
- [Intel Labs photorealism enhancement for GTA V (Road to VR)](https://www.roadtovr.com/?p=102189)

**World models and Gaussian splatting**
- [Genie (world model), Wikipedia](https://en.wikipedia.org/wiki/Genie_(world_model))
- [World Labs: Marble](https://www.worldlabs.ai/blog/marble-world-model)
- [World Labs: bigger and better worlds](https://www.worldlabs.ai/blog/bigger-better-worlds)
- [Marble in practical testing (design4real)](https://design4real.de/en/world-labs-marble-practical-test/)
- [Playable Gaussian splats in game engines (2026)](https://www.top3d.ai/learn/gaussian-splatting-playable-game-engines-2026)
- [Gaussian splatting platforms 2026 (ar-go)](https://ar-go.co/blog/gaussian-splatting-platforms/)
- [Spark on Hacker News](https://news.ycombinator.com/item?id=44249565)
- [Spark vs native three.js integration test (DEV)](https://dev.to/alicia_lu/spark-vs-gaussiansplats3d-vs-native-threejs-an-integration-test-3824)
- [The future of Gaussian splatting (Walturn)](https://www.walturn.com/insights/the-future-of-gaussian-splatting)
- [Laval Virtual 2026: splats in VR (3DVF)](https://3dvf.com/en/redaction/laval-virtual-2026-gaussian-splats-motion-capture-innovations-and-an-industry-in-transition/)
