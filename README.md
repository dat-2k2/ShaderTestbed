Shader Testbed for GLSL. Credit for Java code: https://github.com/codingminecraft/MarioYoutube, episode 4. 
- The main window contains a Scene object which is a rectangle. To draw any other object, customize vertexArray and elementArray (VAO, EBO).
- To use your GLSL files, put them in assets/shaders and compile them by using Shader class. The default.glsl is an implementation of Microfacet TR models from Epic Games (https://cdn2.unrealengine.com/Resources/files/2013SiggraphPresentationsNotes-26915738.pdf)


## Web demo

The page is styled with the shared UI kit from the portfolio (`https://dat-2k2.github.io/kit/kit.css` and `kit.js`, light/dark, Geist); only the layout lives in this repo.

An interactive WebGL2 version runs in the browser: **https://dat-2k2.github.io/shader-sandbox/**

- It renders the same `src/main/resources/assets/shaders/default.glsl` as the desktop app (the `#version 330 core` header is rewritten to `#version 300 es` at load time).
- Drag to orbit, scroll or pinch to zoom; tweak base color, roughness, metallic and the light from the side panel.
- Edit the fragment shader in the page and press Ctrl+Enter to recompile; errors are shown under the editor.

The `Deploy web demo to GitHub Pages` workflow (`.github/workflows/pages.yml`) publishes `web/` plus the shaders on every push to `main`. One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

To run it locally, serve the repository root and open `/web/`:

```
python3 -m http.server 8000
# then open http://localhost:8000/web/
```

### Shader uniforms

Both hosts set these uniforms, so a shader written for one runs on the other:

| Uniform | Type | Meaning |
| --- | --- | --- |
| `iResolution` | `vec3` | framebuffer size in pixels |
| `iTime` | `float` | seconds since start |
| `uCameraPos` | `vec3` | camera position (looks at the origin) |
| `uBaseColor` | `vec3` | linear base color |
| `uRoughness` | `float` | perceptual roughness, 0–1 |
| `uMetallic` | `float` | 0–1 |
| `uLightDir` | `vec3` | direction towards the light |
| `uLightIntensity` | `float` | light intensity |
