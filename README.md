# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Add and publish product photos

Run `npm install` and `npm run dev`, then open **PDF Catalog**. Select a category and use **Add photo** beside a product. The development server saves the optimized JPEG in `public/product-images/` and updates `src/productImages.json`. Photos are then used by the customer website and the illustrated price list.

After adding photos, commit the generated image files and `src/productImages.json` along with the code, then build and redeploy the site. The photo-upload endpoint is available only in the Vite development server; a static production site cannot write files into the project. To change a deployed photo, add or change it locally, commit, and redeploy.

The illustrated PDF includes all 102 listed products in a compact four-page landscape layout. Products without uploaded photos show a placeholder.
