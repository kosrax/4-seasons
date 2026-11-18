# Four Seasons: A 3D Font Experiment

This is a small personal experiment where I tried learning how **3D typography** works in the browser using Three.js and React Three Fiber. I wanted to see what happens when you take flat fonts, extrude them into 3D shapes, wrap them in custom shaders, and build tiny seasonal worlds around the letters.

I am still a beginner learning 3D graphics, shaders, and interactive web scenes, so this project is basically my playground for trying out new things.

Repository: [github.com/kosrax/4-seasons](https://github.com/kosrax/4-seasons)

## What I Experimented With

- **3D Extruded Fonts**: Turning `.json` typeface files (`Cormorant Garamond SemiBold` and `Helvetiker Bold`) into beveled 3D meshes with `<Text3D>`.
- **Clicking the Text (`2D` <-> `3D`)**: Morphing the letters smoothly between flat `2D` typography and full `3D` depth when you click directly on the word.
- **Cursor Reactive Shaders**: Bending and bulging letter vertices near the mouse pointer with custom GLSL (`onBeforeCompile`) while adding subtle glow and movement.
- **Procedural Seasonal Worlds**: Giving each word its own small grounded environment using instanced meshes (`InstancedMesh`), custom floor shaders, particles, and little props resting on top of letters.

## The Four Seasons

1. **Spring (`BLOOM`)**: Glazed green serif letters growing out of a grassy meadow patch with crocus flowers and floating pollen.
2. **Summer (`HEAT`)**: Glossy coral letters resting in sculpted sand dunes with overhead sun rays, a beach ball, and sunglasses sitting on top of `H`.
3. **Autumn (`FALLING`)**: Terracotta letters surrounded by dry reeds, curved fallen leaves, acorns, twigs, and a maple leaf perched on `F`.
4. **Winter (`FROZEN`)**: Icy faceted letters sitting in sparkling snowdrifts with hexagonal ice crystals, frosted reeds, and hanging icicles on `F`.

## Try the Controls

- **Click the word**: Switch smoothly between `2D` and `3D` mode.
- **Hover over letters**: Watch the surface ripple and bulge softly around your cursor.
- **Click and drag** (`3D` mode): Orbit around the word or tilt up and down to inspect the ground details.
- **`Shift` + drag or right-click drag** (`3D` mode): Pan left and right.
- **`1`, `2`, `3`, `4` keys**: Jump between Spring, Summer, Autumn, and Winter.
- **`R` key**: Reset the camera back to the front view.

## Built With

- React `18.3` + Vite `5.4`
- Three.js `0.169` + `@react-three/fiber` + `@react-three/drei`
- GSAP `3.15` for smooth season transitions

## Running It Locally

Make sure you have Node.js `18+` installed:

```bash
git clone https://github.com/kosrax/4-seasons.git
cd 4-seasons
npm install
npm run dev
```

To create a production build:

```bash
npm run build
```

## Font Credits

- **Cormorant Garamond SemiBold** (`public/fonts/CormorantGaramond-SemiBold.json`), SIL Open Font License 1.1
- **Helvetiker Bold** (`three@0.169.0` examples, used in Summer with local fallback to Cormorant Garamond SemiBold), MIT License
