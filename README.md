# THREE Image Transition

Shader powered image transition using THREE.js and GSAP.

Originally created on CodePen by Szenia Zadvornykh: [https://codepen.io/zadvorsky/pen/PNXbGo](https://codepen.io/zadvorsky/pen/PNXbGo)

Now updated with modern packages:
- **THREE.js** v0.181+ (latest)
- **GSAP** v3.13+ (latest)
- **Vite** v7.2+ (modern build tool)

## Features

- Animated image transitions with custom WebGL shaders
- Bezier curve-based animations
- Interactive scrubbing (click and drag to control animation)
- Keyboard control (press 'P' to pause/play)
- Responsive design

## Development

Install dependencies:
```bash
npm install
```

Run development server:
```bash
npm run dev
```

Build for production:
```bash
npm run build
```

Preview production build:
```bash
npm run preview
```

## Deployment to GitHub Pages

1. Update the `base` path in `vite.config.js` to match your repository name
2. Run the deploy command:
```bash
npm run deploy
```

This will build the project and push to the `gh-pages` branch.

## License

MIT License - See LICENSE.txt for details