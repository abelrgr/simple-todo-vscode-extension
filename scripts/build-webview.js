#!/usr/bin/env node
const esbuild = require('esbuild');
const path = require('path');

async function build() {
  try {
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/webview/main.ts')],
      outfile: path.resolve(__dirname, '../media/main.js'),
      bundle: true,
      minify: true,
      sourcemap: process.env.NODE_ENV !== 'production',
      format: 'iife',
      target: 'es2019',
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
      }
    });
    console.log('Webview bundle created.');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

build();
